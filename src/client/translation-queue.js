const BATCH_SIZE = 6
const BATCH_CHARS = 6000

export function needsTranslation(segment) {
  return Boolean(segment.text.trim()) && (!segment.target?.trim() || segment.stale)
}

// Copy number-only cells exactly, including scientific notation and grouping.
function isNumberCell(segment) {
  return segment.table && /^[+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+−-]?\d+)?%?$/.test(segment.text.trim())
}

function batches(segments) {
  const result = []
  let batch = [], chars = 0
  for (const segment of segments) {
    if (batch.length && (batch.length >= BATCH_SIZE || chars + segment.text.length > BATCH_CHARS)) {
      result.push(batch)
      batch = []
      chars = 0
    }
    batch.push(segment)
    chars += segment.text.length
  }
  if (batch.length) result.push(batch)
  return result
}

function temporary(error) {
  return error instanceof TypeError || [408,429,503,504].includes(error.status)
    || ['TIMEOUT','HTTP_429','HTTP_503','HTTP_504'].includes(error.code)
}

function backoff(signal, ms) {
  return new Promise((resolve,reject) => {
    signal.throwIfAborted()
    const abort = () => {clearTimeout(timer);reject(signal.reason)}
    const timer = setTimeout(() => {signal.removeEventListener('abort',abort);resolve()},ms)
    signal.addEventListener('abort',abort,{once:true})
  })
}

export async function runTranslationQueue(segments,{signal,request,start,accept,fail}) {
  const numeric = segments.filter(isNumberCell)
  if (numeric.length) accept(numeric,numeric.map(({id,text}) => ({id,text})))
  const singles = []
  async function attempt(batch) {
    signal.throwIfAborted()
    start(batch)
    let response
    for (let tries = 0; ; tries++) {
      try {
        response = await request(batch)
        break
      } catch (err) {
        signal.throwIfAborted()
        if (['BAD_MODEL_OUTPUT','EMPTY_MODEL_OUTPUT'].includes(err.code)) {
          if (batch.length > 1) singles.push(...batch)
          else fail(batch[0],err)
          return
        }
        if (tries >= 2 || !temporary(err)) throw err
        await backoff(signal,1000 * 2 ** tries)
      }
    }
    signal.throwIfAborted()
    const expected = new Set(batch.map(s => s.id))
    const valid = (response.translations || []).filter(item => expected.has(item.id) && typeof item.text === 'string' && item.text.trim())
    accept(batch,valid,response.model)
    const received = new Set(valid.map(item => item.id))
    for (const segment of batch) {
      if (received.has(segment.id)) continue
      if (batch.length === 1) fail(segment)
      else singles.push(segment)
    }
  }
  for (const batch of batches(segments.filter(s => !isNumberCell(s)))) await attempt(batch)
  // Single-passage requests use plain text, so a malformed JSON batch cannot
  // block subsequent passages or lose successful results from earlier ones.
  for (const segment of singles) await attempt([segment])
}
