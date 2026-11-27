// The browser owns the user's selection. Only paint ranges in the other column,
// so copying, dragging the selection handles and quoting keep their native range.
const highlightName = 'dsh-bilingual-counterpart'
const bodySelector = '.rd-para:not(.pending), .bi-word'
const sentences = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, {granularity:'sentence'}) : null

function elementOf(node) {
  return node.nodeType === 1 ? node : node.parentElement
}

function textRuns(elements) {
  const runs = []
  let text = ''
  for (const element of elements) {
    const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.length || node.parentElement.closest('small')) continue
      runs.push({node, element, start:text.length, end:text.length + node.length})
      text += node.data
    }
  }
  return {text, runs}
}

function uniqueLiteral(haystack, needle) {
  if (!/[\p{L}\p{N}]/u.test(needle)) return -1
  const start = haystack.indexOf(needle)
  if (start < 0 || haystack.indexOf(needle, start + 1) >= 0) return -1
  // Do not match “4” inside “40”, or “ion” at the end of “translation”.
  const word = ch => !!ch && /[a-z0-9_]/i.test(ch)
  if (word(needle[0]) && word(haystack[start-1])) return -1
  if (word(needle.at(-1)) && word(haystack[start+needle.length])) return -1
  return start
}

// Both offsets refer to the displayed DOM text, including rich-text runs and
// the PDF word layer's inter-word spaces. Never project character percentages
// between languages: reordered phrases do not occupy corresponding positions.
export function counterpartOffsets(from, to, start, end) {
  if (from === to) return [start, end]
  const needle = from.slice(start,end).trim()
  let left = 0, right = to.length
  if (sentences) {
    const source = Array.from(sentences.segment(from))
    const target = Array.from(sentences.segment(to))
    if (source.length === target.length && source.length > 1) {
      const startTrimmed = start + from.slice(start,end).indexOf(needle)
      const endTrimmed = startTrimmed + needle.length
      const first = source.findIndex(s => s.index + s.segment.length > startTrimmed)
      const last = source.findIndex(s => s.index + s.segment.length >= endTrimmed)
      if (first >= 0 && last >= first) {
        left = target[first].index
        right = target[last].index + target[last].segment.length
      }
    }
  }
  const scope = to.slice(left,right)
  const match = uniqueLiteral(scope, needle)
  if (match >= 0) return [left+match, left+match+needle.length]
  return [left,right]
}

function groupBodies(sheet) {
  const groups = new Map()
  for (const element of sheet.querySelectorAll(bodySelector)) {
    const id = element.closest('[data-seg]')?.dataset.seg
    if (!id) continue
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(element)
  }
  return groups
}

function selectedOffsets(range, runs) {
  let first, last
  for (const run of runs) {
    if (!range.intersectsNode(run.node)) continue
    const a = range.startContainer === run.node ? range.startOffset : 0
    const b = range.endContainer === run.node ? range.endOffset : run.node.length
    if (a >= b || !run.node.data.slice(a,b).trim()) continue
    first ??= run.start+a
    last = run.start+b
  }
  return first === undefined ? null : [first,last]
}

function mirrorRanges(viewport, selection) {
  if (!selection?.rangeCount || selection.isCollapsed) return []
  const range = selection.getRangeAt(0)
  const firstSheet = elementOf(range.startContainer)?.closest('.rd-sheet')
  const lastSheet = elementOf(range.endContainer)?.closest('.rd-sheet')
  if (!firstSheet || !lastSheet || !viewport.contains(firstSheet) || !viewport.contains(lastSheet)) return []
  const side = firstSheet.classList.contains('source') ? 'source' : 'target'
  if (!lastSheet.classList.contains(side)) return []
  const counterpart = side === 'source' ? 'target' : 'source'
  const sheets = firstSheet === lastSheet ? [firstSheet] : viewport.querySelectorAll('.rd-sheet.' + side)
  const matches = []
  for (const sheet of sheets) {
    if (!range.intersectsNode(sheet)) continue
    const other = sheet.closest('.rd-spread').querySelector('.rd-sheet.' + counterpart)
    if (!other) continue
    const opposite = groupBodies(other)
    for (const [id,elements] of groupBodies(sheet)) {
      const partners = opposite.get(id)
      if (!partners || !elements.some(el => range.intersectsNode(el))) continue
      const origin = textRuns(elements)
      const offsets = selectedOffsets(range, origin.runs)
      if (!offsets) continue
      const target = textRuns(partners)
      const [start,end] = counterpartOffsets(origin.text, target.text, ...offsets)
      for (const {node,element,start:a,end:b} of target.runs) {
        if (start >= b || end <= a) continue
        const mirror = viewport.ownerDocument.createRange()
        mirror.setStart(node, Math.max(0,start-a))
        mirror.setEnd(node, Math.min(b,end)-a)
        matches.push({range:mirror, element})
      }
    }
  }
  return matches
}

export function trackPairedSelection(viewport) {
  const doc = viewport.ownerDocument
  const win = doc.defaultView
  const registry = win.CSS?.highlights
  const native = registry && typeof win.Highlight === 'function'
  let painted = []
  let frame = 0
  function clear() {
    const layer = native && registry.get(highlightName)
    for (const item of painted) {
      if (layer) layer.delete(item.range)
      else item.element.classList.remove('rd-linked-selection')
    }
    if (layer && !layer.size) registry.delete(highlightName)
    painted = []
  }
  function paint() {
    frame = 0
    clear()
    painted = mirrorRanges(viewport, win.getSelection())
    if (!painted.length) return
    if (native) {
      const layer = registry.get(highlightName) || new win.Highlight()
      for (const item of painted) layer.add(item.range)
      registry.set(highlightName, layer)
    } else {
      for (const item of painted) item.element.classList.add('rd-linked-selection')
    }
  }
  function schedule() {
    if (!frame) frame = win.requestAnimationFrame(paint)
  }
  // A translation can finish, or a PDF word layer can mount, mid-selection.
  const observer = new win.MutationObserver(() => {
    const selection = win.getSelection()
    if (painted.length || (selection && !selection.isCollapsed && viewport.contains(selection.anchorNode))) schedule()
  })
  observer.observe(viewport, {childList:true, subtree:true, characterData:true})
  doc.addEventListener('selectionchange', schedule)
  viewport.addEventListener('mouseup', schedule)
  viewport.addEventListener('keyup', schedule)
  schedule()
  return () => {
    observer.disconnect()
    doc.removeEventListener('selectionchange', schedule)
    viewport.removeEventListener('mouseup', schedule)
    viewport.removeEventListener('keyup', schedule)
    win.cancelAnimationFrame(frame)
    clear()
  }
}
