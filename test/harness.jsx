import assert from 'node:assert/strict'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { indexedDB } from 'fake-indexeddb'
import { readFile } from 'node:fs/promises'
import { parseDocx } from '../lib/docx.js'
import { saveLast } from '../src/client/store.js'
import { counterpartOffsets } from '../src/client/paired-selection.js'
import { ChatDocumentPreview } from '../src/client/preview.jsx'
import { apply as registerReader } from '../src/client/entry.jsx'
import { BilingualPage } from '../src/client/index.jsx'
import { zh } from '../src/client/locales.js'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:9999/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
dom.window.Highlight = class extends Set {}
dom.window.CSS = {highlights:new Map()}
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.indexedDB = indexedDB
globalThis.requestAnimationFrame = callback => window.requestAnimationFrame(callback)
globalThis.cancelAnimationFrame = handle => window.cancelAnimationFrame(handle)
globalThis.CSS = {escape: String}
globalThis.NodeFilter = dom.window.NodeFilter
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
dom.window.HTMLElement.prototype.setPointerCapture = () => {}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 100, right: 150, bottom: 120, width: 50, height: 20 })
dom.window.HTMLElement.prototype.attachEvent = () => {}
dom.window.HTMLElement.prototype.detachEvent = () => {}
globalThis.__DSH_BILINGUAL__ = { token: 'test-token', base: 'http://127.0.0.1:9999' }

const bytes = await readFile('test/sample.docx')
const parsed = parseDocx(bytes, 'sample.docx')
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
await saveLast({
  name: 'sample.docx',
  size: bytes.length,
  kind: 'docx',
  bytes: buffer,
  state: { direction: 'auto', autoSync: true, activeId: parsed.segments[0].id, zoom: 1, segments: [{id:parsed.segments[0].id,target:"已校对译文"}], qa: [] },
  settings: {},
})

const requests = []
const translationRequests = []
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname
  if (path.endsWith('/open')) {
    return new Response(JSON.stringify({ ok: true, ...parsed }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/translate')) {
    const body = JSON.parse(options.body)
    translationRequests.push(body.segments.map(s => s.id))
    if (translationRequests.length === 1) {
      return new Response(JSON.stringify({ok:false,error:{code:'BAD_MODEL_OUTPUT',message:'Invalid translation batch'}}),{status:502})
    }
    return new Response(JSON.stringify({
      ok: true,
      translations: body.segments.map(segment => ({ id: segment.id, text: body.direction === 'en-zh' ? `REV: ${segment.text}` : `EN: ${segment.text}` })),
      model: 'mock/translator',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/ask')) {
    const body = JSON.parse(options.body);requests.push(body)
    return new Response(JSON.stringify({ ok: true, answer: `答案：${body.question}`, model: 'mock/qa' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({ ok: false, error: { message: 'not found' } }), { status: 404 })
}
globalThis.Response = Response

const t = (key, params) => {
  const value = zh[key] || key
  return params ? value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`)) : value
}

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<BilingualPage t={t} />)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
await wait(400)
const find = value => [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label')===value || b.textContent.trim()===value)
async function click(label) {const b=find(label); assert.ok(b,'Missing '+label);assert.equal(b.disabled,false);b.click();await wait(50)}
async function question(text) {
  const input=container.querySelector('.bi-ask-input')
  Simulate.change(input,{target:{value:text}});await wait(25)
  await click('发送');assert.ok(container.querySelector('.rd-thread').textContent.includes('答案：'+text))
}
assert.equal(container.querySelector('.bi-title').textContent,'sample.docx')
assert.ok(container.querySelector('.rd-sheet.source'))
assert.ok(container.querySelector('.rd-sheet.target').textContent.includes('已校对译文'))
assert.equal(translationRequests.flat().includes(parsed.segments[0].id),false)
assert.ok(translationRequests.some(batch => batch.length === 1))
assert.equal(container.querySelectorAll('.target .pending').length,0)
const completedCalls = translationRequests.length
assert.ok(container.querySelector('.rd-sheet.target').textContent.includes('EN:'))
await click('关闭翻译')
assert.equal(container.querySelector('.rd-sheet.target'),null)
await click('显示译文')
assert.equal(translationRequests.length,completedCalls)
// The native Selection must remain on the side being read. The other side
// receives separate paint ranges, including reverse drags and table cells.
const selection = window.getSelection()
const layer = () => Array.from(window.CSS.highlights.get('dsh-bilingual-counterpart') || [])
const bodyText = (side,id) => container.querySelector('.'+side+' [data-seg="'+id+'"] .rd-para').firstChild
const textNode = node => node.nodeType === 3 ? node : node.firstChild
async function select(a, start, b, end) {
  selection.setBaseAndExtent(textNode(a),start,textNode(b),end)
  document.dispatchEvent(new Event('selectionchange'))
  await wait(36)
}
const term = bodyText('source','p7')
await select(term,0,term,7)
assert.equal(layer().map(r=>r.toString()).join(''),'Harness')
assert.equal(layer()[0].startContainer.parentElement.closest('[data-seg]').dataset.seg,'p7')
assert.ok(layer().every(r=>r.startContainer.parentElement.closest('.target')))
assert.equal(selection.anchorNode,textNode(term))
const cellA = bodyText('target','p5'), cellB = bodyText('target','p6')
await select(cellB,textNode(cellB).length,cellA,0)
assert.deepEqual([...new Set(layer().map(r=>r.startContainer.parentElement.closest('[data-seg]').dataset.seg))],['p5','p6'])
assert.ok(layer().every(r=>r.startContainer.parentElement.closest('.source')))
selection.collapse(textNode(cellA),0)
document.dispatchEvent(new Event('selectionchange'))
await wait(36)
assert.equal(layer().length,0)
selection.removeAllRanges()
assert.equal(translationRequests.length,completedCalls)
const original='Two tests passed. Forces agree.'
const translated='两项测试通过。力一致。'
assert.equal(translated.slice(...counterpartOffsets(original,translated,18,24)), '力一致。')
assert.equal(original.slice(...counterpartOffsets(translated,original,7,9)), 'Forces agree.')
assert.deepEqual(counterpartOffsets('4 trials','40 次试验',0,1),[0,6])
const para=container.querySelector('.source [data-seg] .rd-para span')
const range=document.createRange();range.selectNodeContents(para)
window.getSelection().addRange(range)
para.dispatchEvent(new window.MouseEvent('mouseup',{bubbles:true}))
await wait(30);await click('提问');await question('这是什么意思？')
assert.equal(requests[0].selection,para.textContent)
await question('接着解释')
assert.equal(requests[1].history.at(-1).question,'这是什么意思？')
await click('收起问答')
await click('问问 DSH');await question('概括全文')
assert.ok(requests[2].context.includes(parsed.segments[0].text))
await click('收起问答')
// Drive the same drag handlers used in the desktop viewer, with controlled
// text geometry because jsdom has no layout engine.
const box={left:10,right:240,top:12,bottom:32,width:230,height:20}
const location=container.querySelector('.source [data-seg="p2"]')
location.getBoundingClientRect=() => box
dom.window.Range.prototype.getClientRects=() => [box]
await click('框选提问')
const view=container.querySelector('.rd-viewport')
Simulate.pointerDown(location,{button:0,clientX:10,clientY:12,pointerId:1})
Simulate.pointerMove(view,{clientX:240,clientY:32,pointerId:1})
Simulate.pointerUp(view,{clientX:240,clientY:32,pointerId:1})
await wait(30)
assert.equal(container.querySelector('.rd-quote span').textContent,location.textContent)
await question('解释框选的段落')
assert.equal(requests[3].selection,location.textContent)
await click('收起问答')
await click('更多选项')
const toggle=container.querySelector('input[aria-label="回写原文"]');toggle.click()
await click('编辑原文与译文')
const field=side => container.querySelector('.'+side+' [data-seg="p2"] textarea')
Simulate.change(field('target'),{target:{value:'Edited English'}});await wait(1400)
assert.equal(field('source').value,'REV: Edited English')
assert.equal(field('target').value,'Edited English')
await click('撤销')
assert.equal(field('source').value,parsed.segments.find(s => s.id==='p2').text)
Simulate.change(field('source'),{target:{value:'新的中文原文'}});await wait(1400)
assert.equal(field('target').value,'EN: 新的中文原文')
await click('完成编辑')
root.unmount()
const restored=createRoot(container);restored.render(<BilingualPage t={t}/>);await wait(350)
assert.ok(container.querySelector('.source [data-seg="p2"]').textContent.includes('新的中文原文'))
assert.ok(container.querySelector('.target [data-seg="p2"]').textContent.includes('EN: 新的中文原文'))
await click('问问 DSH')
assert.equal(container.querySelectorAll('.rd-thread article').length,4)
restored.unmount()
console.log('PASS client: paired reading, hide/show, word selection, rectangular selection and whole-document QA, follow-up, editing, back-translation, undo and restore')

const slots = new Map()
let renderer
const host = {
  locale: { register() {}, bind: () => t },
  slots: { inject: (_, run) => run(), register: (entry, component) => { slots.set(entry.key || entry.id, component) } },
  effect: run => run(),
  inject: (_, run) => run(host),
  documentPreviews: { register: def => { renderer = def } },
}
registerReader(host)
assert.equal(slots.get(renderer.id), ChatDocumentPreview)
assert.equal(renderer.priority, 'extension')
assert.equal(renderer.loading, 'bytes-complete')
assert.deepEqual(renderer.extensions, ['docx','pdf','txt','md','markdown'])
assert.deepEqual(renderer.binaryExtensions, ['pdf','docx'])

const previousFetch = globalThis.fetch
const opened = []
let releaseSlow
globalThis.fetch = async (url, options) => {
  if (!url.endsWith('/open')) return previousFetch(url, options)
  const source = new TextDecoder().decode(options.body)
  opened.push([decodeURIComponent(options.headers['x-filename']), source])
  if (source === 'slow') await new Promise(resolve => { releaseSlow = resolve })
  return Response.json({ ok:true, kind:'text', blocks:[{type:'p',segId:'p1',text:source,runs:[{text:source}]}],
    segments:[{id:'p1',text:source,page:1}] })
}
const quotes = []
const actions = { insertQuote(text, summary) { quotes.push({text, summary}); return true } }
const docRoot = createRoot(container)
const slowSource = new TextEncoder().encode('slow')
const newSource = new TextEncoder().encode('__Read from chat.__').subarray(2,17)
const originalTitle = '测试 #1.txt'
const resource = 'dsh-resource://file/session/one/path/'+encodeURIComponent(originalTitle)
const useResource = () => ({ value: {absolutePath:'/project/'+originalTitle} })
function preview(address, data) {
  docRoot.render(<ChatDocumentPreview resourceAddress={address} content={{kind:'bytes',data}} t={t}
    useResource={useResource} inputActions={actions}/>)
}
preview('dsh-resource://file/session/one/slow.txt', slowSource)
await wait(70)
assert.ok(releaseSlow)
preview(resource, newSource)
await wait(200)
releaseSlow()
await wait(80)
assert.deepEqual(opened, [['slow.txt','slow'],[originalTitle,'Read from chat.']])
assert.equal(container.querySelector('main').getAttribute('aria-label'), originalTitle)
assert.equal(container.querySelector('.rd-tabs'), null)
assert.equal(container.querySelector('input[type=file]'), null)
assert.ok(container.querySelector('.target').textContent.includes('Read from chat.'))
assert.equal(container.querySelector('.pending'), null)
await click('在当前对话提问')
assert.equal(quotes[0].text, '/project/'+originalTitle)
assert.equal(container.querySelector('.rd-chat'), null)
const paragraph = container.querySelector('.source [data-seg] .rd-para span')
const selected = document.createRange()
selected.selectNodeContents(paragraph)
window.getSelection().removeAllRanges()
window.getSelection().addRange(selected)
paragraph.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))
await wait(30)
await click('提问')
assert.ok(quotes[1].text.includes('Read from chat.'))
assert.ok(quotes[1].text.includes(t('page',{page:1})))
assert.equal(quotes[1].summary.title, originalTitle)
const callsBefore = translationRequests.length
preview(resource, newSource)
await wait(50)
assert.equal(opened.length,2)
preview('dsh-resource://file/session/two/folder/'+encodeURIComponent(originalTitle), newSource)
await wait(160)
assert.equal(translationRequests.length, callsBefore)
assert.equal(container.querySelector('main').getAttribute('aria-label'), originalTitle)
docRoot.unmount()
console.log('PASS session preview: native registration, exact selected bytes, stale opens, chat drafts, automatic translation and cache reuse')
