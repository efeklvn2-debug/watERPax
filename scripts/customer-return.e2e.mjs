// watERPax Customer Return (defective inward) E2E
// Tests: RESTOCK → FG_STORE, SCRAP → FG_DEFECTIVE, CREDIT/CASH, qty guard, RBAC, TB

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
      const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const h of setCookies) {
        const [pair] = h.split(';')
        const i = pair.indexOf('=')
        cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1))
      }
      return { status: res.status, data: await res.json().catch(() => null) }
    }
  }
}
function findAccountCode(line) { return line.account?.code || line.accountCode || '?' }

async function main() {
  const ts = Date.now()
  log('=== Customer Return (defective inward) E2E ===')

  const sa = createSession()
  let r = await sa.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')
  r = await sa.api('/platform/tenants', { method: 'POST', body: { name: `CRet Factory ${ts}`, slug: `cret-${ts}` } })
  assert(r.status === 201, 'Tenant created')
  const tenantId = r.data?.data?.id
  const username = `cretadmin-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, { method: 'POST', body: { username, password: 'CretPass12345!', role: 'ADMIN' } })
  assert(r.status === 201, 'Tenant admin created')
  const admin = createSession()
  r = await admin.api('/auth/login', { method: 'POST', body: { username, password: 'CretPass12345!' } })
  assert(r.status === 200, 'Tenant admin login')
  const viewerName = `cretviewer-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, { method: 'POST', body: { username: viewerName, password: 'ViewPass12345!', role: 'VIEWER' } })
  assert(r.status === 201, 'Viewer created')
  const viewer = createSession()
  r = await viewer.api('/auth/login', { method: 'POST', body: { username: viewerName, password: 'ViewPass12345!' } })
  assert(r.status === 200, 'Viewer login')

  // Customer
  r = await admin.api('/customers', { method: 'POST', body: { name: `CRET Customer ${ts}`, code: `CRET-${ts}` } })
  assert(r.status === 201, 'Customer created')
  const customerId = r.data?.data?.id

  // Material + Product variant
  r = await admin.api('/inventory/materials', { method: 'POST', body: { code: `CRMAT-${ts}`, name: 'CRET Preform', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 10, minStock: 0 } })
  assert(r.status === 201, 'Material created')
  const matId = r.data?.data?.id

  r = await admin.api('/products', { method: 'POST', body: { code: `CRPROD-${ts}`, name: 'CRET Water', category: 'BOTTLED' } })
  assert(r.status === 201, 'Product created')
  const prodId = r.data?.data?.id
  r = await admin.api(`/products/${prodId}/variants`, { method: 'POST', body: { label: 'CRET-50cl', packSize: 12, pricePerUnit: 2400 } })
  assert(r.status === 201, 'Variant created')
  const variantId = r.data?.data?.id

  // BOM: 2 preforms per pack
  r = await admin.api(`/products/variants/${variantId}/bom`, { method: 'PUT', body: { lines: [{ materialId: matId, qtyPerPack: 2 }] } })
  assert(r.status === 200, 'BOM set')

  // Stock raw 100
  r = await admin.api(`/inventory/materials/${matId}/adjust-stock`, { method: 'PATCH', body: { newQuantity: 100, reason: 'Opening Balance', date: new Date().toISOString().split('T')[0] } })
  assert(r.status === 200, 'Raw stock 100')

  // Production run 10 packs
  r = await admin.api('/production-runs', { method: 'POST', body: { variantId, plannedPacks: 10 } })
  assert(r.status === 201, 'Run created')
  const runId = r.data?.data?.id
  r = await admin.api(`/production-runs/${runId}/start`, { method: 'POST', body: {} })
  assert(r.status === 200, 'Run started')
  r = await admin.api(`/production-runs/${runId}/complete`, { method: 'POST', body: { actualPacks: 10 } })
  assert(r.status === 200, 'Run completed')

  // Check FG_STORE 10
  r = await admin.api('/reports/water/fg-valuation')
  let fgRow = (r.data?.data?.rows || []).find(x => x.variant === 'CRET-50cl')
  assert(Number(fgRow?.packs) === 10, `FG_STORE 10 packs (got ${fgRow?.packs})`)

  // Sale 6 packs
  r = await admin.api('/sales', { method: 'POST', body: { customerId, lines: [{ variantId, qty: 6 }] } })
  assert(r.status === 201, 'Sale created')
  const saleId = r.data?.data?.id
  const saleNumber = r.data?.data?.saleNumber
  // Find sale line id and unitPrice for later amount check
  const saleLines = r.data?.data?.lines || []
  const saleLine = saleLines.find((l) => l.variantId === variantId)

  r = await admin.api(`/sales/${saleId}/confirm`, { method: 'POST', body: {} })
  assert(r.status === 200, 'Sale confirmed')
  r = await admin.api(`/sales/${saleId}/deliver`, { method: 'POST', body: {} })
  assert(r.status === 200, 'Sale delivered')
  const invoiceId = r.data?.data?.invoiceId

  const today = new Date().toISOString().split('T')[0]

  // After deliver, FG_STORE should be 4 (10-6)
  r = await admin.api('/reports/water/fg-valuation')
  fgRow = (r.data?.data?.rows || []).find(x => x.variant === 'CRET-50cl' && x.location === 'FG_STORE')
  // fg-valuation returns per batch rows; sum
  const fgStorePacks = (r.data?.data?.rows || []).filter((x) => x.location === 'FG_STORE' && x.variant === 'CRET-50cl').reduce((s, x) => s + Number(x.packs), 0)
  assert(fgStorePacks === 4, `FG_STORE after deliver 4 (got ${fgStorePacks})`)

  // Pay the invoice with cash so that cash refunds have balance to debit
  // Sale total 6*2400=14400 inclusive
  const saleTotal = saleLine ? Number(saleLine.unitPrice) * 6 : 14400
  r = await admin.api(`/sales/${saleId}/payments`, { method: 'POST', body: { amount: saleTotal, method: 'CASH', date: today } })
  assert(r.status === 201 || r.status === 200, `Payment for sale (got ${r.status}) ${r.status !== 201 && r.status !== 200 ? JSON.stringify(r.data) : ''}`)
  // Also fund BANK account for BANK refund test (deposit via bank)
  r = await admin.api('/sales/deposits', { method: 'POST', body: { customerId, amount: 10000, method: 'BANK_TRANSFER', date: today } })
  assert(r.status === 201 || r.status === 200, `Bank deposit for refund test (got ${r.status})`)

  // ========== 1. RESTOCK 2 packs — CREDIT (default) => FG_STORE +2, JE Dr4001/Dr2100 / Cr2250 + Dr1325/Cr5000
  log('\n1. Return RESTOCK 2 packs — CREDIT')
  r = await admin.api('/sales/credit-notes', { method: 'POST', body: { customerId, saleId, variantId, quantity: 2, reason: 'Leaking bottles', disposition: 'RESTOCK', refundMethod: 'CREDIT', date: today } })
  assert(r.status === 201, `RESTOCK created (got ${r.status}) ${r.status !== 201 ? JSON.stringify(r.data) : ''}`)
  const cr1 = r.data?.data
  assert(!!cr1?.creditNoteNumber, 'CR number returned')
  assert(cr1.disposition === 'RESTOCK', 'disposition RESTOCK')

  // Verify FG_STORE now 6
  r = await admin.api('/reports/water/fg-valuation')
  const fgStoreAfter1 = (r.data?.data?.rows || []).filter((x) => x.location === 'FG_STORE' && x.variant === 'CRET-50cl').reduce((s, x) => s + Number(x.packs), 0)
  assert(fgStoreAfter1 === 6, `FG_STORE after RESTOCK 6 (got ${fgStoreAfter1})`)

  // Verify JE: revenue reversal Dr4001 + Dr2100 / Cr2250
  r = await admin.api('/finance/journal?sourceModule=SALES_RETURN&limit=5')
  const jes = r.data?.data || []
  // Find the revenue JE for cr1 (it has reference cr1.creditNoteNumber)
  const revJe = jes.find((j) => j.reference === cr1.creditNoteNumber && j.lines.some((l) => findAccountCode(l) === '4001'))
  assert(!!revJe, 'Revenue JE found for RESTOCK')
  if (revJe) {
    const drRev = revJe.lines.find((l) => findAccountCode(l) === '4001')
    const drVat = revJe.lines.find((l) => findAccountCode(l) === '2100')
    const crAdv = revJe.lines.find((l) => findAccountCode(l) === '2250')
    assert(!!drRev && Number(drRev.debit) > 0, `Dr4001 rev ${drRev ? Number(drRev.debit) : '?'} >0`)
    assert(!!crAdv && Number(crAdv.credit) > 0, `Cr2250 credit ${crAdv ? Number(crAdv.credit) : '?'} >0`)
    // For restock, also COGS JE: Dr1325 / Cr5000
    const cogsJe = jes.find((j) => j.reference === cr1.creditNoteNumber && j.lines.some((l) => findAccountCode(l) === '1325'))
    assert(!!cogsJe, 'COGS JE Dr1325 found for RESTOCK')
  }

  // ========== 2. SCRAP 1 pack — CASH => FG_DEFECTIVE +1, JE Dr4001/Dr2100 / Cr1000 + Dr1325/Cr5000
  log('\n2. Return SCRAP 1 pack — CASH')
  r = await admin.api('/sales/credit-notes', { method: 'POST', body: { customerId, saleId, variantId, quantity: 1, reason: 'Bad sachet seal', disposition: 'SCRAP', refundMethod: 'CASH', date: today } })
  if (r.status !== 201) log(`  SCRAP error: ${JSON.stringify(r.data)}`)
  assert(r.status === 201, `SCRAP created (got ${r.status})`)
  const cr2 = r.data?.data
  assert(cr2.disposition === 'SCRAP', 'disposition SCRAP')

  r = await admin.api('/reports/water/fg-valuation')
  const fgDefAfter = (r.data?.data?.rows || []).filter((x) => x.location === 'FG_DEFECTIVE' && x.variant === 'CRET-50cl').reduce((s, x) => s + Number(x.packs), 0)
  assert(fgDefAfter === 1, `FG_DEFECTIVE after SCRAP 1 (got ${fgDefAfter})`)
  const fgStoreAfter2 = (r.data?.data?.rows || []).filter((x) => x.location === 'FG_STORE' && x.variant === 'CRET-50cl').reduce((s, x) => s + Number(x.packs), 0)
  assert(fgStoreAfter2 === 6, `FG_STORE still 6 after SCRAP (got ${fgStoreAfter2})`)

  // Verify cash JE Cr1000
  r = await admin.api('/finance/journal?sourceModule=SALES_RETURN&limit=10')
  const revJe2 = (r.data?.data || []).find((j) => j.reference === cr2.creditNoteNumber && j.lines.some((l) => findAccountCode(l) === '4001'))
  assert(!!revJe2, 'Revenue JE for SCRAP found')
  if (revJe2) {
    const crCash = revJe2.lines.find((l) => findAccountCode(l) === '1000')
    assert(!!crCash, 'Cr1000 for CASH refund')
  }

  // ========== 3. SCRAP 1 pack — BANK
  log('\n3. Return SCRAP 1 pack — BANK')
  r = await admin.api('/sales/credit-notes', { method: 'POST', body: { customerId, saleId, variantId, quantity: 1, reason: 'Bank refund test', disposition: 'SCRAP', refundMethod: 'BANK', date: today } })
  assert(r.status === 201, `BANK SCRAP created (got ${r.status})`)
  const cr3 = r.data?.data
  r = await admin.api('/finance/journal?sourceModule=SALES_RETURN&limit=10')
  const revJe3 = (r.data?.data || []).find((j) => j.reference === cr3.creditNoteNumber && j.lines.some((l) => findAccountCode(l) === '4001'))
  if (!revJe3) log(`  BANK JE not found. All JEs: ${JSON.stringify((r.data?.data || []).filter((j) => j.reference === cr3.creditNoteNumber).map((j) => ({ ref: j.reference, lines: j.lines.map((l) => ({ code: findAccountCode(l), d: l.debit, c: l.credit })) })), null, 2)}`)
  const crBank = revJe3?.lines.find((l) => findAccountCode(l) === '1100')
  assert(!!crBank, 'Cr1100 for BANK refund')

  // FG_DEFECTIVE now 2
  r = await admin.api('/reports/water/fg-valuation')
  const fgDefAfter2 = (r.data?.data?.rows || []).filter((x) => x.location === 'FG_DEFECTIVE' && x.variant === 'CRET-50cl').reduce((s, x) => s + Number(x.packs), 0)
  assert(fgDefAfter2 === 2, `FG_DEFECTIVE after second SCRAP 2 (got ${fgDefAfter2})`)

  // ========== 4. Qty guard: try to return 3 more (already returned 2+1+1=4 of 6, only 2 left) — should fail
  log('\n4. Qty guard — exceed returnable')
  r = await admin.api('/sales/credit-notes', { method: 'POST', body: { customerId, saleId, variantId, quantity: 3, reason: 'Exceed', disposition: 'RESTOCK', refundMethod: 'CREDIT', date: today } })
  assert(r.status === 400, `Exceed qty rejected (got ${r.status})`)

  // Return remaining 2 should succeed
  r = await admin.api('/sales/credit-notes', { method: 'POST', body: { customerId, saleId, variantId, quantity: 2, reason: 'Final return', disposition: 'RESTOCK', refundMethod: 'CREDIT', date: today } })
  assert(r.status === 201, `Final 2 RESTOCK ok (got ${r.status})`)
  r = await admin.api('/reports/water/fg-valuation')
  const fgStoreFinal = (r.data?.data?.rows || []).filter((x) => x.location === 'FG_STORE' && x.variant === 'CRET-50cl').reduce((s, x) => s + Number(x.packs), 0)
  assert(fgStoreFinal === 8, `FG_STORE final 8 (got ${fgStoreFinal})`) // was 6 +2

  // ========== 5. List credit notes
  log('\n5. List credit notes')
  r = await admin.api('/sales/credit-notes')
  assert(r.status === 200, `List CN (got ${r.status})`)
  assert((r.data?.data || []).length >= 4, `At least 4 CNs (got ${(r.data?.data || []).length})`)
  const found = (r.data?.data || []).find((c) => c.creditNoteNumber === cr1.creditNoteNumber)
  assert(!!found, 'First CR appears in list')
  assert(found?.variant?.label === 'CRET-50cl', `Variant label ${found?.variant?.label}`)

  // ========== 6. RBAC — viewer cannot create, can list
  log('\n6. RBAC')
  r = await viewer.api('/sales/credit-notes', { method: 'POST', body: { customerId, saleId, variantId, quantity: 1, reason: 'Viewer', disposition: 'RESTOCK', date: today } })
  assert(r.status === 403, `Viewer blocked (got ${r.status})`)
  r = await viewer.api('/sales/credit-notes')
  assert(r.status === 200, `Viewer list allowed (got ${r.status})`)

  // ========== 7. Trial balance
  log('\n7. Trial balance balanced')
  r = await admin.api('/finance/trial-balance')
  const t = r.data?.data?.totals || {}
  const diff = Math.abs(Number(t.totalDebit) - Number(t.totalCredit))
  assert(diff <= 0.01, `TB balanced (Dr ${t.totalDebit} = Cr ${t.totalCredit}, diff ${diff})`)

  // Cleanup
  r = await sa.api(`/platform/tenants/${tenantId}`, { method: 'PATCH', body: { isActive: false } })
  assert(r.status === 200, 'Tenant deactivated')

  const passed = results.filter(x => x.pass).length
  log(`\nPassed: ${passed}/${results.length}`)
  log(results.length === passed ? 'All tests passed!' : 'SOME TESTS FAILED')
  process.exit(results.length === passed ? 0 : 1)
}

main().catch((e) => {
  log(`\nFatal: ${e.message}\n${e.stack}`)
  const passed = results.filter(x => x.pass).length
  log(`Passed: ${passed}/${results.length}`)
  process.exit(1)
})
