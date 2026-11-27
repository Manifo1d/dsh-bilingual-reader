import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply } from '../index.js'

const routes = []
let injectHandler
const calls = []
const attachment = {id:'test-screenshot'}
const ctx = {
  inject(deps,fn) {assert.deepEqual(deps,['attachments']);fn({effect:this.effect,attachments:{
    async saveImages(images) {assert.equal(images[0].mediaType,'image/jpeg');assert.ok(images[0].data.length);return [attachment]}
  }})},
  effect(fn) { const d = fn(); return d },
  on(event, fn) { if (event === 'webserver/index-inject') injectHandler = fn; return () => {} },
  webServer: {
    getOrigin: () => 'http://127.0.0.1:9999',
    register(route) { routes.push(route); return () => {} },
  },
  llm: {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    async *stream(options) {
      calls.push(options)
      const prompt = options.messages?.[0]?.content?.[0]?.text || ''
      let text
      if (options.system?.includes('plain text')) {
        text = 'T:'+prompt
      } else if (options.system?.includes('translator')) {
        const json = prompt.slice(prompt.lastIndexOf('['))
        const segments = JSON.parse(json)
        text = JSON.stringify(segments.map(segment => ({ id: segment.id, text: `T:${segment.text}` })))
      } else {
        text = '这是基于选段的回答。'
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) },
}
apply(ctx)
const table = []
injectHandler(table)
const token = table[0].value.token
console.log('token injected', Boolean(token), 'routes', routes.map(r => r.kind + ':' + r.path))

async function request(path, body, headers = { 'x-dsh-bilingual': token }) {
  const method = body === undefined ? 'GET' : 'POST'
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  Object.assign(req,{method,url:path,headers})
  const result = {}
  const res = {writeHead(status,headers) { Object.assign(result,{status,headers}) }, end(content) { result.body=content }}
  const route=routes.find(r => r.kind === 'exact' ? path === r.path : path.startsWith(r.path))
  await route.handler(req,res)
  return result
}
for (const kind of ['pdf','docx','txt']) {
  const name = 'sample.'+kind
  const result = await request('/dsh-bilingual/open',await readFile('test/'+name),{'x-dsh-bilingual':token,'x-filename':name})
  assert.equal(result.status,200)
  const doc=JSON.parse(result.body)
  assert.ok(doc.segments.length)
  if (kind==='pdf') {
    assert.ok(doc.pages[0].words.length)
    const image=await request(doc.pages[0].image)
    assert.equal(image.status,200);assert.ok(image.body.length>500)
  }
}
const post=async (path,body) => JSON.parse((await request('/dsh-bilingual/'+path,JSON.stringify(body))).body)
const translated=await post('translate',{direction:'zh-en',segments:[{id:'p1',text:'你好'}]})
assert.equal(translated.translations[0].text,'T:你好')
for (const [selection,context] of [['原句',''],['','正文']]) {
  const result=await post('ask',{question:'问题',selection,context,history:[{question:'之前的问题',answer:'之前的回答'}]})
  assert.equal(result.ok,true)
  assert.ok(calls.at(-1).messages[0].content[0].text.includes('之前的回答'))
}
const imageReply = await post('ask',{question:'图中有什么？',image:'data:image/jpeg;base64,/9j/2Q=='})
assert.equal(imageReply.ok,true)
assert.deepEqual(calls.at(-1).messages[0].content[1],{type:'image',attachment})
assert.equal((await post('ask',{question:'问题'})).ok,false)
assert.equal((await request('/dsh-bilingual/translate','{}',{})).status,403)
console.log('PASS host: DOCX, PDF raster and words, TXT, translation, question scopes, image block, follow-up history, token validation')
