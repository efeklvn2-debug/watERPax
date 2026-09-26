import { appendFileSync, readFileSync } from 'fs'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001/api'
const LOG_FILE = 'scripts/period-lock.log'

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

const ADMIN_USER = process.env.PERIOD_LOCK_USER || 'admin'
const ADMIN_PASS = process.env.PASSWORD
  || process.env.SUPERADMIN_PASSWORD
  || envFromFile('apps/backend/.env', 'ADMIN_PASSWORD')
  || process.env.ADMIN_PASSWORD

function log(msg) {
  console.log(msg)
  appendFileSync(LOG_FILE, msg + '\n')
}

function assert(condition, message) {
  if (condition) {
    log(`  ✓ ${message}`)
  } else {
    log(`  ✗ ${message}`)
    process.exitCode = 1
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
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && options.csrf !== false && session.csrf()) {
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

async function run() {
  appendFileSync(LOG_FILE, '')
  log('=== Period Locking E2E Test (cookies + CSRF) ===\n')

  const session = createSession()

  // 1. Login as tenant admin
  log('--- Step 1: Login as tenant admin ---')
  const loginRes = await session.api('/auth/login', {
    method: 'POST',
    body: { username: ADMIN_USER, password: ADMIN_PASS }
  })
  assert(loginRes.status === 200, `Tenant admin login (${loginRes.status})`)
  assert(session.csrf(), 'CSRF cookie present')

  // 2. Get current settings (no lock initially)
  log('\n--- Step 2: Get initial settings ---')
  const settingsRes = await session.api('/settings')
  assert(settingsRes.status === 200, `Settings fetched (${settingsRes.status})`)
  const initialLock = settingsRes.data?.data?.booksLockedUntil
  assert(!initialLock, 'No lock initially')

  // 3. Get accounts (Cash and OBE)
  log('\n--- Step 3: Get accounts ---')
  const accountsRes = await session.api('/finance/accounts')
  assert(accountsRes.status === 200, `Accounts fetched (${accountsRes.status})`)
  const accounts = accountsRes.data?.data || []
  const cashAcct = accounts.find(a => a.code === '1000')
  const obeAcct = accounts.find(a => a.code === '3000')
  assert(!!cashAcct, 'Cash account (1000) exists')
  assert(!!obeAcct, 'OBE account (3000) exists')

  // 4. Lock books starting from today
  log('\n--- Step 4: Lock books ---')
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const lockRes = await session.api('/settings/books-locked', {
    method: 'PATCH',
    body: { booksLockedUntil: today }
  })
  assert(lockRes.status === 200, `Books locked through ${today} (${lockRes.status})`)

  // 5. Try to post a journal entry with yesterday's date — should fail
  log('\n--- Step 5: Attempt backdated journal entry ---')
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const jeRes = await session.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'Should be blocked by period lock',
      sourceModule: 'ADJUSTMENT',
      date: yesterday,
      lines: [
        { accountId: cashAcct.id, debit: 1000, credit: 0 },
        { accountId: obeAcct.id, debit: 0, credit: 1000 }
      ]
    }
  })
  assert(jeRes.status === 400, `Backdated JE blocked with 400 (got ${jeRes.status})`)
  assert(jeRes.data?.error?.code === 'PERIOD_LOCKED', `Error code is PERIOD_LOCKED (got ${jeRes.data?.error?.code})`)
  log(`  Message: ${jeRes.data?.error?.message}`)

  // 6. Post same JE with tomorrow's date — should succeed
  log('\n--- Step 6: Post JE with future date (should succeed) ---')
  const jeOkRes = await session.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'Should succeed — date is after lock',
      sourceModule: 'ADJUSTMENT',
      date: tomorrow,
      lines: [
        { accountId: cashAcct.id, debit: 500, credit: 0 },
        { accountId: obeAcct.id, debit: 0, credit: 500 }
      ]
    }
  })
  assert(jeOkRes.status === 201, `Future JE succeeds (${jeOkRes.status})`)

  // 7. Unlock books
  log('\n--- Step 7: Unlock books ---')
  const unlockRes = await session.api('/settings/books-locked', {
    method: 'PATCH',
    body: { booksLockedUntil: null }
  })
  assert(unlockRes.status === 200, 'Books unlocked')

  // 8. Now backdated JE should succeed
  log('\n--- Step 8: Backdated JE after unlock (should succeed) ---')
  const jeAfterRes = await session.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'Should succeed after unlock',
      sourceModule: 'ADJUSTMENT',
      date: yesterday,
      lines: [
        { accountId: cashAcct.id, debit: 2000, credit: 0 },
        { accountId: obeAcct.id, debit: 0, credit: 2000 }
      ]
    }
  })
  assert(jeAfterRes.status === 201, `Backdated JE succeeds after unlock (${jeAfterRes.status})`)

  // Summary
  log('\n═══════════════════════════════')
  const passed = process.exitCode ? 'SOME FAILED' : 'ALL PASSED'
  log(`Result: ${passed}`)
}

run().catch(e => {
  log(`\nFATAL: ${e.message}`)
  process.exitCode = 1
})
