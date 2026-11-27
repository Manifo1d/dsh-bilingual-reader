/**
 * Host half of the bilingual document reader.
 *
 * It owns three concerns the browser cannot do alone:
 * - open an uploaded Word/PDF file and turn it into positioned preview blocks
 *   plus translation segments;
 * - call the configured Harness model for translation and document questions;
 * - serve the rasterized PDF pages from a short-lived local cache.
 *
 * The browser half talks to the named routes under `/dsh-bilingual`; a random
 * per-boot token injected into the page keeps other local web origins from
 * spending the user's model quota through this endpoint.
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { parseDocx } from './lib/docx.js'
import { parsePdf } from './lib/pdf.js'
import { answerQuestion, translateSegments } from './lib/llm.js'

const PREFIX = '/dsh-bilingual'
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024
const MAX_JSON_BYTES = 1024 * 1024
const MAX_TRANSLATE_SEGMENTS = 24
const MAX_TRANSLATE_CHARS = 24_000
const MAX_QUESTION_CHARS = 4_000
const MAX_SELECTION_CHARS = 8_000
const MAX_CONTEXT_CHARS = 12_000
const MAX_JOBS = 4

export const inject = ['webServer', 'llm', 'agentDefaultModel']

/**
 * Register the routes, the page token, and the temporary PDF cache.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const token = randomUUID()
  let attachments
  ctx.inject(['attachments'], scope => {
    const service = scope.attachments
    attachments = service
    scope.effect(() => () => { if (attachments === service) attachments = undefined })
  })
  /** @type {Map<string, {dir:string, createdAt:number}>} */
  const jobs = new Map()

  ctx.effect(() => ctx.on('webserver/index-inject', table => {
    let base
    try {
      base = ctx.webServer.getOrigin()
    } catch {
      base = undefined
    }
    table.push({
      kind: 'global',
      name: '__DSH_BILINGUAL__',
      value: { token, base, regionImages:true },
    })
  }), 'bilingual-reader: page token')

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/open`,
        handler: (req, res) => handleOpen(req, res, ctx, token, jobs),
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/translate`,
        handler: (req, res) => handleTranslate(req, res, ctx, token),
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/ask`,
        handler: (req, res) => handleAsk(req, res, ctx, token, attachments),
      }),
      ctx.webServer.register({
        kind: 'prefix',
        path: `${PREFIX}/asset`,
        handler: (req, res) => handleAsset(req, res, token, jobs),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      for (const job of jobs.values()) void rm(job.dir, { recursive: true, force: true })
      jobs.clear()
    }
  }, 'bilingual-reader: routes')
}

/* ------------------------------------------------------------- handlers */

async function handleOpen(req, res, ctx, token, jobs) {
  if (preflight(req, res)) return
  if (!authorized(req, res, token)) return
  if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '只接受 POST 请求。')

  let dir
  try {
    const buffer = await readBody(req, MAX_UPLOAD_BYTES)
    if (buffer.length === 0) throw httpError(400, 'EMPTY_FILE', '文件为空。')
    const filename = decodeFilename(req.headers['x-filename']) || 'document'
    const extension = extensionOf(filename)
    if (!['pdf', 'docx', 'txt', 'md', 'markdown'].includes(extension)) {
      throw httpError(415, 'UNSUPPORTED_FILE', '仅支持 .docx、.pdf、.txt 和 .md 文件。')
    }

    if (extension === 'pdf') {
      dir = await mkdtemp(join(tmpdir(), 'dsh-bilingual-'))
      const parsed = await parsePdf(buffer, filename, dir)
      const jobId = randomUUID().replace(/-/g, '').slice(0, 16)
      jobs.set(jobId, { dir, createdAt: Date.now() })
      await pruneJobs(jobs)
      dir = undefined
      for (const page of parsed.pages) {
        page.image = page.image
          ? `${PREFIX}/asset/${jobId}/${page.image}?t=${encodeURIComponent(token)}`
          : null
      }
      return sendJson(res, 200, { ok: true, ...parsed, jobId })
    }

    if (extension === 'docx') {
      const parsed = parseDocx(buffer, filename)
      return sendJson(res, 200, { ok: true, ...parsed })
    }

    const parsed = parsePlainText(buffer, filename)
    return sendJson(res, 200, { ok: true, ...parsed })
  } catch (error) {
    if (dir) void rm(dir, { recursive: true, force: true })
    return sendFailure(res, error)
  }
}

async function handleTranslate(req, res, ctx, token) {
  if (preflight(req, res)) return
  if (!authorized(req, res, token)) return
  if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '只接受 POST 请求。')
  try {
    const body = await readJson(req, MAX_JSON_BYTES)
    const segments = validateSegments(body.segments)
    const direction = body.direction
    const docTitle = typeof body.docTitle === 'string' ? body.docTitle.slice(0, 200) : ''
    const result = await translateSegments(ctx, { segments, direction, docTitle })
    return sendJson(res, 200, { ok: true, ...result })
  } catch (error) {
    return sendFailure(res, error)
  }
}

async function handleAsk(req, res, ctx, token, attachments) {
  if (preflight(req, res)) return
  if (!authorized(req, res, token)) return
  if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '只接受 POST 请求。')
  try {
    const body = await readJson(req, 2 * MAX_JSON_BYTES)
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) throw httpError(400, 'EMPTY_QUESTION', '问题不能为空。')
    if (question.length > MAX_QUESTION_CHARS) throw httpError(413, 'QUESTION_TOO_LONG', '问题太长。')
    const selection = typeof body.selection === 'string' ? body.selection.trim().slice(0, MAX_SELECTION_CHARS) : ''
    const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT_CHARS) : ''
    const docTitle = typeof body.docTitle === 'string' ? body.docTitle.slice(0, 200) : ''
    let attachment
    if (body.image) {
      const prefix = 'data:image/jpeg;base64,'
      if (typeof body.image !== 'string' || !body.image.startsWith(prefix) || body.image.length > 1500000) {
        throw httpError(400, 'INVALID_IMAGE', '截图格式无效或尺寸过大。')
      }
      if (!attachments) throw httpError(422, 'IMAGE_UNAVAILABLE', '当前 DSH 未启用图像附件服务，请改用划词提问。')
      const data = Buffer.from(body.image.slice(prefix.length),'base64')
      const refs = await attachments.saveImages([{ name:'reading-region.jpg', mediaType:'image/jpeg', data }])
      attachment = refs[0]
    }
    if (!attachment && !selection && !context.trim()) throw httpError(400, 'EMPTY_CONTEXT', '当前文档没有可供提问的文字。')
    const history = Array.isArray(body.history) ? body.history.slice(-4).map(item => ({
      question: String(item?.question || '').slice(0,500),
      answer: String(item?.answer || '').slice(0,1200),
      selection: String(item?.selection || '').slice(0,400),
    })) : []
    const result = await answerQuestion(ctx, { question, selection, context, docTitle, history, attachment })
    return sendJson(res, 200, { ok: true, ...result })
  } catch (error) {
    return sendFailure(res, error)
  }
}

async function handleAsset(req, res, token, jobs) {
  if (preflight(req, res)) return
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '只接受 GET 请求。')
  }
  const url = new URL(req.url, 'http://localhost')
  if (url.searchParams.get('t') !== token) {
    return sendError(res, 403, 'FORBIDDEN', '资源令牌无效。')
  }
  if (!url.pathname.startsWith(`${PREFIX}/asset/`)) {
    return sendError(res, 404, 'NOT_FOUND', '资源不存在。')
  }
  const rest = url.pathname.slice(`${PREFIX}/asset/`.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return sendError(res, 404, 'NOT_FOUND', '资源不存在。')
  const jobId = rest.slice(0, slash)
  const file = rest.slice(slash + 1)
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return sendError(res, 404, 'NOT_FOUND', '资源不存在。')
  const job = jobs.get(jobId)
  if (!job) return sendError(res, 404, 'NOT_FOUND', '预览已过期，请重新打开文档。')
  const target = normalize(join(job.dir, file))
  if (!target.startsWith(job.dir + sep)) return sendError(res, 404, 'NOT_FOUND', '资源不存在。')
  try {
    const info = await stat(target)
    if (!info.isFile()) return sendError(res, 404, 'NOT_FOUND', '资源不存在。')
    const bytes = await readFile(target)
    const headers = {
      'content-type': 'image/png',
      'content-length': String(bytes.length),
      'cache-control': 'private, max-age=3600',
      ...corsHeaders(),
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') res.end()
    else res.end(bytes)
  } catch {
    return sendError(res, 404, 'NOT_FOUND', '资源不存在。')
  }
}

/* --------------------------------------------------------------- input */

function validateSegments(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw httpError(400, 'EMPTY_SEGMENTS', '没有需要翻译的段落。')
  }
  if (value.length > MAX_TRANSLATE_SEGMENTS) {
    throw httpError(413, 'TOO_MANY_SEGMENTS', '一次提交的段落太多。')
  }
  let total = 0
  const segments = []
  for (const item of value) {
    const id = String(item?.id ?? '')
    const text = typeof item?.text === 'string' ? item.text : ''
    if (!id || !text.trim()) continue
    total += text.length
    if (total > MAX_TRANSLATE_CHARS) throw httpError(413, 'TEXT_TOO_LONG', '一次提交的文字太长。')
    segments.push({ id, text })
  }
  if (segments.length === 0) throw httpError(400, 'EMPTY_SEGMENTS', '没有需要翻译的段落。')
  return segments
}

function parsePlainText(buffer, filename) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (text.includes('\u0000')) throw httpError(415, 'UNSUPPORTED_FILE', '这个文件不是纯文本。')
  const paragraphs = text.split(/\n[ \t]*\n+/).map(part => part.trim()).filter(Boolean)
  if (paragraphs.length === 0) throw httpError(422, 'EMPTY_DOCUMENT', '文件没有可读取的文字。')
  const segments = []
  const blocks = []
  paragraphs.forEach((paragraph, index) => {
    const id = `t${index + 1}`
    segments.push({ id, text: paragraph, kind: 'paragraph' })
    blocks.push({
      type: 'p',
      blockIndex: index,
      segId: id,
      runs: [{ text: paragraph }],
      text: paragraph,
    })
  })
  return {
    kind: 'text',
    title: filename.replace(/\.(txt|md|markdown)$/i, ''),
    blocks,
    segments,
    warnings: [],
  }
}

/* --------------------------------------------------------------- utils */

function authorized(req, res, token) {
  if (req.headers['x-dsh-bilingual'] === token) return true
  sendError(res, 403, 'FORBIDDEN', '请求令牌无效，请刷新页面后重试。')
  return false
}

function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false
  res.writeHead(204, {
    ...corsHeaders(),
    'access-control-max-age': '600',
  })
  res.end()
  return true
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) reject(httpError(413, 'FILE_TOO_LARGE', `文件不能超过 ${Math.round(limit / 1024 / 1024)} MB。`))
      else resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

async function readJson(req, limit) {
  const buffer = await readBody(req, limit)
  if (buffer.length === 0) return {}
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw httpError(400, 'BAD_JSON', '请求格式无效。')
  }
}

function decodeFilename(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename)
  return match ? match[1].toLowerCase() : ''
}

async function pruneJobs(jobs) {
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    if (!oldest) break
    jobs.delete(oldest[0])
    await rm(oldest[1].dir, { recursive: true, force: true })
  }
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      jobs.delete(id)
      void rm(job.dir, { recursive: true, force: true })
    }
  }
}

function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function sendFailure(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL'
  const message = status >= 500 && !error?.status
    ? '服务内部错误，请重试。'
    : String(error?.message || '请求失败。')
  return sendJson(res, status, { ok: false, error: { code, message } })
}

function sendJson(res, status, value) {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    ...corsHeaders(),
  })
  res.end(body)
}

function sendError(res, status, code, message) {
  return sendJson(res, status, { ok: false, error: { code, message } })
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-dsh-bilingual,x-filename',
    'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
  }
}
