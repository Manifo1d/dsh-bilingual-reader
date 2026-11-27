import * as React from 'react'
import { BilingualPage } from './index.jsx'
import { ChatDocumentPreview, readerExtensions } from './preview.jsx'
import { IconTranslate } from './icons.jsx'
import { en, zh } from './locales.js'

const NS = 'bilingualReader'
const PANEL_ID = 'bilingual-reader'
const PREVIEW_ID = '@local/dsh-bilingual-reader/document'

export const inject = ['slots', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bilingual-reader: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.inject(['documentPreviews'], scope => {
    scope.effect(() => scope.slots.inject('sidebar.right.tab.document', () => scope.slots.register({
      name: 'sidebar.right.tab.document', key: PREVIEW_ID, locale: NS,
    }, ChatDocumentPreview)), 'bilingual-reader: chat preview')
    scope.effect(() => scope.documentPreviews.register({
      id: PREVIEW_ID, extensions: readerExtensions, binaryExtensions: ['pdf', 'docx'],
      priority: 'extension', loading: 'bytes-complete', title: () => t('panel'),
    }), 'bilingual-reader: document types')
  })

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ t }),
  }, BilingualPage)), 'bilingual-reader: main panel')

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 14,
    label: () => t('panel'),
    locale: NS,
  }, PanelIcon)), 'bilingual-reader: sidebar entry')
}

/** The left-sidebar row glyph; the sidebar owns the button and label. */
function PanelIcon({ size = 20 }) {
  return <IconTranslate size={size} />
}
