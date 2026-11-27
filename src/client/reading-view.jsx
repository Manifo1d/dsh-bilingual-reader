import * as React from 'react'
import { trackPairedSelection } from './paired-selection.js'
import { regionImage } from './region-image.js'
import { PdfPage } from './pdf-view.jsx'
import { AutoTextarea } from './editor.jsx'
import { IconSpark, IconUndo } from './icons.jsx'

function blockIds(block) {
  if (!block.rows) return block.segId ? [block.segId] : []
  return block.rows.flatMap(row => row.flatMap(cell => cell.blocks.flatMap(blockIds)))
}

// Keep deliberate Word page breaks. For reflowable documents without breaks,
// group whole paragraphs into reading pages so both languages share an anchor.
export function readingPages(doc) {
  if (!doc) return []
  if (doc.kind === 'pdf') return doc.pages.map(pdf => ({ pdf, ids: pdf.segments, blocks: [] }))
  const pages = []
  const explicit = doc.blocks.some(block => block.breakBefore || block.breakAfter)
  let page = { blocks: [], ids: [] }
  let weight = 0
  function next() {
    if (page.blocks.length) pages.push(page)
    page = { blocks: [], ids: [] }
    weight = 0
  }
  for (const block of doc.blocks) {
    const ids = blockIds(block)
    const visible = ids.length || block.rows || block.images?.length
    const size = (block.text?.length || 0) + 80 + (block.rows?.length || 0) * 150 + (block.images?.length || 0) * 900
    if (block.breakBefore || (!explicit && weight && weight + size > 3100)) next()
    if (visible) { page.blocks.push(block); page.ids.push(...ids); weight += size }
    if (block.breakAfter) next()
  }
  next()
  return pages
}

function Paragraph({ block, ctx, side }) {
  const segment = ctx.byId.get(block.segId)
  const target = side === 'target'
  const text = target ? segment?.target : segment?.text
  const editing = segment && ctx.editing && (target || ctx.editing === 'both')
  const selected = segment && segment.id === ctx.activeId
  const originalRuns = !target && text === block.text && block.runs?.length
  const emphatic = block.runs?.length && block.runs.every(run => run.bold)
  const heading = block.heading || (block.runs?.some(run => run.size >= 20) ? 1 : 0)
  const Tag = heading ? 'h' + Math.min(6, heading) : 'p'
  return <div className={'rd-block' + (selected ? ' selected' : '')} data-seg={segment?.id}
    onClick={() => segment && ctx.onActivate(segment.id, false)}>
    {block.images?.map((id, index) => ctx.media?.[id] && <img className="rd-figure" key={index} src={ctx.media[id]} alt={ctx.t('figure')} loading="lazy" />)}
    {segment && (editing ? <div className="rd-edit">
      <AutoTextarea value={text || ''} aria-label={(target ? ctx.t('translation') : ctx.t('source')) + ' ' + segment.id}
        onChange={value => (target ? ctx.changeTarget : ctx.changeSource)(segment.id, value)} />
      {target && <button className="rd-mini" type="button" disabled={segment.status === 'translating'} onClick={() => ctx.retry(segment.id)}><IconSpark size={12}/>{ctx.t('retranslate')}</button>}
      {segment.aiBack && !target && <button className="rd-mini" type="button" onClick={() => ctx.undo(segment.id)}><IconUndo size={12}/>{ctx.t('undo')}</button>}
    </div> : <Tag className={'rd-para' + (ctx.markedIds.has(segment.id) ? ' marked' : '') + (!text ? ' pending' : '')}
      style={{ textAlign: block.align, fontWeight: emphatic ? 650 : undefined }}>
      {block.list && '• '}
      {originalRuns ? block.runs.map((run,i) => <span key={i} style={{ fontWeight: run.bold ? 650 : undefined, fontStyle: run.italic ? 'italic' : undefined, textDecoration: run.underline ? 'underline' : undefined, color: run.color }}>{run.text}</span>)
        : text || (segment.status === 'translating' ? ctx.t('translatingOne') : ctx.t(segment.status === 'error' ? 'translationFailed' : 'pending'))}
      {target && segment.stale && <small>{ctx.t('sourceChanged')}</small>}
    </Tag>)}
  </div>
}

function ContentBlock({ block, side, ctx }) {
  if (!block.rows) return <Paragraph block={block} side={side} ctx={ctx}/>
  return <div className="rd-table-wrap"><table><tbody>{block.rows.map((row,i) => <tr key={i}>{row.map((cell,j) =>
    <td key={j}>{cell.blocks.map((b,k) => <ContentBlock key={k} block={b} ctx={ctx} side={side}/>)}</td>)}</tr>)}</tbody></table></div>
}

function Sheet({ page, number, doc, side, ctx }) {
  const target = side === 'target'
  const nativePdf = page.pdf && !target && !ctx.editing
  const blocks = page.pdf ? page.ids.map(segId => ({ segId })) : page.blocks
  return <article className={'rd-sheet ' + side + (nativePdf ? ' raster' : '')} aria-label={ctx.t(target ? 'translation' : 'source') + ' · ' + number}>
    {nativePdf ? <PdfPage page={page.pdf} zoom={1} activeId={ctx.activeId} markedIds={ctx.markedIds} onActivate={ctx.onActivate} t={ctx.t}/>
      : <div className="rd-paper">
        <header>{doc.header || ctx.t(target ? 'translation' : 'source')}</header>
        <div className="rd-typeset">{blocks.map((block,index) => <ContentBlock block={block} key={block.segId || index} side={side} ctx={ctx}/>)}
          {!blocks.length && <p className="pending">{ctx.t('scanHint')}</p>}
        </div>
        <footer>{doc.footer && <span>{doc.footer}</span>}{number}</footer>
      </div>}
  </article>
}

function overlap(a,b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top }

// Use text lines rather than whole bounding paragraphs when quoting a rectangle.
function collectRegion(sheet, box) {
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
  const parts = []
  let first, last, previousNode, previousEnd = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement.closest('[data-seg]')
    if (!el || !overlap(el.getBoundingClientRect(),box)) continue
    const range = document.createRange()
    for (const match of node.textContent.matchAll(/[\u3400-\u9fff]|[^\s\u3400-\u9fff]+/gu)) {
      range.setStart(node,match.index); range.setEnd(node,match.index + match[0].length)
      if (!Array.from(range.getClientRects()).some(rect => overlap(rect,box))) continue
      if (!first) first = el.dataset.seg
      if (parts.length) {
        const gap = previousNode === node ? node.textContent.slice(previousEnd, match.index)
          : previousNode.textContent.slice(previousEnd) + node.textContent.slice(0,match.index)
        if (last !== el.dataset.seg) parts.push('\n')
        else if (/\s/u.test(gap)) parts.push(' ')
      }
      parts.push(match[0])
      previousNode = node
      previousEnd = match.index + match[0].length
      last = el.dataset.seg
    }
  }
  return { text: parts.join('').trim().slice(0,8000), segId: first }
}

export function ReadingView({ doc, pages, ctx, paired, zoom, viewportRef, bindViewport, onPage, onSelection, region, onRegion, onDismissSelection }) {
  React.useEffect(() => {
    if (paired && !region && !ctx.editing && viewportRef.current) {
      return trackPairedSelection(viewportRef.current)
    }
  }, [doc.docId, paired, region, ctx.editing, viewportRef])
  const frame = React.useRef(0)
  const start = React.useRef(null)
  const [rect, setRect] = React.useState(null)
  React.useEffect(() => () => cancelAnimationFrame(frame.current), [])
  React.useEffect(() => { start.current = null; setRect(null) }, [region, doc.docId])
  const scrolled = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = viewportRef.current
      if (!el) return
      const line = el.getBoundingClientRect().top + Math.min(150,el.clientHeight * .32)
      const rows = Array.from(el.querySelectorAll('.rd-spread'))
      const row = rows.find(row => row.getBoundingClientRect().bottom > line) || rows.at(-1)
      if (row) onPage(Number(row.dataset.page))
      onDismissSelection()
    })
  }
  function regionBox(event) {
    const a = start.current
    return {left: Math.min(a.x,event.clientX),top: Math.min(a.y,event.clientY),right: Math.max(a.x,event.clientX),bottom: Math.max(a.y,event.clientY)}
  }
  const stage = rect && viewportRef.current?.parentElement?.getBoundingClientRect()
  return <div ref={bindViewport} className={'rd-viewport' + (region ? ' region' : '')} onScroll={scrolled}
    onMouseUp={region ? undefined : onSelection} onKeyUp={region ? undefined : onSelection}
    onPointerDown={event => {
      if (!region || event.button !== 0) return
      const sheet = event.target.closest('.rd-sheet')
      if (!sheet) return
      event.preventDefault(); start.current = { x:event.clientX,y:event.clientY,sheet }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => { if (start.current) setRect(regionBox(event)) }}
    onPointerCancel={() => { start.current = null; setRect(null) }}
    onPointerUp={event => {
      if (!start.current) return
      const box = regionBox(event), sheet = start.current.sheet
      start.current = null; setRect(null)
      const quote = collectRegion(sheet,box)
      // Some WebViews restrict reading cross-origin rasters. Their selectable
      // text is still useful when pixels are unavailable.
      try { if (globalThis.__DSH_BILINGUAL__?.regionImages) quote.image = regionImage(sheet,box) } catch { quote.image = null }
      quote.page = Number(sheet.closest('.rd-spread')?.dataset.page) || 1
      onRegion(quote)
    }}>
    <div className={'rd-desk' + (paired ? ' paired' : '')} style={{'--scale': zoom}}>
      {pages.map((page,i) => <section className="rd-spread" data-page={i+1} key={i}>
        <Sheet page={page} number={i+1} doc={doc} side="source" ctx={ctx}/>
        {paired && <Sheet page={page} number={i+1} doc={doc} side="target" ctx={ctx}/>}
      </section>)}
    </div>
    {rect && stage && <div className="rd-crop" style={{left:rect.left-stage.left,top:rect.top-stage.top,width:rect.right-rect.left,height:rect.bottom-rect.top}}/>}
  </div>
}

