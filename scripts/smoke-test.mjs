import { writeFileSync, appendFileSync, existsSync } from 'fs'
import { readFileSync } from 'fs'
import { createHmac } from 'crypto'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001/api'
const LOG_FILE = 'scripts/smoke-test.log'
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

const WAIT_UNLOCK = process.env.SMOKE_TEST_WAIT_UNLOCK === '1'
const ts = Date.now().toString(36)
const TENANT_SLUG = `test-factory-${ts}`
const TENANT_NAME = 'Test Factory'
const ADMIN_USERNAME = `smoke-admin-${ts}@test.local`
const ADMIN_PASSWORD = 'SmokePass123!'
const ADMIN_PASSWORD2 = 'SmokePass456!'
const LOCK_USERNAME = `lockuser-${ts}@test.local`
const LOCK_PASSWORD = 'LockPass123!'

function log(msg) {
  console.log(msg)
  appendFileSync(LOG_FILE, msg + '\n')
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
    cookie(name) {
      return cookies.get(name)
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
        opts.headers['x-waterpax-csrf'] = session.csrf()
      }
      const res = await fetch(`${BASE_URL}${path}`, opts)
      session.setCookies(res)
      const data = await res.json().catch(() => null)
      return { status: res.status, data }
    }
  }
  return session
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(str) {
  let buffer = 0
  let bitsLeft = 0
  const bytes = []
  for (const char of str.toUpperCase()) {
    if (char === '=') break
    const val = BASE32_ALPHABET.indexOf(char)
    if (val === -1) continue
    buffer = (buffer << 5) | val
    bitsLeft += 5
    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 0xff)
      bitsLeft -= 8
    }
  }
  return Buffer.from(bytes)
}

function totpCode(secret, step = 30, digits = 6) {
  const counter = Math.floor(Date.now() / 1000 / step)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return String(code % 10 ** digits).padStart(digits, '0')
}

const TOTP_STATE_FILE = 'scripts/.2fa-secrets.json'

function loadTotpState() {
  try {
    return existsSync(TOTP_STATE_FILE) ? JSON.parse(readFileSync(TOTP_STATE_FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}

function saveTotpState(state) {
  writeFileSync(TOTP_STATE_FILE, JSON.stringify(state, null, 2))
}

async function loginWith2fa(session, username, password) {
  const res = await session.api('/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  if (res.status === 200) return res

  const code = res.data?.error?.code
  if (code !== '2FA_REQUIRED' && code !== '2FA_ENROLL_REQUIRED') return res
  const postAuthToken = res.data?.postAuthToken
  if (!postAuthToken) return res

  log(`  (2FA ${code} — completing verification)`)
  const stateKey = `${BASE_URL}:${username}`
  const state = loadTotpState()

  if (code === '2FA_ENROLL_REQUIRED') {
    const setup = await session.api('/auth/2fa/setup', {
      method: 'POST',
      body: { postAuthToken },
    })
    const secret = setup.data?.data?.secret
    assert(!!secret, `2FA setup returns secret (got ${setup.status})`)
    const enroll = await session.api('/auth/2fa/enroll', {
      method: 'POST',
      body: { postAuthToken, code: totpCode(secret) },
    })
    assert(enroll.status === 200, `2FA enroll returns 200 (got ${enroll.status})`)
    state[stateKey] = { username, secret }
    saveTotpState(state)
    return { status: 200, data: enroll.data }
  }

  const saved = state[stateKey]
  assert(!!saved?.secret, `2FA secret persisted in ${TOTP_STATE_FILE} for ${username}`)
  const done = await session.api('/auth/2fa/verify-login', {
    method: 'POST',
    body: { postAuthToken, code: totpCode(saved.secret) },
  })
  assert(done.status === 200, `2FA verify-login returns 200 (got ${done.status})`)
  return { status: 200, data: done.data }
}

async function run() {
  writeFileSync(LOG_FILE, '')
  log('=== FlexoPrint ERP Smoke Test (cookies + CSRF) ===')
  log(`Target: ${BASE_URL}`)
  log(`User: ${USERNAME}\n`)

  const superadmin = createSession()
  let tenantAdmin = null
  let tenantId = null
  let customerId = null

  // 0. Health + no-auth protection
  log('0. Health & unauthenticated access')
  try {
    const health = await superadmin.api('/health')
    assert(health.status === 200, `Health returns 200 (got ${health.status})`)
    assert(health.data?.status === 'healthy', `Health payload healthy (got ${JSON.stringify(health.data)})`)

    const bare = createSession()
    const noAuth = await bare.api('/inventory/materials')
    assert(noAuth.status === 401, `No auth on /inventory/materials returns 401 (got ${noAuth.status})`)
  } catch (e) {
    assert(false, `Health/no-auth checks failed: ${e.message}`)
  }

  // 1. Superadmin login — cookies, not Bearer (2FA-aware: SUPER_ADMIN is forced to enroll)
  log('\n1. Superadmin Login')
  try {
    const res = await loginWith2fa(superadmin, USERNAME, PASSWORD)
    assert(res.status === 200, `Login returns 200 (got ${res.status})`)
    assert(res.data?.data?.user?.username === USERNAME, `Login returns user (got ${res.data?.data?.user?.username})`)
    assert(!res.data?.data?.tokens, 'No tokens in response body (cookie-based)')
    assert(superadmin.hasCookie('waterpax_at'), 'Access token cookie set')
    assert(superadmin.hasCookie('waterpax_rt'), 'Refresh token cookie set')
    assert(superadmin.hasCookie('waterpax_csrf'), 'CSRF cookie set')
  } catch (e) {
    assert(false, `Superadmin login failed: ${e.message}`)
  }

  // 1b. Refresh token rotation (cookie-first, persists, rotates)
  log('\n1b. Refresh token rotation')
  try {
    const rtBefore = superadmin.cookie('waterpax_rt')
    assert(!!rtBefore, 'Refresh token cookie present after login')

    const refresh1 = await superadmin.api('/auth/refresh', { method: 'POST', body: {} })
    assert(refresh1.status === 200, `Refresh with empty body returns 200 (got ${refresh1.status})`)

    const rtAfter1 = superadmin.cookie('waterpax_rt')
    assert(!!rtAfter1 && rtAfter1 !== rtBefore, 'Refresh token rotated (cookie changed)')

    const meAfter = await superadmin.api('/auth/me')
    assert(meAfter.status === 200, `Protected call works after refresh (got ${meAfter.status})`)

    const grace = await superadmin.api('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: rtBefore },
    })
    assert(grace.status === 200, `Old token accepted within grace window (got ${grace.status})`)

    const rtAfter2 = superadmin.cookie('waterpax_rt')
    assert(!!rtAfter2 && rtAfter2 !== rtAfter1, 'Grace-refresh rotated token again (cookie changed)')

    const logout = await superadmin.api('/auth/logout', { method: 'POST' })
    assert(logout.status === 204, `Logout returns 204 (got ${logout.status})`)

    const afterLogout = await superadmin.api('/auth/refresh', { method: 'POST', body: {} })
    assert(afterLogout.status === 401, `Refresh after logout rejected (got ${afterLogout.status})`)

    const relogin = await loginWith2fa(superadmin, USERNAME, PASSWORD)
    assert(relogin.status === 200, `Re-login after refresh/logout works (got ${relogin.status})`)
  } catch (e) {
    assert(false, `Refresh rotation checks failed: ${e.message}`)
  }

  // 2. Tenant list (superadmin only)
  log('\n2. Superadmin platform access')
  try {
    const res = await superadmin.api('/platform/tenants')
    assert(res.status === 200, `GET /platform/tenants returns 200 (got ${res.status})`)
    assert(Array.isArray(res.data?.data), 'Tenant list is array')
  } catch (e) {
    assert(false, `Tenant list failed: ${e.message}`)
  }

  // 3. Create test tenant (unique slug per run)
  log('\n3. Create test tenant')
  try {
    const res = await superadmin.api('/platform/tenants', {
      method: 'POST',
      body: { name: TENANT_NAME, slug: TENANT_SLUG },
    })
    assert(res.status === 201, `Tenant creation returns 201 (got ${res.status})`)
    assert(!!res.data?.data?.id, 'Tenant ID returned')
    tenantId = res.data?.data?.id
  } catch (e) {
    assert(false, `Tenant creation failed: ${e.message}`)
  }

  // 4. Create tenant admin user
  log('\n4. Create tenant admin user')
  try {
    const res = await superadmin.api(`/platform/tenants/${tenantId}/users`, {
      method: 'POST',
      body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'ADMIN' },
    })
    assert(res.status === 201, `Tenant admin creation returns 201 (got ${res.status})`)
    assert(res.data?.data?.username === ADMIN_USERNAME, 'Tenant admin username returned')
  } catch (e) {
    assert(false, `Tenant admin creation failed: ${e.message}`)
  }

  // 5. Tenant admin login + isolation
  log('\n5. Tenant admin login & isolation')
  tenantAdmin = createSession()
  try {
    const res = await tenantAdmin.api('/auth/login', {
      method: 'POST',
      body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    })
    assert(res.status === 200, `Tenant admin login returns 200 (got ${res.status})`)
    assert(!!res.data?.data?.user?.tenantId, 'Tenant admin has tenantId')

    const platform = await tenantAdmin.api('/platform/tenants')
    assert(platform.status === 403, `Tenant admin blocked from /platform/tenants (got ${platform.status})`)
  } catch (e) {
    assert(false, `Tenant admin login/isolation failed: ${e.message}`)
  }

  // 6. CSRF enforcement
  log('\n6. CSRF enforcement')
  try {
    const noCsrf = await tenantAdmin.api('/customers', {
      method: 'POST',
      csrf: false,
      body: { name: 'CSRF Probe' },
    })
    assert(noCsrf.status === 403, `Mutation without CSRF returns 403 (got ${noCsrf.status})`)
    assert(noCsrf.data?.error?.code === 'CSRF_INVALID', `Error code CSRF_INVALID (got ${noCsrf.data?.error?.code})`)

    const withCsrf = await tenantAdmin.api('/customers', {
      method: 'POST',
      body: { name: 'Smoke Customer', code: `SMK-${ts}` },
    })
    assert(withCsrf.status === 201, `Mutation with CSRF succeeds (got ${withCsrf.status})`)
    customerId = withCsrf.data?.data?.id
  } catch (e) {
    assert(false, `CSRF checks failed: ${e.message}`)
  }

  // 7. Tenant data CRUD
  log('\n7. Tenant data CRUD')
  try {
    const read = await tenantAdmin.api(`/customers/${customerId}`)
    assert(read.status === 200, `Customer read returns 200 (got ${read.status})`)
    assert(read.data?.data?.name === 'Smoke Customer', 'Customer name matches')

    const update = await tenantAdmin.api(`/customers/${customerId}`, {
      method: 'PATCH',
      body: { name: 'Smoke Customer Updated' },
    })
    assert(update.status === 200, `Customer update returns 200 (got ${update.status})`)

    const list = await tenantAdmin.api('/customers')
    assert(list.status === 200 && Array.isArray(list.data?.data), 'Customer list is array')

    const material = await tenantAdmin.api('/inventory/materials', {
      method: 'POST',
      body: { code: `SMKMAT-${ts}`, name: 'Smoke Material', category: 'RAW_MATERIAL', costPrice: 100, minStock: 0 },
    })
    assert(material.status === 201, `Material creation returns 201 (got ${material.status})`)
    assert(!!material.data?.data?.id, 'Material ID returned')

    const product = await tenantAdmin.api('/products', {
      method: 'POST',
      body: { code: `SMKPROD-${ts}`, name: 'Smoke Water', category: 'BOTTLED' },
    })
    assert(product.status === 201, `Product creation returns 201 (got ${product.status})`)

    const variant = await tenantAdmin.api(`/products/${product.data?.data?.id}/variants`, {
      method: 'POST',
      body: { label: 'Smoke-50cl', packSize: 12, pricePerUnit: 1800 },
    })
    assert(variant.status === 201, `Variant creation returns 201 (got ${variant.status})`)

    const order = await tenantAdmin.api('/sales', {
      method: 'POST',
      body: {
        customerId,
        lines: [{ variantId: variant.data?.data?.id, qty: 2 }],
      },
    })
    assert(order.status === 201, `Sale creation returns 201 (got ${order.status})`)
    assert(!!order.data?.data?.saleNumber, `Sale number returned (got ${order.data?.data?.saleNumber})`)

    const po = await tenantAdmin.api('/procurement/purchase-orders', {
      method: 'POST',
      body: {
        supplier: 'Smoke Vendor',
        items: [{
          materialId: material.data?.data?.id,
          quantity: 50,
          unitPrice: 100,
        }],
      },
    })
    assert(po.status === 201, `PO creation returns 201 (got ${po.status})`)
    assert(!!po.data?.data?.poNumber, `PO number returned (got ${po.data?.data?.poNumber})`)

    const recv = await tenantAdmin.api(`/procurement/purchase-orders/${po.data?.data?.id}/receive`, {
      method: 'POST',
      body: {},
    })
    assert(recv.status === 201, `PO receive returns 201 (got ${recv.status})`)
    assert(recv.data?.data?.po?.status === 'RECEIVED', 'PO status RECEIVED')
    assert(!('rolls' in (recv.data?.data || {})), 'Receive creates no rolls')

    const mats = await tenantAdmin.api('/inventory/materials')
    const stocked = (mats.data?.data || []).find((m) => m.id === material.data?.data?.id)
    assert(mats.status === 200 && Number(stocked?.totalStock) === 50, `Stock IN posted (got ${stocked?.totalStock})`)
  } catch (e) {
    assert(false, `Tenant CRUD failed: ${e.message}`)
  }

  // 8. Idempotency
  log('\n8. Idempotency')
  try {
    const key = `smoke-${ts}-cust`
    const first = await tenantAdmin.api('/customers', {
      method: 'POST',
      body: { name: 'Idempotent Customer', code: `IDEM-${ts}` },
      headers: { 'Idempotency-Key': key },
    })
    assert(first.status === 201, `First idempotent create returns 201 (got ${first.status})`)
    const firstId = first.data?.data?.id

    const dup = await tenantAdmin.api('/customers', {
      method: 'POST',
      body: { name: 'Idempotent Customer', code: `IDEM-${ts}` },
      headers: { 'Idempotency-Key': key },
    })
    assert(dup.status === 201, `Replay with same key returns 201 (got ${dup.status})`)
    assert(!!dup.data?.data?.id && dup.data?.data?.id === firstId, 'Replay returns cached identical customer')

    const different = await tenantAdmin.api('/customers', {
      method: 'POST',
      body: { name: 'Second Idempotent Customer', code: `IDEM2-${ts}` },
      headers: { 'Idempotency-Key': `smoke-${ts}-cust-2` },
    })
    assert(different.status === 201 && different.data?.data?.id !== firstId, 'Different key creates a new customer')
  } catch (e) {
    assert(false, `Idempotency checks failed: ${e.message}`)
  }

  // 9. Login lockout (12.5)
  log('\n9. Login lockout')
  try {
    const created = await superadmin.api(`/platform/tenants/${tenantId}/users`, {
      method: 'POST',
      body: { username: LOCK_USERNAME, password: LOCK_PASSWORD, role: 'VIEWER' },
    })
    assert(created.status === 201, `Lockout test user created (got ${created.status})`)

    let lastStatus = null
    let lastCode = null
    for (let i = 1; i <= 6; i++) {
      const attempt = createSession().api('/auth/login', {
        method: 'POST',
        body: { username: LOCK_USERNAME, password: 'wrong-password' },
      })
      const res = await attempt
      lastStatus = res.status
      lastCode = res.data?.error?.code
      log(`    attempt ${i}: ${lastStatus} ${lastCode || ''}`)
    }
    assert(lastStatus === 401 && lastCode === 'ACCOUNT_LOCKED', `6th wrong password returns ACCOUNT_LOCKED (got ${lastStatus} ${lastCode})`)

    const duringLock = await createSession().api('/auth/login', {
      method: 'POST',
      body: { username: LOCK_USERNAME, password: LOCK_PASSWORD },
    })
    assert(
      duringLock.status === 401 && duringLock.data?.error?.code === 'ACCOUNT_LOCKED',
      `Correct password rejected during lockout (got ${duringLock.status} ${duringLock.data?.error?.code})`
    )

    if (WAIT_UNLOCK) {
      log('    waiting for lockout window (SMOKE_TEST_WAIT_UNLOCK=1)...')
      await sleep(6500)
      const afterWindow = await createSession().api('/auth/login', {
        method: 'POST',
        body: { username: LOCK_USERNAME, password: LOCK_PASSWORD },
      })
      assert(afterWindow.status === 200, `Login succeeds after lockout window (got ${afterWindow.status})`)
    } else {
      log('    (unlock-window assertion skipped — set SMOKE_TEST_WAIT_UNLOCK=1 to enable)')
    }
  } catch (e) {
    assert(false, `Lockout checks failed: ${e.message}`)
  }

  // 12. RBAC negative matrix (superadmin has no tenant access) + MTS lifecycles + TB
  log('\n12. RBAC negative matrix, lifecycles, trial balance')
  try {
    for (const p of [
      '/inventory/materials', '/products', '/sales', '/customers', '/suppliers',
      '/procurement/purchase-orders', '/finance/accounts', '/reports/dashboard',
      '/settings', '/guide-angel/data',
    ]) {
      const r = await superadmin.api(p)
      assert(r.status === 403, `Superadmin blocked from ${p} (got ${r.status})`)
      assert(r.data?.error?.code === 'FORBIDDEN', `FORBIDDEN code on ${p} (got ${r.data?.error?.code})`)
    }

    const mats = await tenantAdmin.api('/inventory/materials')
    const smokeMat = (mats.data?.data || []).find((m) => m.code?.startsWith('SMKMAT-'))
    assert(!!smokeMat, 'Smoke material found for lifecycle')

    const prods = await tenantAdmin.api('/products')
    const smokeVar = (prods.data?.data || []).flatMap((p) => p.variants || []).find((v) => v.label === 'Smoke-50cl')
    assert(!!smokeVar, 'Smoke variant found for lifecycle')

    const bom = await tenantAdmin.api(`/products/variants/${smokeVar.id}/bom`, {
      method: 'PUT',
      body: { lines: [{ materialId: smokeMat.id, qtyPerPack: 2 }] },
    })
    assert(bom.status === 200 && bom.data?.data?.length === 1, `BOM replace returns 1 line (got ${bom.status})`)

    const adj = await tenantAdmin.api(`/inventory/materials/${smokeMat.id}/adjust-stock`, {
      method: 'PATCH',
      body: { newQuantity: 100, reason: 'Smoke lifecycle stocking' },
    })
    assert(adj.status === 200, `Stock adjust returns 200 (got ${adj.status})`)

    const run = await tenantAdmin.api('/production-runs', {
      method: 'POST',
      body: { variantId: smokeVar.id, plannedPacks: 10 },
    })
    assert(run.status === 201, `Run create returns 201 (got ${run.status})`)
    const runId = run.data?.data?.id

    const start = await tenantAdmin.api(`/production-runs/${runId}/start`, { method: 'POST', body: {} })
    assert(start.status === 200, `Run start returns 200 (got ${start.status})`)

    const done = await tenantAdmin.api(`/production-runs/${runId}/complete`, {
      method: 'POST',
      body: { actualPacks: 10 },
    })
    assert(done.status === 200 && !!done.data?.data?.journalEntryId, `Run complete posts JE (got ${done.status})`)

    const fg = await tenantAdmin.api('/reports/water/fg-valuation')
    const fgRow = (fg.data?.data?.rows || []).find((r) => r.variant === 'Smoke-50cl')
    assert(fg.status === 200 && Number(fgRow?.packs) === 10, `FG shows 10 packs (got ${JSON.stringify(fgRow)})`)

    const sale = await tenantAdmin.api('/sales', {
      method: 'POST',
      body: { customerId, lines: [{ variantId: smokeVar.id, qty: 4 }] },
    })
    assert(sale.status === 201, `Sale draft returns 201 (got ${sale.status})`)
    const saleId = sale.data?.data?.id

    const conf = await tenantAdmin.api(`/sales/${saleId}/confirm`, { method: 'POST', body: {} })
    assert(conf.status === 200 && conf.data?.data?.sale?.status === 'CONFIRMED', `Sale confirmed (got ${conf.status})`)

    const def = await tenantAdmin.api('/finance/deferred-cogs')
    assert(def.status === 200, `Deferred COGS returns 200 (got ${def.status})`)
    assert(def.data?.data?.totalDeferred === 0 && (def.data?.data?.orders || []).length === 0, 'Deferred COGS zeroed')

    const tb = await tenantAdmin.api('/finance/trial-balance')
    const t = tb.data?.data?.totals || {}
    assert(tb.status === 200 && Math.abs(Number(t.totalDebit) - Number(t.totalCredit)) <= 0.01, `Trial balance equal (Dr ${t.totalDebit} = Cr ${t.totalCredit})`)
  } catch (e) {
    assert(false, `Lifecycle/matrix checks failed: ${e.message}`)
  }

  // 10. Password change invalidates session (12.4)
  log('\n10. Session invalidation on password change')
  try {
    const changed = await tenantAdmin.api('/auth/password', {
      method: 'PATCH',
      body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD2 },
    })
    assert(changed.status === 200, `Password change returns 200 (got ${changed.status})`)

    const staleRefresh = await tenantAdmin.api('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: tenantAdmin.cookie('waterpax_rt') || '' },
    })
    assert(staleRefresh.status === 401, `Old refresh token rejected after password change (got ${staleRefresh.status})`)

    const relogin = await loginWith2fa(createSession(), ADMIN_USERNAME, ADMIN_PASSWORD2)
    assert(relogin.status === 200, `Re-login with new password returns 200 (got ${relogin.status})`)
  } catch (e) {
    assert(false, `Session invalidation checks failed: ${e.message}`)
  }

  // 11. Cleanup — deactivate test tenant
  log('\n11. Cleanup')
  try {
    const res = await superadmin.api(`/platform/tenants/${tenantId}`, {
      method: 'PATCH',
      body: { isActive: false },
    })
    assert(res.status === 200, `Test tenant deactivated (got ${res.status})`)
  } catch (e) {
    assert(false, `Cleanup failed: ${e.message}`)
  }

  // Summary
  log('\n=== Summary ===')
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  log(`Passed: ${passed}/${results.length}`)
  log(`Failed: ${failed}/${results.length}`)

  if (failed > 0) {
    log('\nFailed tests:')
    results.filter(r => !r.pass).forEach(r => log(`  - ${r.message}`))
    process.exit(1)
  } else {
    log('\nAll tests passed!')
    process.exit(0)
  }
}

run().catch(e => {
  log(`\nFatal error: ${e.message}`)
  process.exit(1)
})
