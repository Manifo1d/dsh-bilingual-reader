import * as React from 'react'
import { BilingualPage } from './index.jsx'

export const readerExtensions = ['docx', 'pdf', 'txt', 'md', 'markdown']

// The document owner supplies session-authorized bytes. Resource segments are
// encoded independently, including an empty segment for absolute Unix paths.
export function ChatDocumentPreview({ resourceAddress, content, scrollportRef, useResource, inputActions, t }) {
  const meta = useResource(resourceAddress)
  const path = React.useMemo(() => new URL(resourceAddress).pathname.split('/').slice(3)
    .map(decodeURIComponent).join('/'), [resourceAddress])
  const data = content.kind === 'bytes' ? content.data : undefined
  const file = React.useMemo(() => {
    if (!data) return null
    const name = path.split(/[\\/]/).pop()
    return {
      name,
      size: data.byteLength,
      arrayBuffer: async () => data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
  }, [data, path])
  const addToDraft = (selection, page) => {
    const location = meta.value?.absolutePath || path
    const label = selection ? t('page', {page}) : t('panel')
    const text = selection ? [location, label, selection].join('\n') : location
    return inputActions.insertQuote(text, { label, title: file.name, body: selection || location })
  }
  if (!file) return <div role="status">{t('parsing')}</div>
  return <BilingualPage key={resourceAddress} t={t} previewFile={file} scrollportRef={scrollportRef}
    addToDraft={inputActions?.insertQuote ? addToDraft : undefined}/>
}
