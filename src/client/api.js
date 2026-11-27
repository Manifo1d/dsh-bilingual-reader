/** Browser-side calls to the Host reader. */

export class ApiError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function boot() {
  return globalThis.__DSH_BILINGUAL__ || null
}

export function serviceAvailable() {
  const config = boot()
  return Boolean(config && typeof config.token === 'string' && config.token.length > 0)
}

function serviceBase() {
  const config = boot()
  const origin = typeof location !== 'undefined' ? location.origin : ''
  // Same-origin pages (ordinary Web and Desktop over HTTP) should not depend on
  // the advertised bind origin; a file:// page instead needs the injected
  // absolute origin.
  const base = /^https?:\/\//i.test(origin)
    ? origin
    : config?.base || origin
  if (!base || base === 'null') {
    throw new ApiError('本地解析服务不可用，请刷新页面后重试。', 'SERVICE_UNAVAILABLE')
  }
  return base.replace(/\/+$/, '')
}

function serviceToken() {
  const token = boot()?.token
  if (!token) throw new ApiError('本地服务令牌缺失，请刷新页面后重试。', 'SERVICE_UNAVAILABLE')
  return token
}

async function request(path, { method = 'POST', body, headers = {}, signal } = {}) {
  const response = await fetch(`${serviceBase()}/dsh-bilingual${path}`, {
    method,
    headers: {
      'x-dsh-bilingual': serviceToken(),
      ...headers,
    },
    body,
    signal,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError(
      response.ok ? '本地服务返回了无法解析的响应。' : `本地服务错误（HTTP ${response.status}）。`,
      'BAD_RESPONSE',
      response.status,
    )
  }
  if (!response.ok || payload.ok === false) {
    const message = payload?.error?.message || `请求失败（HTTP ${response.status}）`
    const code = payload?.error?.code || 'REQUEST_FAILED'
    throw new ApiError(message, code, response.status)
  }
  return payload
}

/**
 * Upload one document for parsing.
 * @param {string} name - original filename.
 * @param {ArrayBuffer} bytes - complete file.
 * @param {AbortSignal} [signal]
 */
export function openDocument(name, bytes, signal) {
  return request('/open', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-filename': encodeURIComponent(name),
    },
    body: bytes,
    signal,
  })
}

/**
 * Translate a batch of segments.
 * @param {{segments:{id:string,text:string}[], direction:'zh-en'|'en-zh', docTitle:string}} payload
 * @param {AbortSignal} [signal]
 */
export function translate(payload, signal) {
  return request('/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}

/**
 * Ask about a selected passage.
 * @param {{question:string, selection:string, context:string, docTitle:string}} payload
 * @param {AbortSignal} [signal]
 */
export function ask(payload, signal) {
  return request('/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}

/** Resolve a Host-relative image path (already carrying its token). */
export function assetUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${serviceBase()}${path}`
}
