// watERPax tenant-isolation probe: cross-tenant stock + idempotency-key leaks.
// Self-contained: bootstraps two tenants. Run: BASE_URL=... ADMIN_PASSWORD=... node scripts/_tenant_isolation.e2e.mjs
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
let passCount = 0
function log(m) { console.log(m) }
function assert(pass, message, detail) {
  results.push({ pass: !!pass, message })
  if (pass) passCount++
  log(`${pass ? '  PASS' : '  FAIL'} ${message}`)
  if (!pass) {
    if (detail !== undefined) log(`  detail: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    throw new Error(message)
  }
}

function createSession() {
  const cookies = new Map()
  return {
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
}

async function main() {
  const ts = Date.now()
  log('=== watERPax Tenant Isolation E2E ===')
  const sa = createSession()

  let r = await sa.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')

  const mkTenant = async (tag) => {
    r = await sa.api('/platform/tenants', { method: 'POST', body: { name: `Iso ${tag} ${ts}`, slug: `iso-${tag}-${ts}` } })
    assert(r.status === 201, `Tenant ${tag} created`)
    const tenantId = r.data?.data?.id
    const username = `isoadmin-${tag}-${ts}@test.local`
    r = await sa.api(`/platform/tenants/${tenantId}/users`, {
      method: 'POST', body: { username, password: 'IsoPass12345!', role: 'ADMIN' },
    })
    assert(r.status === 201, `Tenant ${tag} admin created`)
    const s = createSession()
    r = await s.api('/auth/login', { method: 'POST', body: { username, password: 'IsoPass12345!' } })
    assert(r.status === 200, `Tenant ${tag} admin login`)
    return s
  }

  const A = await mkTenant('a')
  const B = await mkTenant('b')

  // --- Stock isolation: A owns material M with 10 units on hand ---
  const codeM = `XISO-${ts}`
  r = await A.api('/inventory/materials', {
    method: 'POST', body: { code: codeM, name: 'Iso Resin', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 100, minStock: 0 },
  })
  assert(r.status === 201, 'A creates material M')
  const matA = r.data?.data?.id
  assert(!!matA, 'Material M id returned')

  r = await A.api('/inventory/movements', {
    method: 'POST', body: { materialId: matA, type: 'IN', quantity: 10, notes: 'iso seed' },
  })
  assert(r.status === 201, 'A records IN movement of 10')

  const stockOf = async (s, id) => {
    const g = await s.api('/inventory/materials')
    if (g.status !== 200) return null
    const row = (g.data?.data || []).find((m) => m.id === id)
    return row ? Number(row.totalStock) : null
  }
  assert((await stockOf(A, matA)) === 10, 'A sees 10 units on hand')

  // B must not see, touch, or move A's material.
  r = await B.api(`/inventory/materials/${matA}`)
  assert(r.status === 404, `B GET material M -> 404 (got ${r.status})`, r.data)
  r = await B.api('/inventory/movements', {
    method: 'POST', body: { materialId: matA, type: 'IN', quantity: 5, notes: 'cross-tenant attempt' },
  })
  assert(r.status === 404, `B movement on M -> 404 (got ${r.status})`, r.data)
  assert((await stockOf(A, matA)) === 10, "A stock unchanged at 10 after B's attempt")

  // --- Idempotency-key isolation: same header, different tenants ---
  const IDEM_KEY = `iso-key-${ts}`
  const mkMat = async (s, code) => s.api('/inventory/materials', {
    method: 'POST', headers: { 'Idempotency-Key': IDEM_KEY },
    body: { code, name: `Iso ${code}`, category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 50, minStock: 0 },
  })

  r = await mkMat(A, `IDEMA-${ts}`)
  assert(r.status === 201, 'A creates with key K')
  const idA = r.data?.data?.id

  r = await mkMat(A, `IDEMA-${ts}`)
  assert(r.status === 201 && r.data?.data?.id === idA, 'A replay with key K returns cached own response')

  r = await mkMat(B, `IDEMB-${ts}`)
  assert(r.status === 201, `B creates with same key K -> 201 (got ${r.status})`, r.data)
  assert(r.data?.data?.code === `IDEMB-${ts}`, "B gets its OWN material, not A's cached response", r.data?.data)
  assert(r.data?.data?.id !== idA, "B's material id differs from A's")

  r = await A.api('/inventory/materials')
  const codesA = (r.data?.data || []).map((m) => m.code)
  assert(codesA.includes(codeM) && codesA.includes(`IDEMA-${ts}`) && !codesA.includes(`IDEMB-${ts}`),
    'A lists only its own materials', codesA)
  r = await B.api('/inventory/materials')
  const codesB = (r.data?.data || []).map((m) => m.code)
  assert(codesB.includes(`IDEMB-${ts}`) && !codesB.includes(codeM) && !codesB.includes(`IDEMA-${ts}`),
    'B lists only its own materials', codesB)

  log(`\n${passCount}/${results.length} isolation checks passed`)
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`)
  console.error(`${passCount}/${results.length} checks passed before failure`)
  process.exit(1)
})
