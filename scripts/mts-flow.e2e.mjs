// watERPax MTS flow E2E: PO -> receive -> run -> sale -> pay, with ledger assertions.
// Self-contained: bootstraps its own tenant. Run: BASE_URL=... ADMIN_PASSWORD=... node scripts/mts-flow.e2e.mjs
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001/api'

function envFromFile(path, key) {
  try {
    const { readFileSync } = require('fs')
    const m = readFileSync(path, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
  } catch { return undefined }
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  || envFromFile('apps/backend/.env', 'ADMIN_PASSWORD')
  || 'admin123'

const results = []
function log(m) { console.log(m) }
function assert(pass, message, detail) {
  results.push({ pass: !!pass, message })
  log(`${pass ? '  ✓' : '  ✗'} ${message}`)
  if (!pass) {
    if (detail !== undefined) log(`  detail: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    throw new Error(message)
  }
}

function createSession() {
  const cookies = new Map()
  const session = {
    cookie: (n) => cookies.get(n),
    async api(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase()
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
      const ck = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
      if (ck) headers.Cookie = ck
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const csrf = cookies.get('waterpax_csrf')
        if (csrf && options.csrf !== false) headers['x-waterpax-csrf'] = decodeURIComponent(csrf)
      }
      const res = await fetch(`${BASE_URL}${path}`, {
        method, headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
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
  return session
}

async function main() {
  const ts = Date.now()
  log('=== watERPax MTS Flow E2E ===')
  const superadmin = createSession()

  let r = await superadmin.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')

  r = await superadmin.api('/platform/tenants', { method: 'POST', body: { name: `Flow Factory ${ts}`, slug: `flow-${ts}` } })
  assert(r.status === 201, 'Flow tenant created')
  const tenantId = r.data?.data?.id

  const username = `flowadmin-${ts}@test.local`
  r = await superadmin.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username, password: 'Flow12345!', role: 'ADMIN' },
  })
  assert(r.status === 201, 'Flow admin created')

  const admin = createSession()
  r = await admin.api('/auth/login', { method: 'POST', body: { username, password: 'Flow12345!' } })
  assert(r.status === 200, 'Flow admin login')

  // Materials
  const mkMat = async (code, name, uom, cost) => {
    const m = await admin.api('/inventory/materials', {
      method: 'POST', body: { code, name, category: 'RAW_MATERIAL', unitOfMeasure: uom, costPrice: cost, minStock: 0 },
    })
    assert(m.status === 201, `Material ${code} created`)
    return m.data?.data?.id
  }
  const pfId = await mkMat(`F-PF-${ts}`, 'Flow Preform', 'pcs', 10)
  const capId = await mkMat(`F-CAP-${ts}`, 'Flow Cap', 'pcs', 2)

  // Product + variant + BOM
  r = await admin.api('/products', { method: 'POST', body: { code: `FLOW-${ts}`, name: 'Flow Water', category: 'BOTTLED' } })
  assert(r.status === 201, 'Product created')
  r = await admin.api(`/products/${r.data?.data?.id}/variants`, {
    method: 'POST', body: { label: 'Flow-50cl', packSize: 12, pricePerUnit: 1800 },
  })
  assert(r.status === 201, 'Variant created')
  const variantId = r.data?.data?.id
  r = await admin.api(`/products/variants/${variantId}/bom`, {
    method: 'PUT',
    body: { lines: [{ materialId: pfId, qtyPerPack: 12 }, { materialId: capId, qtyPerPack: 12 }] },
  })
  assert(r.status === 200 && r.data?.data?.length === 2, 'BOM with 2 lines saved')

  // Customer
  r = await admin.api('/customers', { method: 'POST', body: { name: `Flow Retail ${ts}` } })
  assert(r.status === 201, 'Customer created')
  const customerId = r.data?.data?.id

  // PO with lot spec -> receive
  r = await admin.api('/procurement/purchase-orders', {
    method: 'POST',
    body: {
      supplier: 'Flow Plastics',
      items: [{ materialId: pfId, quantity: 240, unitPrice: 10 }],
    },
  })
  assert(r.status === 201, 'PO created')
  const poId = r.data?.data?.id
  r = await admin.api(`/procurement/purchase-orders/${poId}/receive`, { method: 'POST', body: {} })
  assert(r.status === 201 && r.data?.data?.po?.status === 'RECEIVED', 'PO received, no rolls')

  // Stock the caps too (no PO for them)
  r = await admin.api(`/inventory/materials/${capId}/adjust-stock`, {
    method: 'PATCH', body: { newQuantity: 500, reason: 'Flow E2E stocking' },
  })
  assert(r.status === 200, 'Caps stocked')

  // Run lifecycle
  r = await admin.api('/production-runs', { method: 'POST', body: { variantId, plannedPacks: 20 } })
  assert(r.status === 201, 'Run planned')
  const runId = r.data?.data?.id
  r = await admin.api(`/production-runs/${runId}/start`, { method: 'POST', body: {} })
  assert(r.status === 200, 'Run started')
  r = await admin.api(`/production-runs/${runId}/complete`, { method: 'POST', body: { actualPacks: 20 } })
  assert(r.status === 200 && !!r.data?.data?.journalEntryId, 'Run completed with JE')

  // Sale lifecycle with discounted line (ADMIN has sales:discount)
  r = await admin.api('/sales', {
    method: 'POST', body: { customerId, lines: [{ variantId, qty: 6, unitPrice: 1700 }] },
  })
  assert(
    r.status === 201 && Number(r.data?.data?.lines?.[0]?.unitPrice) === 1700,
    'Draft with discounted price',
    { status: r.status, unitPrice: r.data?.data?.lines?.[0]?.unitPrice, error: r.data?.error }
  )
  const saleId = r.data?.data?.id
  r = await admin.api(`/sales/${saleId}/confirm`, { method: 'POST', body: {} })
  assert(r.status === 200, 'Sale confirmed')
  r = await admin.api(`/sales/${saleId}/deliver`, { method: 'POST', body: { payment: { method: 'CASH' } } })
  assert(r.status === 200 && r.data?.data?.sale?.status === 'COMPLETED', 'Delivered + cash = COMPLETED')
  assert(!!r.data?.data?.payment?.receiptNumber, 'Receipt issued')

  // Negative paths
  r = await admin.api(`/sales/${saleId}/deliver`, { method: 'POST', body: {} })
  assert(r.status === 400, `Re-deliver rejected (got ${r.status})`)
  r = await admin.api(`/sales/${saleId}/cancel`, { method: 'POST', body: {} })
  assert(r.status === 400, `Cancel-after-deliver rejected (got ${r.status})`)
  r = await admin.api(`/sales/${saleId}/payments`, {
    method: 'POST', body: { amount: 1, method: 'CASH' },
  })
  assert(r.status === 400, `Payment on completed sale rejected (got ${r.status})`)

  // Variance: procured 240 PF50, consumed 240, unexplained 0
  r = await admin.api('/reports/water/variance')
  const pf = (r.data?.data?.rows || []).find((x) => x.code === `F-PF-${ts}`)
  assert(r.status === 200 && Number(pf?.procured) === 240, `Variance procured=240 (got ${pf?.procured})`)
  assert(Number(pf?.unexplained) === 0, `Variance unexplained=0 (got ${pf?.unexplained})`)

  // Trial balance
  r = await admin.api('/finance/trial-balance')
  const t = r.data?.data?.totals || {}
  assert(Math.abs(Number(t.totalDebit) - Number(t.totalCredit)) <= 0.01, `TB balanced (Dr ${t.totalDebit} = Cr ${t.totalCredit})`)

  // Cleanup
  r = await superadmin.api(`/platform/tenants/${tenantId}`, { method: 'PATCH', body: { isActive: false } })
  assert(r.status === 200, 'Flow tenant deactivated')

  const passed = results.filter((x) => x.pass).length
  log(`\nPassed: ${passed}/${results.length}`)
  process.exit(0)
}

main().catch((e) => {
  log(`\nFatal: ${e.message}`)
  const passed = results.filter((x) => x.pass).length
  log(`Passed: ${passed}/${results.length}`)
  process.exit(1)
})
