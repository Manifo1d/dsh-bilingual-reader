/**
 * Minimal, dependency-free DOCX reader.
 *
 * A .docx is a ZIP with OOXML parts. We read `word/document.xml` and
 * `word/styles.xml`, turn paragraphs into translation segments, and retain
 * enough run formatting for a faithful reading view. Embedded raster illustrations, explicit page breaks, and basic running
 * headers and footers are retained alongside the text.
 */

import { posix } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/**
 * Read a DOCX buffer.
 * @param {Buffer} buffer - the complete .docx file.
 * @param {string} filename - original filename, used for the title.
 * @returns {{kind:'docx', title:string, blocks:object[], segments:object[], warnings:string[]}}
 */
export function parseDocx(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new DocxError('文件为空或不是有效的 DOCX。')
  const entries = readZipDirectory(buffer)
  const documentEntry = entries.get('word/document.xml')
  if (!documentEntry) throw new DocxError('DOCX 中缺少 word/document.xml；文件可能已损坏。')

  const documentXml = readEntry(buffer, documentEntry).toString('utf8')
  const stylesXml = entries.get('word/styles.xml')
  const styles = stylesXml ? parseStyles(readEntry(buffer, stylesXml).toString('utf8')) : new Map()
  const root = parseXml(stripBom(documentXml))
  const body = findDescendant(root, 'w:body') ?? root

  const segments = []
  const blocks = []
  let blockIndex = 0
  const addParagraph = (paragraph, options = {}) => {
    const parsed = parseParagraph(paragraph, styles, options, segments.length + 1)
    if (!parsed) return
    const position = blockIndex++
    parsed.block.blockIndex = position
    blocks.push(parsed.block)
    if (parsed.segment) segments.push({ ...parsed.segment, block: position })
  }

  for (const child of body.children) {
    if (child.name === 'w:p') addParagraph(child, { table: false })
    else if (child.name === 'w:tbl') blocks.push(parseTable(child, styles, segments, () => blockIndex++))
  }
  // Nested tables are added by parseTable; block indexes are cosmetic, so odd
  // values there do not affect segment order.

  if (segments.length === 0) {
    throw new DocxError('这个 DOCX 没有可提取的正文文本。')
  }

  const title = readCoreTitle(entries, buffer) || filename.replace(/\.docx$/i, '')
  const relEntry = entries.get('word/_rels/document.xml.rels')
  const rels = new Map()
  if (relEntry) {
    const root = parseXml(readEntry(buffer, relEntry).toString('utf8'))
    for (const rel of findDescendant(root, 'Relationships')?.children || []) {
      if (!rel.attrs?.Target || rel.attrs.TargetMode === 'External') continue
      rels.set(rel.attrs.Id, posix.normalize(posix.join('word', rel.attrs.Target)))
    }
  }
  const media = {}
  let remaining = 24 * 1024 * 1024
  let missing = false
  const walk = block => {
    if (block.rows) {
      for (const row of block.rows) for (const cell of row) cell.blocks.forEach(walk)
    }
    for (const id of block.images || []) {
      if (media[id]) continue
      const path = rels.get(id) || ''
      const mime = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' }[path.split('.').pop().toLowerCase()]
      const entry = entries.get(path)
      if (!mime || !entry || !path.startsWith('word/media/') || entry.size > remaining) { missing = true; continue }
      const data = readEntry(buffer, entry, remaining)
      remaining -= data.length
      media[id] = 'data:image/' + mime + ';base64,' + data.toString('base64')
    }
    if (block.hasImage && !block.images?.length) missing = true
  }
  blocks.forEach(walk)
  const sect = findChild(body, 'w:sectPr')
  const runningText = tag => {
    const reference = sect?.children?.find(node => node.name === tag && node.attrs['w:type'] === 'default')
    const entry = entries.get(rels.get(reference?.attrs['r:id']))
    if (!entry) return ''
    const xml = parseXml(readEntry(buffer, entry).toString('utf8'))
    const parts = []
    const visit = n => { if (n.name === 'w:t') parts.push(textContent(n)); else n.children?.forEach(visit) }
    visit(xml)
    return parts.join(' ').trim()
  }
  return { kind: 'docx', title, blocks, segments, media, header: runningText('w:headerReference'),
    footer: runningText('w:footerReference'), warnings: missing ? ['部分嵌入对象无法在阅读视图中显示。'] : [] }
}

export class DocxError extends Error {
  constructor(message) {
    super(message)
    this.code = 'DOCX_INVALID'
    this.status = 422
  }
}

function readZipDirectory(buffer) {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new DocxError('无法读取 DOCX 压缩包：找不到目录结尾。')
  const total = buffer.readUInt16LE(eocd + 10)
  if (total === 0xffff) throw new DocxError('暂不支持 ZIP64 格式的 DOCX。')
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < total; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) {
      throw new DocxError('DOCX 压缩包目录损坏。')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.set(name, { method, compressedSize, localOffset, size: buffer.readUInt32LE(offset + 24) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22)
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === EOCD) return i
  }
  return -1
}

function readEntry(buffer, entry, limit = 40 * 1024 * 1024) {
  if (entry.size > limit) throw new DocxError('文档解压后超出阅读上限。')
  const offset = entry.localOffset
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL) {
    throw new DocxError('DOCX 压缩包成员损坏。')
  }
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const start = offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new DocxError('DOCX 压缩包成员越界。')
  const data = buffer.subarray(start, end)
  if (entry.method === 0 && data.length <= limit) return data
  if (entry.method === 8) {
    try {
      return inflateRawSync(data, { maxOutputLength: Math.max(1, limit) })
    } catch {
      throw new DocxError('DOCX 压缩包解压失败。')
    }
  }
  throw new DocxError(`DOCX 使用了不支持的压缩方式（${entry.method}）。`)
}

/** Read the human title from docProps/core.xml when it exists. */
function readCoreTitle(entries, buffer) {
  const entry = entries.get('docProps/core.xml')
  if (!entry) return ''
  try {
    const xml = readEntry(buffer, entry).toString('utf8')
    const root = parseXml(stripBom(xml))
    const title = findDescendant(root, 'dc:title')
    if (title) return collapse(textContent(title)).slice(0, 200)
  } catch {
    // A broken metadata part must not hide readable body text.
  }
  return ''
}

/* ------------------------------------------------------------------ XML */

/**
 * Build a tiny DOM for the machine-generated XML in OOXML parts.
 * It is deliberately permissive: unknown elements and attributes are kept
 * verbatim, text is preserved, comments and declarations are skipped.
 */
function parseXml(source) {
  const root = { name: '#root', attrs: Object.create(null), children: [] }
  const stack = [root]
  let index = 0
  const pushText = text => {
    if (text.length > 0) stack[stack.length - 1].children.push({ name: '#text', text: decodeEntities(text) })
  }
  while (index < source.length) {
    const lt = source.indexOf('<', index)
    if (lt < 0) {
      pushText(source.slice(index))
      break
    }
    if (lt > index) pushText(source.slice(index, lt))
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      index = end < 0 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      const text = source.slice(lt + 9, end < 0 ? source.length : end)
      stack[stack.length - 1].children.push({ name: '#text', text })
      index = end < 0 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    const gt = findTagEnd(source, lt + 1)
    if (gt < 0) {
      pushText(source.slice(lt))
      break
    }
    const raw = source.slice(lt + 1, gt).trim()
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop()
    } else {
      const selfClosing = raw.endsWith('/')
      const body = selfClosing ? raw.slice(0, -1).trim() : raw
      const nameEnd = body.search(/[\s]/)
      const name = nameEnd < 0 ? body : body.slice(0, nameEnd)
      const attrs = Object.create(null)
      if (nameEnd >= 0) {
        const attrSource = body.slice(nameEnd)
        const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
        let match
        while ((match = attrRe.exec(attrSource))) {
          attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
        }
      }
      const node = { name, attrs, children: [] }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
    }
    index = gt + 1
  }
  return root
}

function findTagEnd(source, from) {
  let quote = ''
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i
    }
  }
  return -1
}

function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));/gi, (whole, hex, dec, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10))
    switch (named) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      case 'nbsp': return ' '
      default: return whole
    }
  })
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function findChild(node, name) {
  return node?.children?.find(child => child.name === name)
}

function findDescendant(node, name) {
  if (!node?.children) return undefined
  for (const child of node.children) {
    if (child.name === name) return child
    const found = findDescendant(child, name)
    if (found) return found
  }
  return undefined
}

function textContent(node) {
  let out = ''
  for (const child of node.children) out += child.name === '#text' ? child.text : textContent(child)
  return out
}

/* ------------------------------------------------------------- styles */

function parseStyles(xml) {
  const styles = new Map()
  const root = parseXml(xml)
  const collect = node => {
    if (!node.children) return
    for (const child of node.children) {
      if (child.name === 'w:style') {
        const id = child.attrs['w:styleId']
        if (id) {
          const nameNode = findChild(child, 'w:name')
          const basedOn = findChild(child, 'w:basedOn')
          const pPr = findChild(child, 'w:pPr')
          const rPr = findChild(child, 'w:rPr')
          styles.set(id, {
            id,
            name: nameNode?.attrs['w:val'] ?? '',
            basedOn: basedOn?.attrs['w:val'] ?? '',
            heading: headingFromStyle(id, nameNode?.attrs['w:val'] ?? ''),
            outline: numberValue(findChild(pPr, 'w:outlineLvl')?.attrs['w:val']),
            align: alignment(findChild(pPr, 'w:jc')?.attrs['w:val']),
            list: findChild(pPr, 'w:numPr') ? true : undefined,
            ...runStyle(rPr),
          })
        }
      }
      collect(child)
    }
  }
  collect(root)
  return styles
}

function resolveStyle(styles, id, seen = new Set()) {
  if (!id || seen.has(id)) return {}
  const own = styles.get(id)
  if (!own) return {}
  seen.add(id)
  const base = own.basedOn ? resolveStyle(styles, own.basedOn, seen) : {}
  return {
    ...base,
    ...own,
    heading: own.heading ?? base.heading,
    outline: own.outline ?? base.outline,
    align: own.align ?? base.align,
    list: own.list ?? base.list,
    bold: own.bold ?? base.bold,
    italic: own.italic ?? base.italic,
    underline: own.underline ?? base.underline,
    size: own.size ?? base.size,
    color: own.color ?? base.color,
  }
}

function headingFromStyle(id, name) {
  const source = `${id} ${name}`
  const match = /(?:heading|标题|title)\s*([1-9])/i.exec(source)
  if (match) return Math.min(6, Number(match[1]))
  if (/^title$|^标题$/i.test(name.trim())) return 1
  return undefined
}

function alignment(value) {
  if (value === 'center' || value === 'right' || value === 'both' || value === 'justify') {
    return value === 'both' ? 'justify' : value
  }
  return undefined
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Extract defined run formatting from a w:rPr node. */
function runStyle(rPr) {
  if (!rPr) return {}
  const bold = booleanProperty(findChild(rPr, 'w:b'))
  const italic = booleanProperty(findChild(rPr, 'w:i'))
  const underlineNode = findChild(rPr, 'w:u')
  const underline = underlineNode
    ? underlineNode.attrs['w:val'] !== 'none'
    : undefined
  const colorNode = findChild(rPr, 'w:color')
  const color = colorNode && colorNode.attrs['w:val'] && colorNode.attrs['w:val'] !== 'auto'
    ? normalizeColor(colorNode.attrs['w:val'])
    : undefined
  const size = numberValue(findChild(rPr, 'w:sz')?.attrs['w:val'])
  return {
    ...bold === undefined ? {} : { bold },
    ...italic === undefined ? {} : { italic },
    ...underline === undefined ? {} : { underline },
    ...color === undefined ? {} : { color },
    ...size === undefined ? {} : { size: size / 2 },
  }
}

function booleanProperty(node) {
  if (!node) return undefined
  const value = node.attrs['w:val']
  if (value === '0' || value === 'false' || value === 'off') return false
  return true
}

function normalizeColor(value) {
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : undefined
}

/* ---------------------------------------------------------- paragraphs */

function parseParagraph(paragraph, styles, options, ordinal) {
  const pPr = findChild(paragraph, 'w:pPr')
  const styleId = findChild(pPr, 'w:pStyle')?.attrs['w:val']
  const style = styleId ? resolveStyle(styles, styleId) : {}
  const outline = numberValue(findChild(pPr, 'w:outlineLvl')?.attrs['w:val'])
  const heading = style.heading ?? (outline === undefined ? undefined : Math.min(6, outline + 1))
  const align = alignment(findChild(pPr, 'w:jc')?.attrs['w:val']) ?? style.align
  const list = Boolean(findChild(pPr, 'w:numPr')) || Boolean(style.list)
  const runs = []
  let hasImage = false
  collectRuns(paragraph, style, runs)
  if (runs.some(run => run.image)) hasImage = true
  const visibleRuns = runs
    .filter(run => !run.image)
    .map(run => ({ ...run, text: run.text }))
    .filter(run => run.text.length > 0)
  const text = collapse(visibleRuns.map(run => run.text).join(''))
  const segId = text.length > 0 ? `p${ordinal}` : undefined
  const block = {
    type: 'p',
    blockIndex: ordinal,
    segId,
    heading,
    align,
    list,
    hasImage,
    images: runs.filter(run => run.imageId).map(run => run.imageId),
    breakBefore: Boolean(findChild(pPr, 'w:pageBreakBefore')) || (runs[0]?.pageBreak === true),
    breakAfter: runs.some(run => run.pageBreak),
    runs: visibleRuns,
    text,
  }
  const segment = segId
    ? {
        id: segId,
        text,
        kind: 'paragraph',
        ...heading ? { heading } : {},
        ...list ? { list: true } : {},
        ...options.table ? { table: true } : {},
      }
    : undefined
  return { block, segment }
}

function collectRuns(node, inherited, out) {
  for (const child of node.children) {
    if (child.name === 'w:r') {
      const rPr = findChild(child, 'w:rPr')
      const own = runStyle(rPr)
      const format = {
        ...inherited,
        ...own,
        bold: own.bold ?? inherited.bold,
        italic: own.italic ?? inherited.italic,
        underline: own.underline ?? inherited.underline,
        color: own.color ?? inherited.color,
        size: own.size ?? inherited.size,
      }
      for (const part of child.children) {
        if (part.name === 'w:t') {
          out.push({ text: textContent(part), ...definedFormat(format) })
        } else if (part.name === 'w:tab') {
          out.push({ text: '\t', ...definedFormat(format) })
        } else if (part.name === 'w:br' && part.attrs['w:type'] === 'page') {
          out.push({ text: '', pageBreak: true })
        } else if (part.name === 'w:br' || part.name === 'w:cr') {
          out.push({ text: '\n', ...definedFormat(format) })
        } else if (part.name === 'w:noBreakHyphen') {
          out.push({ text: '-', ...definedFormat(format) })
        } else if (part.name === 'w:drawing' || part.name === 'w:pict' || part.name === 'w:object') {
          out.push({ image: true, imageId: findDescendant(part, 'a:blip')?.attrs['r:embed'] || findDescendant(part, 'v:imagedata')?.attrs['r:id'] })
        }
      }
    } else if (
      child.name === 'w:hyperlink'
      || child.name === 'w:ins'
      || child.name === 'w:smartTag'
      || child.name === 'w:fldSimple'
      || child.name === 'w:sdt'
      || child.name === 'w:sdtContent'
    ) {
      collectRuns(child, inherited, out)
    }
  }
}

function definedFormat(format) {
  const out = {}
  if (format.bold) out.bold = true
  if (format.italic) out.italic = true
  if (format.underline) out.underline = true
  if (format.color) out.color = format.color
  if (format.size) out.size = format.size
  return out
}

function collapse(text) {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseTable(table, styles, segments, nextBlockIndex) {
  const rows = []
  for (const tr of table.children.filter(child => child.name === 'w:tr')) {
    const cells = []
    for (const tc of tr.children.filter(child => child.name === 'w:tc')) {
      const blocks = []
      for (const child of tc.children) {
        if (child.name === 'w:p') {
          const parsed = parseParagraph(child, styles, { table: true }, segments.length + 1)
          if (parsed) {
            parsed.block.blockIndex = nextBlockIndex()
            blocks.push(parsed.block)
            if (parsed.segment) segments.push(parsed.segment)
          }
        } else if (child.name === 'w:tbl') {
          blocks.push(parseTable(child, styles, segments, nextBlockIndex))
        }
      }
      cells.push({ blocks })
    }
    if (cells.length > 0) rows.push(cells)
  }
  return { type: 'table', rows }
}
