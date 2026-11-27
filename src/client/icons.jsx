import * as React from 'react'

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function IconDoc({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M6 2.8h7.2L18 7.6v13.6H6z" />
      <path d="M13 2.8v5h5" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  )
}

export function IconTranslate({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M3.5 5.5h8M7.5 3.5v2M10.4 5.5c-.5 3-2.2 5.4-4.9 7.2" />
      <path d="M5.1 9.2c1 1.5 2.4 2.6 4.2 3.3" />
      <path d="M13.2 20.5l3.4-8.2 3.4 8.2" />
      <path d="M14.4 17.7h4.4" />
    </svg>
  )
}

export function IconSpark({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </svg>
  )
}

export function IconClose({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconSend({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M21 3L10.5 13.5" />
      <path d="M21 3l-6.8 18-3.7-7.5L3 9.8z" />
    </svg>
  )
}

export function IconDownload({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M12 3v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 19.5h16" />
    </svg>
  )
}

export function IconEdit({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M4 20h4.2L19.5 8.7a2.1 2.1 0 0 0-3-3L5.2 17z" />
      <path d="M13.8 6.5l3.7 3.7" />
    </svg>
  )
}

export function IconEye({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

export function IconPlus({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconMinus({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconFit({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      <path d="M8.5 8.5h7v7h-7z" />
    </svg>
  )
}

export function IconTrash({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

export function IconUndo({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h9.5a5.5 5.5 0 0 1 0 11H10" />
    </svg>
  )
}

export function IconQuestion({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.1a2.7 2.7 0 1 1 3.4 2.6c-.8.3-1.2.9-1.2 1.8v.3" />
      <path d="M11.6 17.2h.01" strokeWidth="2.2" />
    </svg>
  )
}

export function IconChevron({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M8 10l4 4 4-4" />
    </svg>
  )
}

export function IconWarning({ size = 16, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <path d="M12 3.5L21 20H3z" />
      <path d="M12 9v5" />
      <path d="M12 17.4h.01" strokeWidth="2.2" />
    </svg>
  )
}

export function IconPanel({ size = 20, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <path d="M10.5 4v16" />
      <path d="M14.5 9.5h3.5M14.5 13.5h3.5" />
      <path d="M5.8 9.5h2.4M5.8 13.5h2.4" />
    </svg>
  )
}

export function IconWordmark() {
  return (
    <span className="bi-wordmark" aria-hidden="true">
      <span className="bi-wordmark-page">文</span>
      <span className="bi-wordmark-arrow">⇄</span>
      <span className="bi-wordmark-page bi-wordmark-page--alt">A</span>
    </span>
  )
}
