// Document images only. The crop is clipped to one sheet and never captures
// other applications, UI chrome, chat messages or the system clipboard.
export function regionImage(sheet, box) {
  const page = sheet.getBoundingClientRect()
  const left = Math.max(page.left,box.left), top = Math.max(page.top,box.top)
  const right = Math.min(page.right,box.right), bottom = Math.min(page.bottom,box.bottom)
  const width = right - left, height = bottom - top
  if (width < 5 || height < 5) return null
  const figures = Array.from(sheet.querySelectorAll('.bi-pdf-image,.rd-figure')).filter(img => {
    const r = img.getBoundingClientRect()
    return img.complete && img.naturalWidth && r.left < right && r.right > left && r.top < bottom && r.bottom > top
  })
  if (!figures.length) return null
  // Word text in a mixed selection travels as a separate exact quotation.
  // Limit the Word image crop to the bounding rectangle of the selected art.
  const areas = figures.map(img => img.getBoundingClientRect())
  const x = Math.max(left,Math.min(...areas.map(a => a.left)))
  const y = Math.max(top,Math.min(...areas.map(a => a.top)))
  const w = Math.min(right,Math.max(...areas.map(a => a.right))) - x
  const h = Math.min(bottom,Math.max(...areas.map(a => a.bottom))) - y
  if (w < 3 || h < 3) return null
  const resolution = Math.min(3,1400 / Math.max(w,h),Math.max(...figures.map((img,i) => img.naturalWidth/areas[i].width)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1,Math.round(w*resolution)); canvas.height = Math.max(1,Math.round(h*resolution))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.scale(canvas.width/w,canvas.height/h)
  for (let i=0;i<figures.length;i++) {
    const r = areas[i]
    ctx.drawImage(figures[i],r.left-x,r.top-y,r.width,r.height)
  }
  const data = canvas.toDataURL('image/jpeg',.83)
  return data.startsWith('data:image/jpeg;base64,') && data.length < 1500000 ? data : null
}
