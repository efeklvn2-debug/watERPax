// Emits: apps/frontend/public/favicon.svg + scripts/_logo_preview.html
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const COLS = 13, ROWS = 17
const apexY = 3, circleCy = 86, R = 46, margin = 0.75, p = 0.75
const rowTop = 8, rowBottom = 128, colLeft = 6, colRight = 94

const dots = []
const dx = (colRight - colLeft) / (COLS - 1)
const dy = (rowBottom - rowTop) / (ROWS - 1)
for (let r = 0; r < ROWS; r++) {
  const y = +(rowTop + r * dy).toFixed(2)
  for (let c = 0; c < COLS; c++) {
    const x = +(colLeft + c * dx).toFixed(2)
    const ex = x - 50
    let inside
    if (y >= circleCy) inside = ex * ex + (y - circleCy) ** 2 <= (R - margin) ** 2
    else inside = Math.abs(ex) <= (R - margin) * ((y - apexY) / (circleCy - apexY)) ** p
    if (inside) dots.push([x, y])
  }
}
if (dots.length !== 137) { console.error(`expected 137 dots, got ${dots.length}`); process.exit(1) }

const DROP_PATH = 'M50 3 C 38 30 4 58 4 86 A 46 46 0 0 0 96 86 C 96 58 62 30 50 3 Z'
const dotCircles = dots
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="url(#d)"/><circle cx="${x}" cy="${y}" r="2.6" fill="url(#i)"/>`)
  .join('')

const svgBody = `
<defs>
  <radialGradient id="d" cx="35%" cy="28%" r="80%">
    <stop offset="0%" stop-color="#ffffff"/><stop offset="35%" stop-color="#e8eef5"/>
    <stop offset="70%" stop-color="#a8b4c4"/><stop offset="100%" stop-color="#55647a"/>
  </radialGradient>
  <radialGradient id="i" cx="60%" cy="60%" r="72%">
    <stop offset="0%" stop-color="#0f172a" stop-opacity="0"/><stop offset="60%" stop-color="#0f172a" stop-opacity="0"/>
    <stop offset="82%" stop-color="#0f172a" stop-opacity="0.18"/><stop offset="100%" stop-color="#0f172a" stop-opacity="0.5"/>
  </radialGradient>
  <linearGradient id="t" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0.3" stop-color="#2AB4F5" stop-opacity="0"/><stop offset="1" stop-color="#2AB4F5" stop-opacity="1"/>
  </linearGradient>
  <clipPath id="c"><path d="${DROP_PATH}"/></clipPath>
</defs>
<g>${dotCircles}</g>
<g clip-path="url(#c)"><rect x="20" y="0" width="80" height="134" fill="url(#t)" style="mix-blend-mode:color"/></g>`

mkdirSync(join(root, 'apps/frontend/public'), { recursive: true })
writeFileSync(
  join(root, 'apps/frontend/public/favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 134">${svgBody}</svg>\n`
)

const wordmark = (size) => `
<span style="font-family:'Montserrat',sans-serif;font-weight:900;font-size:${size}px;letter-spacing:-0.025em;line-height:1;white-space:nowrap">
<span style="color:#2AB4F5">Wat</span><span style="color:#C8C8C8;text-shadow:0 0 14px rgba(200,200,200,0.4)">erp</span><span style="color:#2AB4F5">ax</span>
</span>`

const lockup = (size, dark) => `
<div style="display:flex;align-items:baseline;${dark ? '' : ''}">
  <svg viewBox="0 0 100 134" style="height:${size * 1.56}px;width:auto;margin-right:${size * 0.3}px;transform:translateY(${size * 0.05}px);isolation:isolate">${svgBody}</svg>
  ${wordmark(size)}
</div>`

writeFileSync(
  join(root, 'scripts/_logo_preview.html'),
  `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:sans-serif}section{padding:48px;display:flex;flex-direction:column;gap:40px;align-items:flex-start}</style>
</head><body>
<section style="background:#020617;color:#fff"><h3 style="margin:0;color:#94a3b8;font-weight:400">Login-page scale (dark)</h3>${lockup(48, true)}</section>
<section style="background:#f1f5f9"><h3 style="margin:0;color:#64748b;font-weight:400">Header scale (light)</h3>${lockup(18, false)}${lockup(30, false)}</section>
<section style="background:#0f172a"><h3 style="margin:0;color:#94a3b8;font-weight:400">Mark only, sizes</h3>
<div style="display:flex;gap:24px;align-items:flex-end">
<svg viewBox="0 0 100 134" style="width:22px;isolation:isolate">${svgBody}</svg>
<svg viewBox="0 0 100 134" style="width:44px;isolation:isolate">${svgBody}</svg>
<svg viewBox="0 0 100 134" style="width:88px;isolation:isolate">${svgBody}</svg>
</div></section>
</body></html>`
)
console.log(`ok: 137 dots -> favicon.svg + _logo_preview.html`)
