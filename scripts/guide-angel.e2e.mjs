// Guide Angel E2E — fresh tenant -> draft -> validate -> complete -> idempotent -> isolation.
// Mirrors scripts/smoke-test.mjs session/cookie/CSRF harness. Plain node, no deps.
// Usage: BASE_URL=http://127.0.0.1:3001/api ADMIN_PASSWORD=... node scripts/guide-angel.e2e.mjs
import { readFileSync } from 'fs'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001/api'
const results = []

function envFromFile(path, key) {
  try {
    const content = readFileSync(path, 'utf8')
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (!match) return undefined
    return match[1].trim().replace(/^"|"$/g, '')
  } catch {
    return undefined
  }
}

const USERNAME = process.env.SMOKE_USER || 'superadmin'
const PASSWORD = process.env.PASSWORD
  || process.env.SUPERADMIN_PASSWORD
  || envFromFile('apps/backend/.env', 'ADMIN_PASSWORD')
  || process.env.ADMIN_PASSWORD

if (!PASSWORD) {
  console.error('No password available. Set PASSWORD, SUPERADMIN_PASSWORD, or ADMIN_PASSWORD env var.')
  process.exit(1)
}

const ts = Date.now().toString(36)
const TENANT_SLUG = `ga-factory-${ts}`
const TENANT_NAME = `GA Factory ${ts}`
const ADMIN_USERNAME = `ga-admin-${ts}@test.local`
const ADMIN_PASSWORD = 'GaPass123!'

function log(msg) {
  console.log(msg)
}

function assert(condition, message) {
  if (condition) {
    log(`  ✓ ${message}`)
    results.push({ pass: true, message })
  } else {
    log(`  ✗ ${message}`)
    results.push({ pass: false, message })
  }
}

function createSession() {
  const cookies = new Map()
  const session = {
    setCookies(res) {
      const headers = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : []
      for (const h of headers) {
        const nameValue = h.split(';')[0].trim()
        const eq = nameValue.indexOf('=')
        if (eq === -1) continue
        const name = nameValue.slice(0, eq)
        const value = nameValue.slice(eq + 1).replace(/^"|"$/g, '')
        cookies.set(name, value)
      }
    },
    cookieHeader() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    csrf() {
      return cookies.get('waterpax_csrf') || ''
    },
    hasCookie(name) {
      return cookies.has(name)
    },
    async api(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase()
      const opts = {
        method,
        headers: { ...(options.headers || {}) },
      }
      if (options.body !== undefined) {
        opts.headers['Content-Type'] = 'application/json'
        opts.body = JSON.stringify(options.body)
      }
      const cookieHeader = session.cookieHeader()
      if (cookieHeader) opts.headers.Cookie = cookieHeader
      const isSafe = ['GET', 'HEAD', 'OPTIONS'].includes(method)
      if (!isSafe && options.csrf !== false && session.csrf()) {
        opts.headers['x-waterpax-csrf'] = decodeURIComponent(session.csrf())
      }
      const res = await fetch(`${BASE_URL}${path}`, opts)
      session.setCookies(res)
      const data = await res.json().catch(() => null)
      return { status: res.status, data }
    }
  }
  return session
}

async function run() {
  log('=== watERPax Guide Angel E2E ===')
  log(`Target: ${BASE_URL}\n`)

  const superadmin = createSession()
  const tenantAdmin = createSession()
  let tenantId = null
  let journalEntryId = null
  const goLiveDate = new Date().toISOString().slice(0, 10)
  const draft = {
    goLiveDate,
    cashBalance: 50000,
    bankAccounts: [],
    loans: 0,
    fixedAssets: 0,
    accumulatedDepreciation: 0,
    ownerCapital: 0,
    customerBalances: [],
    supplierBalances: [],
    stockItems: [],
  }

  // 1. Superadmin login + fresh tenant + tenant ADMIN user
  log('1. Superadmin login & tenant bootstrap')
  try {
    const login = await superadmin.api('/auth/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } })
    assert(login.status === 200, `Superadmin login returns 200 (got ${login.status})`)
    assert(superadmin.hasCookie('waterpax_csrf'), 'CSRF cookie set')

    const tenant = await superadmin.api('/platform/tenants', { method: 'POST', body: { name: TENANT_NAME, slug: TENANT_SLUG } })
    assert(tenant.status === 201, `Tenant creation returns 201 (got ${tenant.status})`)
    tenantId = tenant.data?.data?.id
    assert(!!tenantId, 'Tenant ID returned')

    const user = await superadmin.api(`/platform/tenants/${tenantId}/users`, {
      method: 'POST',
      body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'ADMIN' },
    })
    assert(user.status === 201, `Tenant ADMIN creation returns 201 (got ${user.status})`)
  } catch (e) {
    assert(false, `Bootstrap failed: ${e.message}`)
  }

  // 2. Tenant admin login
  log('\n2. Tenant admin login')
  try {
    const res = await tenantAdmin.api('/auth/login', { method: 'POST', body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } })
    assert(res.status === 200, `Tenant admin login returns 200 (got ${res.status})`)
    assert(!!res.data?.data?.user?.tenantId, 'Tenant admin has tenantId')
  } catch (e) {
    assert(false, `Tenant admin login failed: ${e.message}`)
  }

  // 3. Guide Angel data + minimal seed (1 material, 1 customer, 1 supplier)
  log('\n3. Guide Angel data & seed')
  try {
    const before = await tenantAdmin.api('/guide-angel/data')
    assert(before.status === 200, `GET /guide-angel/data returns 200 (got ${before.status})`)

    const material = await tenantAdmin.api('/inventory/materials', {
      method: 'POST',
      body: { code: `GAMAT-${ts}`, name: 'GA Preform', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 100 },
    })
    assert(material.status === 201, `Material creation returns 201 (got ${material.status})`)

    const customer = await tenantAdmin.api('/customers', { method: 'POST', body: { name: 'GA Customer' } })
    assert(customer.status === 201, `Customer creation returns 201 (got ${customer.status})`)

    const supplier = await tenantAdmin.api('/suppliers', { method: 'POST', body: { name: 'GA Supplier' } })
    assert(supplier.status === 201, `Supplier creation returns 201 (got ${supplier.status})`)

    const after = await tenantAdmin.api('/guide-angel/data')
    const d = after.data?.data || {}
    assert(after.status === 200 && (d.materials || []).length >= 1, 'Materials present in data')
    assert((d.customers || []).length >= 1, 'Customers present in data')
    assert((d.suppliers || []).length >= 1, 'Suppliers present in data')
  } catch (e) {
    assert(false, `Seed failed: ${e.message}`)
  }

  // 4. Save + validate draft
  log('\n4. Save & validate draft')
  try {
    const save = await tenantAdmin.api('/guide-angel/save', { method: 'POST', body: { draft } })
    assert(save.status === 200, `POST /guide-angel/save returns 200 (got ${save.status})`)

    const validate = await tenantAdmin.api('/guide-angel/validate', { method: 'POST', body: { draft } })
    assert(validate.status === 200, `POST /guide-angel/validate returns 200 (got ${validate.status})`)
    assert(validate.data?.data?.valid === true, `Draft valid:true (got ${JSON.stringify(validate.data?.data?.valid)})`)
  } catch (e) {
    assert(false, `Save/validate failed: ${e.message}`)
  }

  // 5. Complete -> opening JE
  log('\n5. Complete setup')
  try {
    const done = await tenantAdmin.api('/guide-angel/complete', { method: 'POST', body: { confirm: true } })
    assert(done.status === 200, `POST /guide-angel/complete returns 200 (got ${done.status})`)
    journalEntryId = done.data?.data?.journalEntryId
    assert(!!journalEntryId, `journalEntryId present (got ${journalEntryId})`)
  } catch (e) {
    assert(false, `Complete failed: ${e.message}`)
  }

  // 6. Opening JE balances (trial-balance debits == credits + journal lookup)
  log('\n6. Opening JE balances')
  try {
    const tb = await tenantAdmin.api('/finance/trial-balance')
    assert(tb.status === 200, `GET /finance/trial-balance returns 200 (got ${tb.status})`)
    const totals = tb.data?.data?.totals || {}
    const diff = Math.abs(Number(totals.totalDebit || 0) - Number(totals.totalCredit || 0))
    assert(diff <= 0.01, `Trial balance debits == credits (Dr ${totals.totalDebit}, Cr ${totals.totalCredit})`)

    const entries = await tenantAdmin.api('/finance/journal?sourceModule=OPENING')
    const list = entries.data?.data
    const rows = Array.isArray(list) ? list : (list?.entries || list?.data || [])
    assert(entries.status === 200 && rows.some((r) => r.id === journalEntryId || String(r.reference || '').startsWith('GUIDE-ANGEL')), 'Opening JE found via sourceModule=OPENING')
  } catch (e) {
    assert(false, `Balance verification failed: ${e.message}`)
  }

  // 7. Idempotent re-complete
  log('\n7. Idempotent re-complete')
  try {
    const again = await tenantAdmin.api('/guide-angel/complete', { method: 'POST', body: { confirm: true } })
    assert(again.status === 200, `Second complete returns 200 (got ${again.status})`)
    assert(again.data?.data?.alreadyCompleted === true, `alreadyCompleted:true (got ${JSON.stringify(again.data?.data?.alreadyCompleted)})`)
  } catch (e) {
    assert(false, `Re-complete failed: ${e.message}`)
  }

  // 8. Tenant isolation
  log('\n8. Tenant isolation')
  try {
    const platform = await tenantAdmin.api('/platform/tenants')
    assert(platform.status === 403, `Tenant admin blocked from /platform/tenants (got ${platform.status})`)
  } catch (e) {
    assert(false, `Isolation check failed: ${e.message}`)
  }

  // Summary
  log('\n=== Summary ===')
  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  log(`Passed: ${passed}/${results.length}`)
  log(`Failed: ${failed}/${results.length}`)
  if (failed > 0) {
    log('\nFailed tests:')
    results.filter((r) => !r.pass).forEach((r) => log(`  - ${r.message}`))
    process.exit(1)
  } else {
    log('\nAll tests passed!')
    process.exit(0)
  }
}

run().catch((e) => {
  log(`\nFatal error: ${e.message}`)
  process.exit(1)
})
