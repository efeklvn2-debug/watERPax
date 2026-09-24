// watERPax Stock Adjust GL Routing E2E
// Tests Layer 1: reason-based GL routing on stock adjustments.
// Run: BASE_URL=... SMOKE_USER=superadmin node scripts/stock-adjust-gl.e2e.mjs

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001/api'

function envFromFile(path, key) {
  try {
    const { readFileSync } = require('fs')
    const m = readFileSync(path, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
  } catch { return undefined }
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  || process.env.SUPERADMIN_PASSWORD
  || envFromFile('apps/backend/.env', 'ADMIN_PASSWORD')
  || 'admin123'

const results = []
function log(m) { console.log(m) }
function assert(pass, msg) {
  results.push({ pass: !!pass, msg })
  log(`${pass ? '  ✓' : '  ✗'} ${msg}`)
  if (!pass) throw new Error(msg)
}

function createSession() {
  const cookies = new Map()
  return {
    cookie: (n) => cookies.get(n),
    async api(path, opts = {}) {
      const method = (opts.method || 'GET').toUpperCase()
      const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
      const ck = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
      if (ck) headers.Cookie = ck
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const csrf = cookies.get('waterpax_csrf')
        if (csrf && opts.csrf !== false) headers['x-waterpax-csrf'] = decodeURIComponent(csrf)
      }
      const res = await fetch(`${BASE_URL}${path}`, {
        method, headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const h of setCookies) {
        const [pair] = h.split(';')
        const i = pair.indexOf('=')
        cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1))
      }
      return { status: res.status, data: await res.json().catch(() => null) }
    },
  }
}

function findAccountCode(line) {
  return line.account?.code || line.accountCode || '?'
}

async function main() {
  const ts = Date.now()
  log('=== Stock Adjust GL Routing E2E ===')

  // --- Bootstrap tenant ---
  const sa = createSession()
  let r = await sa.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')

  r = await sa.api('/platform/tenants', { method: 'POST', body: { name: `Adj GL Factory ${ts}`, slug: `adj-gl-${ts}` } })
  assert(r.status === 201, 'Tenant created')
  const tenantId = r.data?.data?.id

  const username = `adjadmin-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username, password: 'AdjPass12345!', role: 'ADMIN' },
  })
  assert(r.status === 201, 'Tenant admin created')

  const admin = createSession()
  r = await admin.api('/auth/login', { method: 'POST', body: { username, password: 'AdjPass12345!' } })
  assert(r.status === 200, 'Tenant admin login')

  // Also create a VIEWER for RBAC test
  const viewerName = `adjviewer-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username: viewerName, password: 'ViewPass12345!', role: 'VIEWER' },
  })
  assert(r.status === 201, 'Viewer created')
  const viewer = createSession()
  r = await viewer.api('/auth/login', { method: 'POST', body: { username: viewerName, password: 'ViewPass12345!' } })
  assert(r.status === 200, 'Viewer login')

  // --- Seed default COA accounts for this tenant ---
  r = await admin.api('/finance/seed', { method: 'POST' })
  assert(r.status === 200, 'Default COA accounts seeded')

  // --- Create a RAW_MATERIAL with costPrice ---
  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `ADJ-RM-${ts}`, name: 'Test Preform', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 50, minStock: 0 },
  })
  assert(r.status === 201, 'Material created (RAW)')
  const rawMatId = r.data?.data?.id
  assert(!!rawMatId, 'Raw material ID returned')

  // --- Create a PACKAGING material with costPrice ---
  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `ADJ-PK-${ts}`, name: 'Test Shrink Wrap', category: 'PACKAGING', unitOfMeasure: 'rolls', costPrice: 20, minStock: 0 },
  })
  assert(r.status === 201, 'Material created (PACKAGING)')
  const pkgMatId = r.data?.data?.id
  assert(!!pkgMatId, 'Packaging material ID returned')

  const today = new Date().toISOString().split('T')[0]

  // ========== TEST 1: Stock increase (Opening Balance) -> Dr 1300 / Cr 3000 ==========
  log('\n1. Stock increase (RAW) — Opening Balance')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 100, reason: 'Opening Balance', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  // Fetch journal entries for this sourceId
  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry1 = r.data?.data?.[0]
  assert(!!entry1, 'JE posted for increase')
  assert(entry1.sourceId === rawMatId, `sourceId matches material`)
  const lines1 = entry1.lines || []
  const debitLine1 = lines1.find(l => Number(l.debit) > 0)
  const creditLine1 = lines1.find(l => Number(l.credit) > 0)
  assert(findAccountCode(debitLine1) === '1300', `Increase Dr 1300 (got ${findAccountCode(debitLine1)})`)
  assert(findAccountCode(creditLine1) === '3000', `Increase Cr 3000 (got ${findAccountCode(creditLine1)})`)

  // ========== TEST 2: Stock decrease — Damaged Goods -> Dr 5320 ==========
  log('\n2. Stock decrease — Damaged Goods')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 80, reason: 'Damaged Goods', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry2 = r.data?.data?.[0]
  const debit2 = entry2.lines.find(l => Number(l.debit) > 0)
  const credit2 = entry2.lines.find(l => Number(l.credit) > 0)
  assert(findAccountCode(debit2) === '5320', `Damaged Goods Dr 5320 (got ${findAccountCode(debit2)})`)
  assert(findAccountCode(credit2) === '1300', `Damaged Goods Cr 1300 (got ${findAccountCode(credit2)})`)

  // ========== TEST 3: Stock decrease — Theft/Loss -> Dr 5330 ==========
  log('\n3. Stock decrease — Theft/Loss')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 60, reason: 'Theft/Loss', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry3 = r.data?.data?.[0]
  const debit3 = entry3.lines.find(l => Number(l.debit) > 0)
  assert(findAccountCode(debit3) === '5330', `Theft/Loss Dr 5330 (got ${findAccountCode(debit3)})`)

  // ========== TEST 4: Stock decrease — Internal Use -> Dr 5340 ==========
  log('\n4. Stock decrease — Internal Use')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 40, reason: 'Internal Use', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry4 = r.data?.data?.[0]
  const debit4 = entry4.lines.find(l => Number(l.debit) > 0)
  assert(findAccountCode(debit4) === '5340', `Internal Use Dr 5340 (got ${findAccountCode(debit4)})`)

  // ========== TEST 5: Stock decrease — Return to Supplier -> Dr 2000 (AP) ==========
  log('\n5. Stock decrease — Return to Supplier')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 20, reason: 'Return to Supplier', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry5 = r.data?.data?.[0]
  const debit5 = entry5.lines.find(l => Number(l.debit) > 0)
  assert(findAccountCode(debit5) === '2000', `Return to Supplier Dr 2000 (got ${findAccountCode(debit5)})`)

  // ========== TEST 6: Stock decrease — Unrecognized reason -> Dr 5310 (default) ==========
  log('\n6. Stock decrease — Unrecognized reason (default)')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 10, reason: 'Something Random', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry6 = r.data?.data?.[0]
  const debit6 = entry6.lines.find(l => Number(l.debit) > 0)
  assert(findAccountCode(debit6) === '5310', `Default Dr 5310 (got ${findAccountCode(debit6)})`)

  // ========== TEST 6b: Stock decrease — Opening Balance -> Dr 3000 ==========
  log('\n6b. Stock decrease — Opening Balance')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 5, reason: 'Opening Balance', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry6b = r.data?.data?.[0]
  const debit6b = entry6b.lines.find(l => Number(l.debit) > 0)
  const credit6b = entry6b.lines.find(l => Number(l.credit) > 0)
  assert(findAccountCode(debit6b) === '3000', `Opening Balance decrease Dr 3000 (got ${findAccountCode(debit6b)})`)
  assert(findAccountCode(credit6b) === '1300', `Opening Balance decrease Cr 1300 (got ${findAccountCode(credit6b)})`)

  // ========== TEST 7: PACKAGING material increase -> Cr 3000 (Opening Balance), Dr 1510 ==========
  log('\n7. Stock increase (PACKAGING) — Dr 1510')
  r = await admin.api(`/inventory/materials/${pkgMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 50, reason: 'Opening Balance', date: today },
  })
  assert(r.status === 200, `Status 200 (got ${r.status})`)

  r = await admin.api(`/finance/journal?sourceModule=ADJUSTMENT&limit=1`)
  const entry7 = r.data?.data?.[0]
  const debit7 = entry7.lines.find(l => Number(l.debit) > 0)
  const credit7 = entry7.lines.find(l => Number(l.credit) > 0)
  assert(findAccountCode(debit7) === '1510', `Packaging increase Dr 1510 (got ${findAccountCode(debit7)})`)
  assert(findAccountCode(credit7) === '3000', `Packaging increase Cr 3000 (got ${findAccountCode(credit7)})`)

  // ========== TEST 8: Missing costPrice -> 400 ==========
  log('\n8. Missing costPrice → 400')
  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `ADJ-NOCOST-${ts}`, name: 'No Cost Mat', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', minStock: 0 },
  })
  const noCostId = r.data?.data?.id
  r = await admin.api(`/inventory/materials/${noCostId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 100, reason: 'Opening Balance' },
  })
  assert(r.status === 400, `Missing costPrice rejected (got ${r.status})`)

  // ========== TEST 9: Empty reason -> 400 ==========
  log('\n9. Empty reason → 400')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 5, reason: '' },
  })
  assert(r.status === 400, `Empty reason rejected (got ${r.status})`)

  // ========== TEST 10: Negative quantity -> 400 ==========
  log('\n10. Negative quantity → 400')
  r = await admin.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: -10, reason: 'Test' },
  })
  assert(r.status === 400, `Negative quantity rejected (got ${r.status})`)

  // ========== TEST 11: VIEWER RBAC -> 403 ==========
  log('\n11. VIEWER tries to adjust → 403')
  r = await viewer.api(`/inventory/materials/${rawMatId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 50, reason: 'Viewer test' },
  })
  assert(r.status === 403, `Viewer blocked (got ${r.status})`)

  // ========== TEST 12: Trial balance balanced ==========
  log('\n12. Trial balance balanced')
  r = await admin.api('/finance/trial-balance')
  const t = r.data?.data?.totals || {}
  const diff = Math.abs(Number(t.totalDebit) - Number(t.totalCredit))
  assert(diff <= 0.01, `TB balanced (Dr ${t.totalDebit} = Cr ${t.totalDebit}, diff ${diff})`)

  // --- Cleanup ---
  r = await sa.api(`/platform/tenants/${tenantId}`, { method: 'PATCH', body: { isActive: false } })
  assert(r.status === 200, 'Tenant deactivated')

  const passed = results.filter(x => x.pass).length
  log(`\nPassed: ${passed}/${results.length}`)
  log(results.length === passed ? 'All tests passed!' : 'SOME TESTS FAILED')
  process.exit(results.length === passed ? 0 : 1)
}

main().catch((e) => {
  log(`\nFatal: ${e.message}`)
  const passed = results.filter(x => x.pass).length
  log(`Passed: ${passed}/${results.length}`)
  process.exit(1)
})
