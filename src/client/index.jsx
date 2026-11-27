import * as React from 'react'
import {
  ApiError,
  ask as askApi,
  openDocument as openDocumentApi,
  serviceAvailable,
  translate as translateApi,
} from './api.js'
import { ReadingView, readingPages } from './reading-view.jsx'
import { AskFab, Conversation } from './qa.jsx'
import { needsTranslation, runTranslationQueue } from './translation-queue.js'
import { questionContext } from './context.js'
import { loadLast, saveLast, saveState, recentFiles, fileKey } from './store.js'
import { styles } from './styles.js'
import { IconClose, IconDoc, IconDownload, IconEdit, IconMinus, IconPlus,
  IconQuestion, IconSpark, IconTranslate, IconWarning, IconPanel, IconChevron } from './icons.jsx'

const MAX_FILE_BYTES = 40 * 1024 * 1024
const SYNC_DELAY_MS = 1100

export function BilingualPage({ t = key => key, previewFile, scrollportRef, addToDraft }) {
  const [doc, setDoc] = React.useState(null)
  const [phase, setPhase] = React.useState('idle')
  const [error, setError] = React.useState(null)
  const [notice, setNotice] = React.useState(null)
  const [direction, setDirection] = React.useState('auto')
  const [autoSync, setAutoSync] = React.useState(true)
  const [syncBack, setSyncBack] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [activeId, setActiveId] = React.useState(null)
  const [ask, setAsk] = React.useState(null)
  const [askBusy, setAskBusy] = React.useState(false)
  const [qaOpen, setQaOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(null)
  const [lastModel, setLastModel] = React.useState('')
  const [dragging, setDragging] = React.useState(false)
  const [paired, setPaired] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [menu, setMenu] = React.useState(null)
  const [outline, setOutline] = React.useState(false)
  const [region, setRegion] = React.useState(false)
  const [recent, setRecent] = React.useState([])
  const readerRef = React.useRef(null)
  const viewportRef = React.useRef(null)
  const bindViewport = React.useCallback(element => {
    viewportRef.current = element
    scrollportRef?.(element)
  }, [scrollportRef])
  const autoStartDoc = React.useRef(null)
  const pendingPosition = React.useRef(null)
  const openRequest = React.useRef(0)
  const latestState = React.useRef(null)
  const flush = () => {
    const record = latestState.current
    if (record) void saveState(record.state, {}, record.id)
  }

  const docRef = React.useRef(null)
  const askRef = React.useRef(null)
  const bytesRef = React.useRef(null)
  const fileInputRef = React.useRef(null)
  const translateAbortRef = React.useRef(null)
  const parseAbortRef = React.useRef(null)
  const translatingRef = React.useRef(false)
  const askBusyRef = React.useRef(false)
  const docEpochRef = React.useRef(0)
  const revisionsRef = React.useRef(new Map())
  const syncTimersRef = React.useRef(new Map())
  const dragDepthRef = React.useRef(0)
  const tRef = React.useRef(t)
  const autoSyncRef = React.useRef(autoSync)
  const syncBackRef = React.useRef(syncBack)
  const directionRef = React.useRef('zh-en')
  const activeIdRef = React.useRef(activeId)
  const editingRef = React.useRef(editing)

  tRef.current = t
  autoSyncRef.current = autoSync
  syncBackRef.current = syncBack
  activeIdRef.current = activeId
  editingRef.current = editing
  askRef.current = ask

  const resolvedDirection = React.useMemo(
    () => (direction === 'auto' ? (doc?.detectedDirection || 'zh-en') : direction),
    [direction, doc?.detectedDirection],
  )
  directionRef.current = resolvedDirection

  const markedIds = React.useMemo(
    () => new Set((doc?.qa || []).map(item => item.segId).filter(Boolean)),
    [doc?.qa],
  )
  const total = doc?.segments.filter(s => s.text.trim()).length ?? 0
  const translatedCount = doc?.segments.filter(segment => segment.target?.trim()).length ?? 0
  const pages = React.useMemo(() => readingPages(doc), [doc?.docId])
  const byId = React.useMemo(() => new Map((doc?.segments || []).map(s => [s.id,s])), [doc?.segments])
  if (doc) latestState.current = {id:doc.fileKey,state:{...serializeState(doc,direction,autoSync,syncBack,activeId,zoom),page,paired}}
  const remaining = doc?.segments.filter(needsTranslation).length ?? 0
  const allTranslated = total > 0 && remaining === 0
  const available = serviceAvailable()

  const patchDoc = React.useCallback(updater => {
    setDoc(previous => {
      if (!previous) return previous
      const next = updater(previous)
      docRef.current = next
      return next
    })
  }, [])

  const setSegment = React.useCallback((id, patch) => {
    patchDoc(previous => ({
      ...previous,
      segments: previous.segments.map(segment => (segment.id === id ? { ...segment, ...patch } : segment)),
    }))
  }, [patchDoc])

  const bumpRevision = React.useCallback(id => {
    const next = (revisionsRef.current.get(id) || 0) + 1
    revisionsRef.current.set(id, next)
    return next
  }, [])

  const clearSyncTimers = React.useCallback(() => {
    for (const timer of syncTimersRef.current.values()) window.clearTimeout(timer)
    syncTimersRef.current.clear()
  }, [])

  const messageFor = React.useCallback(errorValue => {
    const tr = tRef.current
    if (!errorValue) return tr('parseFailed')
    if (errorValue.code === 'PDF_TOOL_MISSING') return tr('poppler')
    if (errorValue.code === 'FILE_TOO_LARGE') return tr('fileTooLarge')
    if (errorValue.code === 'UNSUPPORTED_FILE') return tr('unsupported')
    if (errorValue.code === 'SERVICE_UNAVAILABLE') {
      return typeof errorValue.message === 'string' ? errorValue.message : tr('parseFailed')
    }
    return errorValue.message || tr('parseFailed')
  }, [])

  /** Replace the workbench with a freshly parsed document. */
  const loadDocument = React.useCallback(async (name, bytes, savedState, restoring, id, request) => {
    if (!serviceAvailable()) {
      throw new ApiError('本地解析服务不可用，请刷新页面后重试。', 'SERVICE_UNAVAILABLE')
    }
    flush()
    const epoch = ++docEpochRef.current
    parseAbortRef.current?.abort()
    const parser = new AbortController()
    parseAbortRef.current = parser
    translateAbortRef.current?.abort()
    clearSyncTimers()
    setAskBusy(false); askBusyRef.current = false
    translatingRef.current = false
    setBusy(null)
    setPhase(restoring ? 'restoring' : 'parsing')
    setError(null)
    setNotice(null)
    try {
      const parsed = await openDocumentApi(name, bytes, parser.signal)
      if (epoch !== docEpochRef.current || request !== openRequest.current) return
      const segments = mergeSegments(parsed.segments || [], savedState?.segments)
      const qa = Array.isArray(savedState?.qa)
        ? savedState.qa.filter(item => item && item.status !== 'loading').slice(0, 100)
        : []
      const next = {
        ...parsed,
        docId: makeId(), fileKey:id,
        name,
        size: bytes.byteLength ?? bytes.length ?? 0,
        segments,
        sourceRevision: 0,
        translationPaused: savedState?.translationPaused === true,
        detectedDirection: savedState?.detectedDirection === 'zh-en' || savedState?.detectedDirection === 'en-zh'
          ? savedState.detectedDirection
          : detectDirection(segments),
        qa,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      }
      const nextActive = savedState?.activeId && segments.some(segment => segment.id === savedState.activeId)
        ? savedState.activeId
        : segments[0]?.id ?? null
      const nextDirection = savedState?.direction === 'zh-en' || savedState?.direction === 'en-zh'
        ? savedState.direction
        : 'auto'
      const nextAutoSync = savedState?.autoSync !== false
      const nextSyncBack = savedState?.syncBack === true
      const nextZoom = typeof savedState?.zoom === 'number' ? clamp(savedState.zoom, 0.6, 2.2) : 1
      docRef.current = next
      bytesRef.current = bytes
      revisionsRef.current.clear()
      clearSyncTimers()
      setDoc(next)
      setActiveId(nextActive)
      setDirection(nextDirection)
      setAutoSync(nextAutoSync)
      setSyncBack(nextSyncBack)
      setZoom(nextZoom)
      setEditing(false)
      const startPaired = savedState?.paired ?? true
      autoStartDoc.current = !next.translationPaused && segments.some(needsTranslation) ? next.docId : null
      setPaired(startPaired)
      const startPage = Math.min(readingPages(next).length || 1, Math.max(1,Number(savedState?.page) || 1))
      pendingPosition.current = startPage
      setPage(startPage)
      setOutline(false); setRegion(false); setMenu(null)
      setQaOpen(false)
      setAsk(null)
      setLastModel('')
      if (next.warnings.length > 0) setNotice(next.warnings.join(' '))
      void saveLast({
        name, fileKey:id,
        size: next.size,
        kind: next.kind,
        bytes,
        state: {...serializeState(next, nextDirection, nextAutoSync, nextSyncBack, nextActive, nextZoom), page:startPage, paired:startPaired},
        settings: { direction: nextDirection, autoSync: nextAutoSync, syncBack: nextSyncBack },
      }).then(async ok => {
        if (epoch !== docEpochRef.current) return
        if (ok) setRecent(await recentFiles())
        else setNotice(tRef.current('cacheFailed'))
      })
    } finally {
      if (epoch === docEpochRef.current) setPhase('idle')
    }
  }, [clearSyncTimers])

  const openFile = React.useCallback(async file => {
    if (!file) return
    if (!/\.(docx|pdf|txt|md|markdown)$/i.test(file.name)) {
      setError({ message: tRef.current('unsupported') })
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setPhase('idle')
      setError({ message: tRef.current('fileTooLarge') })
      return
    }
    const request = ++openRequest.current
    try {
      const bytes = await file.arrayBuffer()
      const id = await fileKey(file.name,bytes)
      const record = await loadLast(id)
      if (request !== openRequest.current) return
      const saved = latestState.current?.id === id ? latestState.current.state : record?.state
      await loadDocument(file.name,bytes,saved,false,id,request)
    } catch (err) {
      if (request === openRequest.current) {setError({ message:messageFor(err) });setPhase('idle')}
    }
  }, [loadDocument,messageFor])

  const openRecent = async id => {
    setMenu(null)
    if (docRef.current?.fileKey === id) return
    const request = ++openRequest.current
    try {
      const record = await loadLast(id)
      if (request !== openRequest.current) return
      if (!record) throw new Error(t('cacheMissing'))
      await loadDocument(record.name,record.bytes,record.state,false,id,request)
    } catch (err) { if (request === openRequest.current) setError({message:messageFor(err)}) }
  }

  const goPage = React.useCallback(number => {
    const node = viewportRef.current?.querySelector('.rd-spread[data-page="' + number + '"]')
    node?.scrollIntoView?.({block:'start',inline:'nearest'})
    setPage(number)
  }, [])
  React.useLayoutEffect(() => {
    if (!doc || pendingPosition.current === null) return
    goPage(pendingPosition.current);pendingPosition.current = null
  },[doc?.docId,goPage])

  const activate = React.useCallback((id, mode = false) => {
    if (!id) return
    setActiveId(id)
    if (mode !== 'both') return
    const area = viewportRef.current
    const seg = area?.querySelector('.source [data-seg="' + CSS.escape(id) + '"]')
    if (seg) seg.scrollIntoView?.({block:'center',inline:'nearest'})
    else {
      const num = docRef.current?.segments.find(s => s.id === id)?.page
      if (num) goPage(num)
    }
  }, [goPage])

  const scheduleSync = React.useCallback((id, from) => {
    const existing = syncTimersRef.current.get(id)
    if (existing) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      syncTimersRef.current.delete(id)
      const run = from === 'target' ? syncFromTargetRef.current : syncFromSourceRef.current
      void run(id)
    }, SYNC_DELAY_MS)
    syncTimersRef.current.set(id, timer)
  }, [])

  const handleSourceChange = React.useCallback((id, value) => {
    bumpRevision(id)
    patchDoc(previous => ({
      ...previous,
      sourceRevision: (previous.sourceRevision || 0) + 1,
      segments: previous.segments.map(segment => (segment.id === id
        ? { ...segment, text: value, aiBack: false, sourceOriginal: undefined, stale: Boolean(segment.target?.trim()), status: segment.status === 'translating' ? 'idle' : segment.status }
        : segment)),
    }))
    if (autoSyncRef.current) scheduleSync(id, 'source')
  }, [bumpRevision, patchDoc, scheduleSync])

  const handleTargetChange = React.useCallback((id, value) => {
    bumpRevision(id)
    patchDoc(previous => ({
      ...previous,
      segments: previous.segments.map(segment => (segment.id === id
        ? { ...segment, target: value, stale: false, editedTarget: true, status: value.trim() ? 'done' : 'idle' }
        : segment)),
    }))
    if (autoSyncRef.current && syncBackRef.current && value.trim()) scheduleSync(id, 'target')
  }, [bumpRevision, patchDoc, scheduleSync])

  const translateAll = React.useCallback(async (allowRetranslate = false) => {
    const current = docRef.current
    if (!current || translatingRef.current) return
    const pending = current.segments.filter(needsTranslation)
    if (!pending.length && !allowRetranslate) return
    const targets = pending.length ? pending : current.segments.filter(s => s.text.trim())
    if (!targets.length) return
    if (!pending.length && !window.confirm(tRef.current('confirmRetranslate'))) return
    const epoch = docEpochRef.current
    const controller = new AbortController()
    const direction = directionRef.current
    translateAbortRef.current = controller
    translatingRef.current = true
    const total = current.segments.filter(s => s.text.trim()).length
    let done = total - targets.length
    let failures = 0
    const update = updater => {
      if (docEpochRef.current === epoch) patchDoc(prev => prev.docId === current.docId ? updater(prev) : prev)
    }
    setBusy({done,total})
    setError(null)
    setNotice(null)
    update(prev => ({...prev,translationPaused:false}))
    try {
      await runTranslationQueue(targets,{
        signal:controller.signal,
        request:batch => translateApi({segments:batch.map(({id,text}) => ({id,text})), direction, docTitle:current.name},controller.signal),
        start:batch => {
          const ids = new Set(batch.map(s => s.id))
          update(prev => ({...prev,segments:prev.segments.map(s => ids.has(s.id) ? {...s,status:'translating'} : s)}))
        },
        accept:(batch,translations,model) => {
          const before = new Map(batch.map(s => [s.id,s]))
          const results = new Map(translations.map(item => [item.id,item.text]))
          update(prev => ({...prev,segments:prev.segments.map(s => {
            const old = before.get(s.id)
            if (!old) return s
            if (old.text === s.text && old.target === s.target && results.has(s.id)) {
              return {...s,target:results.get(s.id),status:'done',stale:false,editedTarget:false}
            }
            return s.status === 'translating' ? {...s,status:s.target ? 'done' : 'idle'} : s
          })}))
          if (docEpochRef.current === epoch) {
            if (model) setLastModel(model)
            done += translations.length
            setBusy({done,total})
          }
        },
        fail:segment => {
          failures++
          update(prev => ({...prev,segments:prev.segments.map(s => s.id === segment.id && s.text === segment.text && s.target === segment.target ? {...s,status:'error'} : s)}))
        },
      })
      if (failures && docEpochRef.current === epoch) setNotice(tRef.current('partial',{count:failures}))
    } catch (err) {
      if (docEpochRef.current === epoch && !controller.signal.aborted) setError({message:messageFor(err)})
    } finally {
      update(prev => ({...prev,segments:prev.segments.map(s =>
        s.status === 'translating' ? {...s,status:s.target?.trim() ? 'done' : 'idle'} : s)}))
      if (translateAbortRef.current === controller) {
        translateAbortRef.current = null
        translatingRef.current = false
        setBusy(null)
      }
    }
  }, [messageFor, patchDoc])

  React.useEffect(() => {
    if (!available || phase !== 'idle' || !doc || autoStartDoc.current !== doc.docId) return
    autoStartDoc.current = null
    void translateAll()
  }, [doc?.docId,phase,available,translateAll])

  const translateOne = React.useCallback(async id => {
    const current = docRef.current
    const segment = current?.segments.find(item => item.id === id)
    if (!current || !segment?.text.trim()) return
    const epoch = docEpochRef.current
    const revision = bumpRevision(id)
    setSegment(id, { status: 'translating' })
    try {
      const response = await translateApi({
        segments: [{ id, text: segment.text }],
        direction: directionRef.current,
        docTitle: current.name,
      })
      if (epoch !== docEpochRef.current || revisionsRef.current.get(id) !== revision) return
      const translation = (response.translations || []).find(item => item.id === id)
      if (!translation) {
        setSegment(id, { status: 'error' })
        return
      }
      setSegment(id, { target: translation.text, status: 'done', stale: false, editedTarget: false })
      if (response.model) setLastModel(response.model)
    } catch (errorValue) {
      if (epoch === docEpochRef.current && revisionsRef.current.get(id) === revision) {
        setSegment(id, { status: 'error' })
        setError({ message: messageFor(errorValue) })
      }
    }
  }, [bumpRevision, messageFor, setSegment])

  const syncFromSource = React.useCallback(async id => {
    const current = docRef.current
    const segment = current?.segments.find(item => item.id === id)
    if (!current || !segment?.text.trim()) return
    const epoch = docEpochRef.current
    const revision = revisionsRef.current.get(id)
    setSegment(id, { status: 'translating' })
    try {
      const response = await translateApi({
        segments: [{ id, text: segment.text }],
        direction: directionRef.current,
        docTitle: current.name,
      })
      if (epoch !== docEpochRef.current || revisionsRef.current.get(id) !== revision) return
      const translation = (response.translations || []).find(item => item.id === id)
      if (!translation) {
        setSegment(id, { status: 'error' })
        return
      }
      setSegment(id, { target: translation.text, status: 'done', stale: false, editedTarget: false })
      if (response.model) setLastModel(response.model)
    } catch {
      if (epoch === docEpochRef.current && revisionsRef.current.get(id) === revision) {
        setSegment(id, { status: 'error' })
      }
    }
  }, [setSegment])

  const syncFromTarget = React.useCallback(async id => {
    if (!syncBackRef.current) return
    const current = docRef.current
    const segment = current?.segments.find(item => item.id === id)
    const target = segment?.target?.trim()
    if (!current || !target) return
    const epoch = docEpochRef.current
    const revision = revisionsRef.current.get(id)
    const reverse = directionRef.current === 'zh-en' ? 'en-zh' : 'zh-en'
    setSegment(id, { status: 'translating' })
    try {
      const response = await translateApi({
        segments: [{ id, text: target }],
        direction: reverse,
        docTitle: current.name,
      })
      if (epoch !== docEpochRef.current || revisionsRef.current.get(id) !== revision) return
      if (!syncBackRef.current) return
      const translation = (response.translations || []).find(item => item.id === id)
      if (!translation) {
        setSegment(id, { status: 'error' })
        return
      }
      patchDoc(previous => ({
        ...previous,
        sourceRevision: (previous.sourceRevision || 0) + 1,
        segments: previous.segments.map(item => (item.id === id
          ? {
              ...item,
              text: translation.text,
              sourceOriginal: item.sourceOriginal ?? segment.text,
              aiBack: true,
              status: 'done',
              stale: false,
            }
          : item)),
      }))
      if (response.model) setLastModel(response.model)
      if (docRef.current?.kind === 'pdf' && !editingRef.current) setNotice(tRef.current('aiBackNotice'))
    } catch {
      if (epoch === docEpochRef.current && revisionsRef.current.get(id) === revision) {
        setSegment(id, { status: 'error' })
      }
    }
  }, [patchDoc, setSegment])

  const syncFromSourceRef = React.useRef(syncFromSource)
  const syncFromTargetRef = React.useRef(syncFromTarget)
  syncFromSourceRef.current = syncFromSource
  syncFromTargetRef.current = syncFromTarget

  const restoreSource = React.useCallback(id => {
    bumpRevision(id)
    patchDoc(previous => ({
      ...previous,
      sourceRevision: (previous.sourceRevision || 0) + 1,
      segments: previous.segments.map(segment => (segment.id === id && segment.sourceOriginal !== undefined
        ? { ...segment, text: segment.sourceOriginal, sourceOriginal: undefined, aiBack: false, stale: Boolean(segment.target?.trim()) }
        : segment)),
    }))
  }, [bumpRevision, patchDoc])

  const handleSelectionEnd = React.useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (!text) return
    const range = selection.getRangeAt(0)
    let element = range.startContainer
    if (element.nodeType === Node.TEXT_NODE) element = element.parentElement
    const segElement = element?.closest?.('[data-seg]') || element?.querySelector?.('[data-seg]')
    const rect = range.getBoundingClientRect()
    if (!segElement && rect.width === 0) return
    if (!viewportRef.current?.contains(range.commonAncestorContainer) || !segElement || !rect.width) return
    setAsk({
      segId: segElement?.dataset?.seg || null,
      text: text.slice(0, 2000),
      page: Number(segElement.closest('[data-page]')?.dataset.page) || 1,
      x: rect.left + rect.width / 2 - readerRef.current.getBoundingClientRect().left,
      y: rect.bottom - readerRef.current.getBoundingClientRect().top,
      open: false,
    })
  }, [])

  const submitAsk = React.useCallback(async question => {
    const currentAsk = askRef.current?.open ? askRef.current : null
    const current = docRef.current
    if (!current || askBusyRef.current) return
    const id = makeId()
    const epoch = docEpochRef.current
    const entry = {
      id,
      segId: currentAsk?.segId || null,
      selection: currentAsk?.text || '',
      imagePage: currentAsk?.image ? currentAsk.page : undefined,
      question,
      answer: '',
      status: 'loading',
      at: Date.now(),
    }
    askBusyRef.current = true
    setAskBusy(true)
    patchDoc(previous => ({ ...previous, qa: [entry, ...previous.qa] }))
    setAsk(null)
    setQaOpen(true)
    try {
      const response = await askApi({
        question,
        selection: currentAsk?.text || '',
        image: currentAsk?.image || undefined,
        context: questionContext(current,pages,page,currentAsk,question),
        history: current.qa.filter(item => item.status === 'done').slice(0,4).reverse().map(item => ({question:item.question,answer:item.answer,selection:item.selection})),
        docTitle: current.name,
      })
      if (epoch !== docEpochRef.current) return
      patchDoc(previous => ({
        ...previous,
        qa: previous.qa.map(item => (item.id === id
          ? { ...item, answer: response.answer, status: 'done', model: response.model }
          : item)),
      }))
      if (response.model) setLastModel(response.model)
    } catch (errorValue) {
      if (epoch !== docEpochRef.current) return
      patchDoc(previous => ({
        ...previous,
        qa: previous.qa.map(item => (item.id === id
          ? { ...item, answer: messageFor(errorValue), status: 'error' }
          : item)),
      }))
    } finally {
      if (epoch === docEpochRef.current) {askBusyRef.current = false;setAskBusy(false)}
    }
  }, [messageFor, patchDoc,page,pages])

  const deleteQa = React.useCallback(id => {
    patchDoc(previous => ({ ...previous, qa: previous.qa.filter(item => item.id !== id) }))
  }, [patchDoc])

  const exportMarkdown = React.useCallback(() => {
    const current = docRef.current
    if (!current) return
    const lines = [
      `# ${current.name}`,
      '',
      `> ${tRef.current('direction')}: ${directionLabel(directionRef.current, tRef.current)}`,
      '',
    ]
    current.segments.forEach((segment, index) => {
      lines.push(`## ${index + 1}`)
      lines.push('')
      lines.push(`**${tRef.current('original')}**`)
      lines.push('')
      lines.push(segment.text)
      lines.push('')
      lines.push(`**${tRef.current('translation')}**`)
      lines.push('')
      lines.push(segment.target || '')
      lines.push('')
      lines.push('---')
      lines.push('')
    })
    if (current.qa.length > 0) {
      lines.push(`# ${tRef.current('qa')}`)
      lines.push('')
      for (const item of current.qa) {
        if (item.imagePage) lines.push('> '+tRef.current('imageQuote',{page:item.imagePage}))
        if (item.selection) lines.push(`> ${item.selection.replace(/\n/g, '\n> ')}`)
        lines.push('')
        lines.push(`**Q:** ${item.question}`)
        lines.push('')
        lines.push(`**A:** ${item.answer}`)
        lines.push('')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${current.name.replace(/\.[^.]+$/, '')}.bilingual.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    if (previewFile) {
      flush()
      latestState.current = null
      docEpochRef.current++
      translateAbortRef.current?.abort()
      clearSyncTimers()
      docRef.current = null
      setDoc(null)
      setError(null)
      setPhase('parsing')
      void openFile(previewFile)
      return () => { openRequest.current++; parseAbortRef.current?.abort() }
    }
    async function restore() {
      if (!serviceAvailable()) {
        setPhase('idle')
        return
      }
      const request = openRequest.current
      const record = await loadLast()
      if (cancelled || request !== openRequest.current) return
      if (!record?.bytes) {
        setPhase('idle')
        return
      }
      try {
        const id = record.fileKey || await fileKey(record.name,record.bytes)
        if (cancelled || request !== openRequest.current) return
        await loadDocument(record.name,record.bytes,record.state,true,id,request)
      } catch (errorValue) {
        if (!cancelled) {
          setError({ message: messageFor(errorValue) })
          setPhase('idle')
        }
      }
    }
    void restore()
    return () => { cancelled = true; openRequest.current++; parseAbortRef.current?.abort() }
  }, [clearSyncTimers, loadDocument, messageFor, openFile, previewFile])

  React.useEffect(() => {
    if (!doc || !bytesRef.current) return undefined
    const timer = window.setTimeout(flush,250)
    return () => window.clearTimeout(timer)
  }, [doc,direction,autoSync,syncBack,activeId,zoom,page,paired])

  React.useEffect(() => {
    window.addEventListener('pagehide',flush)
    return () => { window.removeEventListener('pagehide',flush);flush();docEpochRef.current++ }
  }, [])

  React.useEffect(() => {
    if (autoSync) return
    clearSyncTimers()
  }, [autoSync, clearSyncTimers])

  React.useEffect(() => {
    docRef.current = doc
  }, [doc])

  React.useEffect(() => () => {
    translateAbortRef.current?.abort()
    clearSyncTimers()
  }, [clearSyncTimers])

  React.useEffect(() => {
    if (!ask || ask.open) return undefined
    const onPointerDown = event => {
      if (event.target.closest?.('.bi-ask-fab') || event.target.closest?.('.bi-ask-pop')) return
      setAsk(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [ask])

  React.useEffect(() => {
    const escape = e => {
      if (e.key !== 'Escape' || e.isComposing) return
      if (menu) setMenu(null)
      else if (region) setRegion(false)
      else if (qaOpen) { setQaOpen(false);setAsk(null) }
      else if (ask) setAsk(null)
      else setOutline(false)
    }
    const outside = e => { if (!e.target.closest?.('.rd-menu-wrap')) setMenu(null) }
    document.addEventListener('keydown',escape)
    if (menu) document.addEventListener('pointerdown',outside)
    return () => {document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside)}
  }, [menu,region,qaOpen,ask])
  const cancelTranslation = () => {
    patchDoc(prev => ({...prev,translationPaused:true}))
    setNotice(t('translationCancelled'))
    translateAbortRef.current?.abort()
  }

  const handleOpenClick = () => fileInputRef.current?.click()

  const onDragEnter = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragging(true)
  }
  const onDragOver = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }
  const onDrop = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void openFile(file)
  }

  const startTranslation = () => {
    setPaired(true)
    if (remaining && !doc.translationPaused && !busy && available) void translateAll()
  }
  const setView = fn => {const here=page; fn();requestAnimationFrame(() => goPage(here))}
  const closeChat = () => {setQaOpen(false);setAsk(null)}
  const showChat = quote => {
    setRegion(false)
    setMenu(null)
    if (addToDraft && !quote?.image) {
      if (addToDraft(quote?.text, quote?.page || page)) setAsk(null)
      else setNotice(t('composerBusy'))
      return
    }
    setAsk(quote ? {...quote,open:true} : null)
    setQaOpen(true)
  }
  const ctx = { byId, media:doc?.media, activeId, markedIds, editing:editing && 'both', onActivate:activate,
    changeSource:handleSourceChange,changeTarget:handleTargetChange,retry:translateOne,undo:restoreSource,t }
  const icon = (label,action,glyph,disabled=false) => <button type="button" className="rd-icon" aria-label={label}
    title={label} disabled={disabled} onClick={action}>{glyph}</button>
  const menuBtn = (id,label,content) => <button type="button" className="rd-icon" title={label} aria-label={label}
    aria-expanded={menu === id} onClick={() => setMenu(v => v === id ? null : id)}>{content}</button>
  return <main ref={readerRef} className={'dsh-bi' + (previewFile ? ' rd-embedded' : '')} aria-label={previewFile?.name}
    {...previewFile ? {} : {onDragEnter, onDragOver, onDragLeave, onDrop}}>
    <style>{styles}</style>
    {!previewFile && <header className="rd-tabs"><div className="rd-product"><IconPanel size={17}/><span>{t('panel')}</span></div>
      {doc && <div className="rd-tab rd-menu-wrap"><span className={'rd-file-mark ' + doc.kind}>{doc.kind === 'docx' ? 'W' : doc.kind === 'pdf' ? 'P' : 'T'}</span>
        <button className="rd-tab-name" title={doc.name} aria-expanded={menu === 'recent'} onClick={() => setMenu(v => v === 'recent' ? null : 'recent')}>
          <span className="bi-title">{doc.name}</span><IconChevron size={13}/></button>
        {menu === 'recent' && <div className="rd-menu rd-recent"><div className="rd-menu-heading">{t('recent')}</div>
          {recent.map(file => <button key={file.id} onClick={() => void openRecent(file.id)} disabled={phase !== 'idle'}>
            <IconDoc size={14}/><span>{file.name}</span>{file.id === doc.fileKey && <b>✓</b>}</button>)}
          <button onClick={() => {setMenu(null);handleOpenClick()}}><IconPlus size={14}/>{t('open')}</button></div>}
      </div>}
      {doc && icon(t('open'),handleOpenClick,<IconPlus/>,phase !== 'idle')}
    </header>}
    {(!available || error || notice || (doc && phase !== 'idle')) && <div className="rd-status" role={error || !available ? 'alert' : 'status'}>
      <IconWarning size={15}/><span>{!available ? t('serviceUnavailable') : error?.message || notice || t('parsing')}</span>
      {(error || notice) && (doc || !previewFile) && icon(t('close'),() => {setError(null);setNotice(null)},<IconClose size={14}/>)}</div>}
    {doc ? <>
      <nav className="rd-tools" aria-label={t('readingTools')}>
        {icon(t('contents'),() => setOutline(v => !v),<IconPanel/>)}
        <PageField page={page} total={pages.length} goPage={goPage} t={t}/>
        <i/>
        <button className={'rd-tool' + (paired ? ' on' : '')} aria-pressed={paired} disabled={!total || phase !== 'idle'}
          onClick={() => setView(() => paired ? setPaired(false) : startTranslation())}><IconTranslate/>{paired ? t('hideTranslation') : translatedCount ? t('showTranslation') : t('translateAll')}</button>
        <button className={'rd-tool' + (region ? ' on' : '')} aria-pressed={region} disabled={(!total && !doc.pages?.some(p => p.image)) || editing} onClick={() => {closeChat();setRegion(v => !v)}} title={t('regionHint')}><CropIcon/>{t('regionAsk')}</button>
        <div className="rd-grow"/>
        {icon(t('zoomOut'),() => setView(() => setZoom(v => clampRound(v-.15))),<IconMinus/>,zoom <= .6)}
        <button className="rd-percent" onClick={() => setView(() => setZoom(1))} title={t('fit')} aria-label={t('fit')}>{Math.round(zoom*100)}%</button>
        {icon(t('zoomIn'),() => setView(() => setZoom(v => clampRound(v+.15))),<IconPlus/>,zoom >= 2.2)}
        <i/>{icon(t('exportHint'),exportMarkdown,<IconDownload/>)}
        <div className="rd-menu-wrap">{menuBtn('more',t('more'),<DotsIcon/>)}
          {menu === 'more' && <div className="rd-menu rd-options">
            {addToDraft && <button onClick={() => {setMenu(null);setAsk(null);setQaOpen(true)}}><IconQuestion size={15}/>{t('docChat')}</button>}
            <button onClick={() => {setEditing(!editing);setMenu(null);setRegion(false);setPaired(true)}}><IconEdit size={15}/>{editing ? t('finishEdit') : t('editBoth')}</button>
            <button onClick={() => {setMenu(null);setPaired(true);void translateAll(allTranslated)}} disabled={!!busy || !total || !available}><IconSpark size={15}/>{allTranslated ? t('retranslate') : t('translateRemainder')}</button>
            <div className="rd-rule"/>
            <label>{t('direction')}<select value={direction} disabled={!!busy || askBusy} onChange={event => {
              const value = event.target.value
              if ((value === 'auto' ? doc.detectedDirection : value) !== resolvedDirection) {
                clearSyncTimers()
                doc.segments.forEach(s => bumpRevision(s.id))
                patchDoc(prev => ({...prev,segments:prev.segments.map(s => ({...s,stale:!!s.target,status:s.target?'done':'idle'}))}))
              }
              setDirection(value)
            }}><option value="auto">{t('auto')}</option><option value="zh-en">{t('zhEn')}</option><option value="en-zh">{t('enZh')}</option></select></label>
            <label title={t('syncHint')}>{t('syncOn')}<input type="checkbox" role="switch" aria-label={t('syncOn')} checked={autoSync} onChange={e => setAutoSync(e.target.checked)}/></label>
            <label title={t('syncBackToggleHint')}>{t('syncBackToggle')}<input type="checkbox" role="switch" aria-label={t('syncBackToggle')} checked={syncBack} onChange={e => setSyncBack(e.target.checked)}/></label>
            {lastModel && <div className="rd-model">{lastModel}</div>}
          </div>}
        </div>
      </nav>
      {busy && <div className="rd-progress" role="status"><progress value={busy.done} max={busy.total}/>{t('translatedCount',{done:busy.done,total:busy.total})}<button onClick={cancelTranslation}>{t('cancelTranslation')}</button></div>}
      {!busy && paired && remaining > 0 && phase === 'idle' && <div className="rd-progress" role="status">
        {t('remainingCount',{count:remaining})}<button disabled={!available} onClick={() => void translateAll()}>{t('resumeTranslation')}</button>
      </div>}
      {editing && <div className="rd-progress">{t('editBoth')}<button onClick={() => setEditing(false)}>{t('finishEdit')}</button></div>}
      {region && <div className="rd-progress">{t('regionHint')}<button onClick={() => setRegion(false)}>{t('cancel')}</button></div>}
      <div className="rd-stage">
        {outline && <aside className="rd-outline"><header>{t('contents')}{icon(t('close'),() => setOutline(false),<IconClose size={14}/>)}</header>
          {pages.map((p,i) => <button key={i} aria-current={page===i+1 ? 'page' : undefined} onClick={() => {goPage(i+1);setOutline(false)}}>
            <span>{i+1}</span><span>{byId.get(p.ids.find(id => byId.get(id)?.heading) || p.ids[0])?.text || t('page',{page:i+1})}</span></button>)}
        </aside>}
        <ReadingView doc={doc} pages={pages} ctx={ctx} paired={paired} zoom={zoom} viewportRef={viewportRef} bindViewport={bindViewport} onPage={setPage}
          region={region} onSelection={handleSelectionEnd} onDismissSelection={() => setAsk(v => v && !v.open ? null : v)}
          onRegion={quote => {setRegion(false);if (quote.text || quote.image) showChat(quote);else setNotice(t('noRegionText'))}}/>
        {qaOpen ? <Conversation key={doc.docId} name={doc.name} t={t} items={doc.qa} selection={ask?.open ? ask : null}
          busy={askBusy} onSubmit={submitAsk} onClear={() => setAsk(null)} onClose={closeChat} onDelete={deleteQa}
          onJump={(id,num) => {closeChat();if (id) activate(id,'both');else if (num) goPage(num)}}/> :
          <button className="rd-ask-pill" disabled={!total || phase !== 'idle'} onClick={() => showChat(null)}><IconQuestion size={17}/>{t(addToDraft ? 'askInChat' : 'askDsh')}</button>}
      </div>
      {ask && !ask.open && <AskFab t={t} position={ask} onClick={() => showChat(ask)}/>}
    </> : <div className="rd-home">
      {previewFile ? (error ? <button className="rd-primary" onClick={() => void openFile(previewFile)}>{t('retry')}</button> :
        <div role="status">{t('parsing')}</div>) : phase !== 'idle' ? <div role="status">{t(phase === 'parsing' ? 'parsing' : 'restoring')}</div> :
        <div className="rd-welcome"><div className="rd-book"><IconPanel size={38}/></div><h1>{t('welcome')}</h1><p>{t('dropCopy')}</p>
          <button type="button" className="rd-primary" disabled={!available} onClick={handleOpenClick}><IconPlus size={16}/>{t('open')}</button>
          <small>PDF · DOCX · TXT · Markdown</small></div>}
    </div>}
    {dragging && <div className="rd-drop-overlay">{t('dropActive')}</div>}
    {!previewFile && <input ref={fileInputRef} type="file" accept=".docx,.pdf,.txt,.md,.markdown" hidden onChange={e => {
      const file=e.target.files?.[0];e.target.value='';if(file)void openFile(file)
    }}/>}
  </main>
}

function PageField({page,total,goPage,t}) {
  const [draft,setDraft] = React.useState(String(page))
  React.useEffect(() => setDraft(String(page)),[page])
  const commit = () => {
    const value = Number(draft)
    const next = draft.trim() && Number.isInteger(value) ? clamp(value,1,total) : page
    setDraft(String(next));goPage(next)
  }
  return <label className="rd-page"><input aria-label={t('jumpPage')} inputMode="numeric" value={draft} onFocus={e => e.target.select()}
    onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => {if(e.key==='Enter')e.target.blur()}}/> / {total}</label>
}
function CropIcon() {return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 10h8m-8 4h5"/></svg>}
function DotsIcon() {return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{[5,12,19].map(x=><circle key={x} cx={x} cy="12" r="1.7"/>)}</svg>}


/* --------------------------------------------------------------- helpers */

function detectDirection(segments) {
  const text = segments.map(segment => segment.text).join('\n')
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length
  const latin = (text.match(/[A-Za-z]/g) || []).length
  return cjk >= Math.max(8, latin * 0.35) ? 'zh-en' : 'en-zh'
}

function directionLabel(direction, t) {
  return direction === 'en-zh' ? t('enZh') : t('zhEn')
}

function mergeSegments(incoming, saved) {
  // A restore is always the same local file (the record carries its bytes), so
  // saved source edits win over the parser's original text. A different file
  // arrives through a fresh open and therefore passes no saved state.
  const previous = new Map((saved || []).map(segment => [segment.id, segment]))
  return incoming.map(segment => {
    const old = previous.get(segment.id)
    if (!old) {
      return { ...segment, target: '', status: 'idle', stale: false, aiBack: false, sourceOriginal: undefined }
    }
    const target = typeof old.target === 'string' ? old.target : ''
    return {
      ...segment,
      text: typeof old.text === 'string' ? old.text : segment.text,
      target,
      status: old.status === 'error' ? 'error' : target.trim() ? 'done' : 'idle',
      stale: Boolean(old.stale),
      aiBack: Boolean(old.aiBack),
      sourceOriginal: old.sourceOriginal,
    }
  })
}

function serializeState(doc, direction, autoSync, syncBack, activeId, zoom) {
  return {
    direction,
    autoSync,
    syncBack,
    detectedDirection: doc.detectedDirection,
    translationPaused: doc.translationPaused === true,
    activeId,
    zoom,
    segments: doc.segments.map(segment => ({
      id: segment.id,
      text: segment.text,
      target: segment.target || '',
      status: segment.status === 'translating' ? 'idle' : segment.status,
      stale: Boolean(segment.stale),
      aiBack: Boolean(segment.aiBack),
      sourceOriginal: segment.sourceOriginal,
      page: segment.page,
      heading: segment.heading,
      table: segment.table,
    })),
    qa: doc.qa,
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clampRound(value) {
  return Math.round(clamp(value, 0.6, 2.2) * 100) / 100
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

