const DB_NAME = 'dsh-bilingual-reader'
const STORE = 'documents'
let connection
function database() {
  return connection ||= new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function access(mode,action) {
  const db = await database()
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,mode)
    let result
    action(tx.objectStore(STORE),value => {result = value})
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
}
const get = (store,key,done) => { const r = store.get(key); r.onsuccess = () => done(r.result) }
export async function fileKey(name,bytes) {
  const digest = await crypto.subtle.digest('SHA-256',bytes)
  return name + ':' + Array.from(new Uint8Array(digest),v => v.toString(16).padStart(2,'0')).join('')
}
export async function saveLast(record) {
  try {
    if (!record.fileKey) record = { ...record,fileKey:await fileKey(record.name,record.bytes) }
    const id = record.fileKey
    await access('readwrite',store => {
      store.put(record,'doc:'+id)
      store.put(record.state,'edit:'+id)
      store.put(id,'current')
      get(store,'recent',items => {
        const recent = [{id,name:record.name},...(items || []).filter(i => i.id !== id)]
        store.put(recent.slice(0,5),'recent')
      })
      store.delete('last');store.delete('state')
    })
    return true
  } catch {return false}
}
export async function saveState(state,settings,id) {
  if (!id) return false
  try { await access('readwrite',store => store.put(state,'edit:'+id));return true } catch {return false}
}
export async function recentFiles() {
  try { return await access('readonly',(store,done) => get(store,'recent',done)) || [] } catch {return []}
}
export async function loadLast(key) {
  try {
    return await access('readonly',(store,done) => {
      const read = id => {
        if (!id) {
          get(store,'last',doc => get(store,'state',old => done(doc && { ...doc,state:old?.state || doc.state })))
          return
        }
        get(store,'doc:'+id,doc => get(store,'edit:'+id,state => done(doc && { ...doc,state:state || doc.state })))
      }
      if (key) read(key); else get(store,'current',read)
    })
  } catch {return null}
}
