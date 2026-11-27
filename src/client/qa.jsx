import * as React from 'react'
import { IconClose, IconQuestion, IconSend, IconTrash } from './icons.jsx'

export function AskFab({ t, position, onClick }) {
  return <button type="button" className="bi-ask-fab" style={{
    left: 'clamp(6px, ' + (position.x - 38) + 'px, calc(100% - 92px))',
    top: 'clamp(6px, ' + (position.y + 6) + 'px, calc(100% - 44px))'
  }} onMouseDown={event => event.preventDefault()} onClick={onClick}><IconQuestion size={15}/>{t('ask')}</button>
}

export function Conversation({ name, t, items, selection, onClear, onClose, onSubmit, onDelete, onJump, busy }) {
  const [draft,setDraft] = React.useState('')
  const [copyId,setCopyId] = React.useState(null)
  const input = React.useRef(null)
  const thread = React.useRef(null)
  React.useEffect(() => {input.current?.focus()}, [selection])
  React.useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight
  },[items])
  const send = () => {
    if (busy || !draft.trim()) return
    onSubmit(draft.trim()); setDraft(''); input.current?.focus()
  }
  return <aside className="rd-chat bi-qa-drawer" role="dialog" aria-label={t('docChat')}>
    <header className="rd-chat-title"><IconQuestion size={17}/><strong>{t('docChat')}</strong>
      <button type="button" className="rd-icon" title={t('collapse')} aria-label={t('collapse')} onClick={onClose}><IconClose/></button></header>
    <div className="rd-thread" ref={thread}>
      {items.length === 0 && <p className="rd-chat-empty">{t('qaStart')}</p>}
      {items.slice().reverse().map(item => <article key={item.id}>
        {(item.imagePage || item.selection) && <button className="rd-citation" type="button" disabled={!item.segId && !item.imagePage} onClick={() => onJump(item.segId,item.imagePage)}>{item.imagePage ? t('imageQuote',{page:item.imagePage}) : item.selection}</button>}
        <div className="rd-question">{item.question}</div>
        <div className={'rd-answer' + (item.status === 'error' ? ' failed' : '')} aria-live="polite">{item.status === 'loading' ? t('thinking') : item.answer}</div>
        {item.status !== 'loading' && <div className="rd-chat-tools">
          <button type="button" className="rd-mini" onClick={async () => {
            try { await navigator.clipboard.writeText(item.answer); setCopyId(item.id) } catch { setCopyId(null) }
          }}>{copyId === item.id ? t('copied') : t('copy')}</button>
          <button type="button" className="rd-icon" aria-label={t('delete')} onClick={() => onDelete(item.id)}><IconTrash size={13}/></button>
        </div>}
      </article>)}
    </div>
    <div className="rd-compose">
      {selection?.image && <img className="rd-crop-preview" src={selection.image} alt={t('imageQuote',{page:selection.page})}/>}
      {selection && <div className="rd-quote"><span>{selection.text || t('imageQuote',{page:selection.page})}</span><button type="button" className="rd-icon" onClick={onClear} aria-label={t('clearQuote')}><IconClose size={13}/></button></div>}
      <textarea className="bi-ask-input" ref={input} value={draft} rows={2} maxLength={4000}
        aria-label={t('askDocument')} placeholder={selection ? t('askQuoted') : t('askDocument')}
        onChange={e => setDraft(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send() }
        }}/>
      <div className="rd-compose-foot"><span title={name}>{name}</span><button type="button" className="rd-send" disabled={!draft.trim() || busy} aria-label={t('send')} title={t('send')} onClick={send}><IconSend size={16}/></button></div>
    </div>
  </aside>
}
