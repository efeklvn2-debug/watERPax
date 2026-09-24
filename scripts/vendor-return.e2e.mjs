// watERPax Vendor Return / Credit Notes E2E
// Tests Layer 2: supplier credit notes, partial receiving, GL verification.
// Run: BASE_URL=... SMOKE_USER=superadmin node scripts/vendor-return.e2e.mjs

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
  log('=== Vendor Return / Credit Notes E2E ===')

  // --- Bootstrap tenant ---
  const sa = createSession()
  let r = await sa.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')

  r = await sa.api('/platform/tenants', { method: 'POST', body: { name: `VReturn Factory ${ts}`, slug: `vreturn-${ts}` } })
  assert(r.status === 201, 'Tenant created')
  const tenantId = r.data?.data?.id

  const username = `vradmin-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username, password: 'VRPass12345!', role: 'ADMIN' },
  })
  assert(r.status === 201, 'Tenant admin created')

  const admin = createSession()
  r = await admin.api('/auth/login', { method: 'POST', body: { username, password: 'VRPass12345!' } })
  assert(r.status === 200, 'Tenant admin login')

  // Create a VIEWER for RBAC
  const viewerName = `vrviewer-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username: viewerName, password: 'VView12345!', role: 'VIEWER' },
  })
  assert(r.status === 201, 'Viewer created')
  const viewer = createSession()
  r = await viewer.api('/auth/login', { method: 'POST', body: { username: viewerName, password: 'VView12345!' } })
  assert(r.status === 200, 'Viewer login')

  // --- Seed default COA accounts for this tenant ---
  r = await admin.api('/finance/seed', { method: 'POST' })
  assert(r.status === 200, 'Default COA accounts seeded')

  // --- Create supplier + 2 materials ---
  r = await admin.api('/suppliers', {
    method: 'POST',
    body: { name: `VR Supplier ${ts}` },
  })
  assert(r.status === 201, 'Supplier created')
  const supplierId = r.data?.data?.id

  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `VR-MAT-A-${ts}`, name: 'Preform 50cl', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 10, minStock: 0 },
  })
  assert(r.status === 201, 'Material A created')
  const matA = r.data?.data?.id

  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `VR-MAT-B-${ts}`, name: 'Cap 50cl', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 5, minStock: 0 },
  })
  assert(r.status === 201, 'Material B created')
  const matB = r.data?.data?.id

  const today = new Date().toISOString().split('T')[0]

  // ========== TEST 1: Create PO with 2 line items ==========
  log('\n1. Create PO with 2 line items')
  r = await admin.api('/procurement/purchase-orders', {
    method: 'POST',
    body: {
      supplier: `VR Supplier ${ts}`,
      items: [
        { materialId: matA, quantity: 50, unitPrice: 10 },
        { materialId: matB, quantity: 30, unitPrice: 5 },
      ],
    },
  })
  assert(r.status === 201, `PO created (got ${r.status})`)
  const poId = r.data?.data?.id
  assert(!!poId, 'PO ID returned')
  const poNumber = r.data?.data?.poNumber
  assert(!!poNumber, `PO number: ${poNumber}`)

  // ========== TEST 2: Partial receive — only material A (30 of 50) ==========
  log('\n2. Partial receive — 30 of material A (of 50)')
  // Fetch PO to get line item IDs
  r = await admin.api(`/procurement/purchase-orders/${poId}`)
  const poItems = r.data?.data?.items || r.data?.data?.lineItems || []
  const lineA = poItems.find(i => i.materialId === matA)
  const lineB = poItems.find(i => i.materialId === matB)
  assert(!!lineA, 'Found line item for material A')
  assert(!!lineB, 'Found line item for material B')

  // Receive ALL items but with partial qty for A and full for B
  r = await admin.api(`/procurement/purchase-orders/${poId}/receive`, {
    method: 'POST',
    body: {
      receivedLines: [
        { lineItemId: lineA.id, receivedQty: 30 },
        { lineItemId: lineB.id, receivedQty: 0 },
      ],
    },
  })
  assert(r.status === 201, `Partial receive (got ${r.status})`)
  const poAfterPartial = r.data?.data?.po
  assert(poAfterPartial?.status === 'PARTIALLY_RECEIVED', `PO status PARTIALLY_RECEIVED (got ${poAfterPartial?.status})`)

  // Check stock of material A = 30, B = 0
  r = await admin.api('/inventory/materials')
  const mats = r.data?.data || []
  const stockA = mats.find(m => m.id === matA)
  const totalA = (stockA?.stocks || []).reduce((s, st) => s + Number(st.quantity || 0), 0)
  assert(totalA === 30, `Material A stock = 30 (got ${totalA})`)

  // ========== TEST 3: Receive remaining — 20 of A + 30 of B ==========
  log('\n3. Receive remaining — 20 A + 30 B')
  r = await admin.api(`/procurement/purchase-orders/${poId}/receive`, {
    method: 'POST',
    body: {
      receivedLines: [
        { lineItemId: lineA.id, receivedQty: 20 },
        { lineItemId: lineB.id, receivedQty: 30 },
      ],
    },
  })
  assert(r.status === 201, `Final receive (got ${r.status})`)
  const poAfterFull = r.data?.data?.po
  assert(poAfterFull?.status === 'RECEIVED', `PO status RECEIVED (got ${poAfterFull?.status})`)

  // Stock A = 50 (30+20), Stock B = 30
  r = await admin.api('/inventory/materials')
  const mats2 = r.data?.data || []
  const stockA2 = mats2.find(m => m.id === matA)
  const totalA2 = (stockA2?.stocks || []).reduce((s, st) => s + Number(st.quantity || 0), 0)
  assert(totalA2 === 50, `Material A stock = 50 (got ${totalA2})`)

  const stockB = mats2.find(m => m.id === matB)
  const totalB = (stockB?.stocks || []).reduce((s, st) => s + Number(st.quantity || 0), 0)
  assert(totalB === 30, `Material B stock = 30 (got ${totalB})`)

  // ========== TEST 4: Create credit note for material A (10 pcs defective) ==========
  log('\n4. Create credit note — 10 pcs defective material A')
  r = await admin.api('/procurement/supplier-credit-notes', {
    method: 'POST',
    body: {
      supplierId,
      poId,
      amount: 100,  // 10 pcs * ₦10
      date: today,
      reason: 'Defective batch',
      materialId: matA,
      quantity: 10,
    },
  })
  assert(r.status === 201, `Credit note created (got ${r.status})`)
  const cn = r.data?.data
  assert(!!cn?.id, 'Credit note ID returned')
  assert(cn.creditNoteNumber?.startsWith('CN-'), `Credit note number: ${cn.creditNoteNumber}`)

  // ========== TEST 5: Verify credit note JE — Dr 2000 / Cr 1300 ==========
  log('\n5. Verify credit note JE')
  r = await admin.api(`/finance/journal?sourceModule=PROCUREMENT&limit=5`)
  const journalEntries = r.data?.data || []
  // Find the entry whose description mentions the credit note number or "Returned"
  const cnEntry = journalEntries.find(e =>
    (e.description || '').toLowerCase().includes('credit note') ||
    (e.description || '').toLowerCase().includes('returned to vendor')
  )
  assert(!!cnEntry, 'Credit note JE found in journal')
  const cnDebit = cnEntry.lines.find(l => Number(l.debit) > 0)
  const cnCredit = cnEntry.lines.find(l => Number(l.credit) > 0)
  assert(findAccountCode(cnDebit) === '2000', `CN Dr 2000 AP (got ${findAccountCode(cnDebit)})`)
  assert(findAccountCode(cnCredit) === '1300', `CN Cr 1300 Inventory (got ${findAccountCode(cnCredit)})`)

  // ========== TEST 6: Verify material A stock decremented by 10 ==========
  log('\n6. Material A stock decremented by 10')
  r = await admin.api('/inventory/materials')
  const mats3 = r.data?.data || []
  const stockA3 = mats3.find(m => m.id === matA)
  const totalA3 = (stockA3?.stocks || []).reduce((s, st) => s + Number(st.quantity || 0), 0)
  assert(totalA3 === 40, `Material A stock = 40 after CN (got ${totalA3})`)

  // ========== TEST 7: List credit notes ==========
  log('\n7. List credit notes')
  r = await admin.api('/procurement/supplier-credit-notes')
  assert(r.status === 200, `List CN (got ${r.status})`)
  const cnList = r.data?.data || []
  assert(cnList.length >= 1, `At least 1 credit note (got ${cnList.length})`)
  const found = cnList.find(c => c.id === cn.id)
  assert(!!found, 'Created CN appears in list')

  // ========== TEST 8: RBAC — VIEWER cannot create credit note ==========
  log('\n8. RBAC — Viewer cannot create credit note')
  r = await viewer.api('/procurement/supplier-credit-notes', {
    method: 'POST',
    body: {
      supplierId: cn.supplierId,
      amount: 50,
      date: today,
      reason: 'Viewer attempt',
    },
  })
  assert(r.status === 403, `Viewer blocked (got ${r.status})`)

  // ========== TEST 9: RBAC — Viewer CAN list credit notes (has procurement:read) ==========
  log('\n9. RBAC — Viewer can list credit notes')
  r = await viewer.api('/procurement/supplier-credit-notes')
  assert(r.status === 200, `Viewer list allowed (got ${r.status})`)

  // ========== TEST 10: Trial balance balanced ==========
  log('\n10. Trial balance balanced')
  r = await admin.api('/finance/trial-balance')
  const t = r.data?.data?.totals || {}
  const diff = Math.abs(Number(t.totalDebit) - Number(t.totalCredit))
  assert(diff <= 0.01, `TB balanced (Dr ${t.totalDebit} = Cr ${t.totalCredit}, diff ${diff})`)

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
