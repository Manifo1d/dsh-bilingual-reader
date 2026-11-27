import * as React from 'react'
import { assetUrl } from './api.js'

/**
 * A PDF page rendered as an image with a transparent, positioned word layer.
 * The word layer is what makes selection, highlighting, and asking possible
 * without giving up the visual page.
 */
export const PdfPage = React.memo(function PdfPage({ page, zoom, activeId, markedIds, onActivate, t }) {
  const ref = React.useRef(null)
  const [visible, setVisible] = React.useState(false)
  const [imageError, setImageError] = React.useState(false)

  React.useEffect(() => {
    setImageError(false)
  }, [page.image])

  React.useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '800px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const width = Number(page.width) || 612
  const height = Number(page.height) || 792
  return (
    <div
      ref={ref}
      className="bi-pdf-page"
      data-page={page.index}
      style={{ width: `${zoom * 100}%`, aspectRatio: `${width} / ${height}` }}
    >
      {page.image ? (
        <img
          className="bi-pdf-image"
          src={assetUrl(page.image)}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          loading="lazy"
          onError={() => setImageError(true)}
          style={imageError ? { visibility: 'hidden' } : undefined}
        />
      ) : null}
      {visible ? (
        <div
          className={`bi-pdf-words${!page.image || imageError ? ' bi-pdf-words--plain' : ''}`}
          aria-label={t('page', { page: page.index })}
        >
          {(page.words || []).map((word, index) => {
            const marked = markedIds.has(word.seg)
            const active = word.seg === activeId
            return (
              <span
                key={`${word.seg}-${index}`}
                data-seg={word.seg}
                className={`bi-word${marked ? ' bi-word--marked' : ''}${active ? ' bi-word--active' : ''}`}
                style={{
                  left: `${(word.x / width) * 100}%`,
                  top: `${(word.y / height) * 100}%`,
                  width: `${(word.w / width) * 100}%`,
                  height: `${(word.h / height) * 100}%`,
                  fontSize: `${(word.h / width) * 100}cqw`,
                }}
                onClick={() => onActivate(word.seg)}
              >
                {word.text}{index < (page.words?.length ?? 0) - 1 ? ' ' : ''}
              </span>
            )
          })}
        </div>
      ) : null}
      <span className="bi-pdf-page-number">{page.index}</span>
      {page.words?.length === 0 && page.image ? (
        <span className="bi-pdf-scan">{t('scanHint')}</span>
      ) : null}
    </div>
  )
})

