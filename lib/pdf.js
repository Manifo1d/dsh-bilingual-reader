/**
 * PDF reader backed by the Poppler command-line tools installed on the host.
 *
 * `pdftotext -bbox-layout` supplies reading-order blocks and word boxes, and
 * `pdftoppm` rasterizes pages. The browser overlays transparent word spans on
 * those images, which gives selection, highlighting, and segment-level
 * translation without shipping a PDF engine to the client.
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_PAGES = 80
const MAX_BLOCK_CHARS = 700

/**
 * Parse one uploaded PDF into pages, positioned words, and translation segments.
 * @param {Buffer} buffer - complete PDF bytes.
 * @param {string} filename - uploaded name, used for the title.
 * @param {string} dir - directory owned by the caller for intermediate files.
 * @returns {Promise<{kind:'pdf', title:string, pages:object[], segments:object[], warnings:string[], truncated:boolean}>}
 */
export async function parsePdf(buffer, filename, dir) {
  await mkdir(dir, { recursive: true })
  const input = join(dir, 'input.pdf')
  await writeFile(input, buffer)
  const textPath = join(dir, 'layout.html')
  const prefix = join(dir, 'page')

  let textResult
  try {
    textResult = await run('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', '-f', '1', '-l', String(MAX_PAGES), input, textPath], 90_000)
  } catch (error) {
    throw pdfToolError('pdftotext', error)
  }
  let html
  try {
    html = await readFile(textPath, 'utf8')
  } catch {
    throw new PdfError('PDF 文本提取失败，无法读取版面。', 'PDF_TEXT_FAILED')
  }
  if (!/<page\b/i.test(html)) {
    throw new PdfError('PDF 文本提取失败，没有读到页面内容。', 'PDF_TEXT_FAILED')
  }

  const parsed = parseBboxHtml(html)
  const pageLimit = Math.min(parsed.pages.length, MAX_PAGES)
  const truncated = parsed.pages.length >= MAX_PAGES

  let imageFiles = []
  try {
    const render = await run('pdftoppm', [
      '-png', '-r', '110', '-scale-to', '1500', '-forcenum',
      '-f', '1', '-l', String(pageLimit), input, prefix,
    ], 120_000)
    if (render.code === 0) {
      const entries = await readdir(dir)
      imageFiles = entries
        .filter(name => /^page-\d+\.png$/i.test(name))
        .sort((a, b) => pageNumber(a) - pageNumber(b))
    }
  } catch {
    // A rasterizer failure still leaves selectable text. The client renders a
    // plain text page when `image` is null.
  }

  const pages = []
  const segments = []
  for (let index = 0; index < pageLimit; index++) {
    const page = parsed.pages[index]
    const image = imageFiles[index] ?? null
    const words = page.words
    pages.push({
      index: index + 1,
      width: page.width,
      height: page.height,
      image,
      words,
      segments: page.segments.map(segment => segment.id),
    })
    for (const segment of page.segments) {
      segments.push({
        id: segment.id,
        text: segment.text,
        kind: 'block',
        page: index + 1,
      })
    }
  }

  if (segments.length === 0) {
    const warnings = [
      '这个 PDF 没有可提取的文本，可能是扫描件。页面仍会显示，但无法划选或翻译。',
    ]
    return {
      kind: 'pdf',
      title: filename.replace(/\.pdf$/i, ''),
      pages,
      segments: [],
      warnings,
      truncated,
    }
  }

  const warnings = []
  if (textResult.code !== 0) warnings.push('PDF 解析工具报告了警告，已尽量读取可提取的内容。')
  if (truncated) warnings.push(`文档超过 ${MAX_PAGES} 页，本版本只处理前 ${MAX_PAGES} 页。`)
  if (imageFiles.length === 0) warnings.push('页面图片渲染失败，当前以文本版式显示。')
  return {
    kind: 'pdf',
    title: filename.replace(/\.pdf$/i, ''),
    pages,
    segments,
    warnings,
    truncated,
  }
}

export class PdfError extends Error {
  constructor(message, code = 'PDF_INVALID', status = 422) {
    super(message)
    this.code = code
    this.status = status
  }
}

function pdfToolError(tool, error) {
  if (error?.code === 'ENOENT' || /ENOENT/.test(String(error?.message))) {
    return new PdfError(
      `缺少 PDF 解析工具 ${tool}。请安装 Poppler（macOS: brew install poppler），然后重试。`,
      'PDF_TOOL_MISSING',
      503,
    )
  }
  const detail = String(error?.stderr || error?.message || '').trim().split('\n').slice(-2).join(' ')
  return new PdfError(`PDF 解析失败${detail ? `：${detail}` : '。'}`, 'PDF_TOOL_FAILED', 422)
}

/**
 * Run a Poppler tool from PATH, then from the common Homebrew locations.
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
async function run(name, args, timeout) {
  const extra = process.env[`DSH_${name.toUpperCase()}_PATH`]
  const candidates = [
    extra,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean)
  let lastError
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate, args, {
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      })
      return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        lastError = error
        continue
      }
      if (typeof error?.code === 'number' || error?.killed || error?.signal) {
        // A non-zero exit is a real parse failure, not a missing binary.
        return {
          code: typeof error.code === 'number' ? error.code : 1,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? error.message ?? '',
        }
      }
      lastError = error
      break
    }
  }
  throw lastError ?? Object.assign(new Error(`ENOENT: ${name}`), { code: 'ENOENT' })
}

function pageNumber(name) {
  const match = /(\d+)\.png$/i.exec(name)
  return match ? Number(match[1]) : 0
}

/* ------------------------------------------------------------- parsing */

function parseBboxHtml(html) {
  const pages = []
  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi
  let pageMatch
  while ((pageMatch = pageRe.exec(html))) {
    const attrs = parseAttrs(pageMatch[1])
    const width = Number(attrs.width) || 612
    const height = Number(attrs.height) || 792
    const blocks = []
    let segCounter = 0
    const blockRe = /<block\b([^>]*)>([\s\S]*?)<\/block>/gi
    let blockMatch
    while ((blockMatch = blockRe.exec(pageMatch[2]))) {
      const lines = []
      const lineRe = /<line\b([^>]*)>([\s\S]*?)<\/line>/gi
      let lineMatch
      while ((lineMatch = lineRe.exec(blockMatch[2]))) {
        const words = []
        const wordRe = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi
        let wordMatch
        while ((wordMatch = wordRe.exec(lineMatch[2]))) {
          const wordAttrs = parseAttrs(wordMatch[1])
          const text = decodeEntities(wordMatch[2].replace(/<[^>]*>/g, '')).trim()
          if (!text) continue
          const x = Number(wordAttrs.xMin)
          const y = Number(wordAttrs.yMin)
          const xMax = Number(wordAttrs.xMax)
          const yMax = Number(wordAttrs.yMax)
          if (![x, y, xMax, yMax].every(Number.isFinite)) continue
          words.push({ x, y, w: xMax - x, h: yMax - y, text })
        }
        if (words.length > 0) {
          lines.push({ words, text: joinWords(words.map(word => word.text)) })
        }
      }
      if (lines.length === 0) {
        const text = decodeEntities(blockMatch[2].replace(/<[^>]*>/g, '')).trim()
        if (text) blocks.push({ text, lines: [], words: [] })
        continue
      }
      // Group dense lines into paragraph-sized translation segments.
      let current = []
      let currentChars = 0
      const flush = () => {
        if (current.length === 0) return
        const text = current.map(line => line.text).join('\n').trim()
        if (text) {
          const segId = `s${pages.length + 1}-${++segCounter}`
          for (const line of current) for (const word of line.words) word.seg = segId
          blocks.push({ id: segId, text, lines: current, words: current.flatMap(line => line.words) })
        }
        current = []
        currentChars = 0
      }
      for (const line of lines) {
        if (current.length > 0 && currentChars + line.text.length > MAX_BLOCK_CHARS) flush()
        current.push(line)
        currentChars += line.text.length
      }
      flush()
    }
    const words = blocks.flatMap(block => block.words ?? [])
    const segments = blocks.filter(block => block.id)
    pages.push({ width, height, blocks, words, segments })
  }
  return { pages }
}

function parseAttrs(source) {
  const attrs = Object.create(null)
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g
  let match
  while ((match = re.exec(source))) attrs[match[1]] = match[2]
  return attrs
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

/** Join PDF words without inserting spaces inside CJK runs. */
function joinWords(words) {
  let out = ''
  for (const word of words) {
    if (!out) {
      out = word
      continue
    }
    const previous = out[out.length - 1]
    const next = word[0]
    out += noSpaceBetween(previous, next) ? word : ` ${word}`
  }
  return out
}

function noSpaceBetween(previous, next) {
  const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/
  if (cjk.test(previous) && cjk.test(next)) return true
  if ('，。！？；：、）》」』】'.includes(next)) return true
  if (cjk.test(next) && '，。！？；：、）》」』】'.includes(previous)) return true
  if ('（《「『【'.includes(previous)) return true
  if (previous === '-' || previous === '—') return true
  return false
}
