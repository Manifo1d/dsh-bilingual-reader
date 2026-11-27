// Prefer nearby paragraphs for a quotation. For a long document, keep an
// outline and distribute the remaining budget across relevant reading pages.
export function questionContext(doc, pages, pageNumber, quote, question) {
  const items = doc.segments
  if (quote?.segId) {
    const index = items.findIndex(s => s.id === quote.segId)
    if (index >= 0) return items.slice(Math.max(0,index-2),index+3).map(s => s.text).join('\n\n').slice(0,10000)
  }
  const byId = new Map(items.map(s => [s.id,s]))
  const chunks = pages.map((page,i) => ({
    index:i, text:page.ids.map(id => byId.get(id)?.text).filter(Boolean).join('\n')
  })).filter(p => p.text)
  const label = p => '[p.' + (p.index+1) + '] '
  const full = chunks.map(p => label(p) + p.text).join('\n\n')
  if (full.length <= 11000) return full
  const words = question.toLowerCase().match(/[a-z0-9_-]{3,}|[\u3400-\u9fff]{2}/g) || []
  const scores = chunks.map(p => {
    const text = p.text.toLowerCase()
    return { ...p, score:words.reduce((n,w) => n + (text.includes(w) ? 1 : 0),0) + (p.index === pageNumber-1 ? .5 : 0) }
  }).sort((a,b) => b.score-a.score)
  const headings = items.filter(s => s.heading).map(s => s.text).join('\n').slice(0,1200)
  const overview = chunks.map(p => label(p) + p.text.slice(0,Math.max(36,Math.floor(3000/chunks.length)))).join('\n').slice(0,3500)
  return (headings + '\n' + overview + '\n' + scores.slice(0,5).map(p => label(p) + p.text.slice(0,1150)).join('\n\n')).slice(0,11000)
}
