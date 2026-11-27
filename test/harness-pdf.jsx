import assert from 'node:assert/strict'
import {regionImage} from '../src/client/region-image.js'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { indexedDB } from 'fake-indexeddb'
import { readFile } from 'node:fs/promises'
import { parsePdf } from '../lib/pdf.js'
import { saveLast } from '../src/client/store.js'
import { BilingualPage } from '../src/client/index.jsx'
import { zh } from '../src/client/locales.js'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:9999/', pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.indexedDB = indexedDB
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 20, right: 60, bottom: 40, width: 50, height: 20 })
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
globalThis.__DSH_BILINGUAL__ = { token: 'test-token', base: 'http://127.0.0.1:9999' }

const bytes = await readFile('test/sample.pdf')
const directory=await mkdtemp(join(tmpdir(),'reader-test-'))
const parsed=await parsePdf(bytes,'sample.pdf',directory)
await rm(directory,{recursive:true,force:true})
await saveLast({
  name: 'sample.pdf', size: bytes.length, kind: 'pdf', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  state: { direction: 'auto', autoSync: true, activeId: parsed.segments[0]?.id, zoom: 1, segments: [], qa: [], detectedDirection: 'en-zh' }, settings: {},
})
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname
  if (path.endsWith('/open')) return new Response(JSON.stringify({ ok: true, ...parsed }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (path.endsWith('/translate')) {
    const body = JSON.parse(options.body)
    return new Response(JSON.stringify({ ok: true, translations: body.segments.map(s => ({ id: s.id, text: `中文：${s.text}` })), model: 'mock' }), { status: 200 })
  }
  return new Response(JSON.stringify({ ok: false }), { status: 404 })
}
const t = (key, params) => {
  const value = zh[key] || key
  return params ? value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`)) : value
}
const container = document.getElementById('root')
const root = createRoot(container)
root.render(<BilingualPage t={t} />)
await new Promise(r => setTimeout(r, 500))
assert.equal(container.querySelector('.bi-title').textContent,'sample.pdf')
assert.ok(container.querySelector('.rd-sheet.target').textContent.includes('中文：'))
assert.equal(container.querySelectorAll('.bi-pdf-page').length,parsed.pages.length)
assert.ok(container.querySelectorAll('.bi-word').length)
container.querySelector('.bi-word').click()
await new Promise(r => setTimeout(r,60))
assert.ok(container.querySelector('.bi-word--active'))
// Exercise the class-based paint fallback on the PDF's transparent word layer.
const word = container.querySelector('.bi-word')
const id = word.dataset.seg
const target = container.querySelector('.target [data-seg="'+id+'"] .rd-para')
const selection = window.getSelection()
async function highlight(element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await new Promise(resolve => setTimeout(resolve,40))
}
await highlight(word)
assert.ok(target.classList.contains('rd-linked-selection'))
await highlight(target)
assert.ok(word.classList.contains('rd-linked-selection'))
assert.ok([...container.querySelectorAll('.bi-word.rd-linked-selection')].every(el=>el.dataset.seg===id))
assert.equal(target.classList.contains('rd-linked-selection'),false)
selection.removeAllRanges()
document.dispatchEvent(new Event('selectionchange'))
await new Promise(resolve => setTimeout(resolve,40))
assert.equal(container.querySelector('.rd-linked-selection'),null)
// Geometry contract for the crop at 2x source resolution. Pixel encoding is
// provided by the WebView canvas in production.
const source=container.querySelector('.rd-sheet')
const image=source.querySelector('img')
const bounds=() => ({left:20,top:30,right:420,bottom:630,width:400,height:600})
source.getBoundingClientRect=bounds;image.getBoundingClientRect=bounds
Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:800}})
let draw,output
dom.window.HTMLCanvasElement.prototype.getContext=() => ({scale(){},fillRect(){},drawImage(...args){draw=args}})
dom.window.HTMLCanvasElement.prototype.toDataURL=function(){output=[this.width,this.height];return 'data:image/jpeg;base64,/9j/2Q=='}
assert.ok(regionImage(source,{left:40,top:60,right:150,bottom:175}).startsWith('data:image/jpeg;'))
assert.deepEqual(output,[220,230])
assert.deepEqual(draw.slice(1),[-20,-30,400,600])
assert.equal(regionImage(source,{left:430,top:40,right:460,bottom:90}),null)
root.unmount()
console.log('PASS PDF reader: rendered pages, selectable positioned words active passage and clipped image coordinates')
