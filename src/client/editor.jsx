import * as React from 'react'

/**
 * A textarea that grows with its content, capped to keep long documents
 * navigable.
 */
export function AutoTextarea({ value, onChange, className = '', maxHeight = 320, ...rest }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(maxHeight, Math.max(44, element.scrollHeight))}px`
  }, [value, maxHeight])
  return (
    <textarea
      ref={ref}
      className={`bi-textarea ${className}`.trim()}
      value={value}
      rows={1}
      onChange={event => onChange(event.target.value)}
      spellCheck={false}
      {...rest}
    />
  )
}
