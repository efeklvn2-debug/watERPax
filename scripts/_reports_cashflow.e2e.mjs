// watERPax Reports & Cashflow E2E (PR B: fix/reports-cashflow)
// Covers: B1 dashboard cashflow identity, B3 bank movements include 1100
// children, B4 receipt on fully-cascaded deposit, OBE one-click close to
// Retained Earnings.
// Run: BASE_URL=... SMOKE_USER=superadmin node scripts/_reports_cashflow.e2e.mjs

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
  log('=== Reports & Cashflow E2E (PR B) ===')

  // --- Bootstrap tenant ---
  const sa = createSession()
  let r = await sa.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')

  r = await sa.api('/platform/tenants', { method: 'POST', body: { name: `CashFlow Co ${ts}`, slug: `cf-${ts}` } })
  assert(r.status === 201, 'Tenant created')
  const tenantId = r.data?.data?.id

  const username = `cfadmin-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username, password: 'CfPass12345!', role: 'ADMIN' },
  })
  assert(r.status === 201, 'Tenant admin created')

  const admin = createSession()
  r = await admin.api('/auth/login', { method: 'POST', body: { username, password: 'CfPass12345!' } })
  assert(r.status === 200, 'Tenant admin login')

  r = await admin.api('/finance/seed', { method: 'POST' })
  assert(r.status === 200, 'Default COA accounts seeded')

  const today = new Date().toISOString().split('T')[0]

  // --- Master data ---
  r = await admin.api('/customers', { method: 'POST', body: { name: `CF Buyer ${ts}` } })
  assert(r.status === 201, 'Customer 1 created')
  const customer1 = r.data?.data?.id

  r = await admin.api('/customers', { method: 'POST', body: { name: `CF Legacy ${ts}` } })
  assert(r.status === 201, 'Customer 2 created')
  const customer2 = r.data?.data?.id

  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `CF-PRE-${ts}`, name: 'Preform 33cl', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs', costPrice: 2, minStock: 0 },
  })
  assert(r.status === 201, 'Material created')
  const materialId = r.data?.data?.id

  r = await admin.api('/products', {
    method: 'POST',
    body: { code: `CF-WAT-${ts}`, name: `CF Water ${ts}`, category: 'BOTTLED' },
  })
  assert(r.status === 201, `Product created (got ${r.status})`)
  const productId = r.data?.data?.id

  r = await admin.api(`/products/${productId}/variants`, {
    method: 'POST',
    body: { label: '33cl', packSize: 12, unitOfMeasure: 'pack', pricePerUnit: 107.5 },
  })
  assert(r.status === 201, `Variant created (got ${r.status})`)
  const variantId = r.data?.data?.id

  r = await admin.api(`/products/variants/${variantId}/bom`, {
    method: 'PUT',
    body: { lines: [{ materialId, qtyPerPack: 1, wastagePct: 0 }] },
  })
  assert(r.status === 200 || r.status === 201, `BOM saved (got ${r.status})`)

  r = await admin.api('/finance/accounts')
  const accounts = r.data?.data || []
  const accId = (code) => accounts.find(a => a.code === code)?.id
  const bankParentId = accId('1100')
  assert(!!bankParentId && !!accId('4200'), 'Key accounts present (1100/4200)')

  // ========== TEST 1 (B1): cashflow identity on dashboard ==========
  log('\n1. Dashboard cashflow: opening + moneyIn − moneyOut == closing')
  r = await admin.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'CF probe: cash injection today',
      sourceModule: 'ADJUSTMENT',
      date: today,
      lines: [
        { accountId: accId('1000'), debit: 500, credit: 0, memo: 'cash' },
        { accountId: accId('4200'), debit: 0, credit: 500, memo: 'other income' },
      ],
    },
  })
  assert(r.status === 201, `Manual JE posted (got ${r.status})`)

  r = await admin.api('/finance/dashboard')
  const cp = r.data?.data?.cashPosition
  assert(!!cp, 'Dashboard cashPosition present')
  const identity = cp.openingBalance + cp.moneyInToday - cp.moneyOutToday
  assert(Math.abs(identity - cp.closingBalance) < 0.01,
    `Identity holds: ${cp.openingBalance} + ${cp.moneyInToday} − ${cp.moneyOutToday} == ${cp.closingBalance} (got ${identity})`)
  assert(Math.abs(cp.moneyInToday - 500) < 0.01, `moneyInToday = 500 (got ${cp.moneyInToday})`)

  // ========== TEST 2 (B4 prep + FG stock): Guide Angel setup ==========
  log('\n2. Guide Angel setup: opening receivable 200 (customer2) + 50 FG packs')
  r = await admin.api('/guide-angel/save', {
    method: 'POST',
    body: {
      draft: {
        goLiveDate: today,
        cashBalance: 100,
        bankAccounts: [],
        loans: 0,
        fixedAssets: 0,
        accumulatedDepreciation: 0,
        ownerCapital: 0,
        customerBalances: [{ customerId: customer2, receivableAmount: 200, depositAmount: 0, jarBalance: 0 }],
        supplierBalances: [],
        stockItems: [],
        fgItems: [{ variantId, quantity: 50 }],
      },
    },
  })
  assert(r.status === 200 || r.status === 201, `Guide Angel draft saved (got ${r.status})`)

  r = await admin.api('/guide-angel/complete', { method: 'POST', body: { confirm: true } })
  assert(r.status === 200 || r.status === 201, `Guide Angel completed (got ${r.status})`)

  // ========== TEST 3 (B3): bank movements include 1100 children ==========
  log('\n3. Bank movements consolidate 1100 child accounts')
  r = await admin.api('/finance/accounts', {
    method: 'POST',
    body: { code: '1100-FHB', name: 'FH Test Bank', type: 'ASSET', parentId: bankParentId },
  })
  assert(r.status === 201, `Child bank account created (got ${r.status})`)
  const childId = r.data?.data?.id

  r = await admin.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'CF probe: payment into child bank',
      sourceModule: 'ADJUSTMENT',
      date: today,
      lines: [
        { accountId: childId, debit: 300, credit: 0, memo: 'bank receipt' },
        { accountId: accId('4200'), debit: 0, credit: 300, memo: 'other income' },
      ],
    },
  })
  assert(r.status === 201, `Child-bank JE posted (got ${r.status})`)

  r = await admin.api(`/reports/bank-movements?from=${today}&to=${today}`)
  assert(r.status === 200, `Bank movements 200 (got ${r.status})`)
  const bm = r.data?.data
  const childRow = (bm?.movements || []).find(m => m.description.startsWith('[FH Test Bank]'))
  assert(!!childRow, 'Movement row labelled [FH Test Bank] present')
  assert(Math.abs(Number(childRow?.debit) - 300) < 0.01, `Child movement debit 300 (got ${childRow?.debit})`)
  // closing must include the child's 300 (identity check on the report itself)
  const childNet = (bm?.movements || []).filter(m => m.description.startsWith('[FH Test Bank]'))
    .reduce((s, m) => s + Number(m.debit) - Number(m.credit), 0)
  assert(Math.abs((bm.openingBalance + childNet) - bm.closingBalance) < 0.01,
    `Report ties: opening ${bm.openingBalance} + childNet ${childNet} == closing ${bm.closingBalance}`)

  // ========== TEST 4 (B4): receipt on fully-cascaded deposit ==========
  log('\n4. Deposit 200 fully settles opening receivable -> receipt issued')
  r = await admin.api('/sales/deposits', {
    method: 'POST',
    body: { customerId: customer2, amount: 200, method: 'CASH' },
  })
  assert(r.status === 201, `Deposit created (got ${r.status})`)
  const dep = r.data?.data
  assert(!!dep?.receiptNumber, `Receipt issued (got ${dep?.receiptNumber})`)
  assert(!!dep?.paymentTransactionId, 'Anchor paymentTransactionId present')
  assert(Math.abs(Number(dep?.receivableSettled) - 200) < 0.01, `receivableSettled 200 (got ${dep?.receivableSettled})`)
  assert(Math.abs(Number(dep?.depositHeld) - 0) < 0.01, `depositHeld 0 (got ${dep?.depositHeld})`)

  // ========== TEST 5 (OBE): one-click close to Retained Earnings ==========
  log('\n5. OBE close: JE posted, balance zero, repeat -> 400')
  const obeId = accId('3000')
  r = await admin.api(`/finance/balances/${obeId}`)
  const obeBefore = Number(r.data?.data?.balance)
  assert(Math.abs(obeBefore) > 0.01, `OBE nonzero before close (got ${obeBefore})`)

  r = await admin.api('/finance/obe/close', { method: 'POST' })
  assert(r.status === 200, `OBE close 200 (got ${r.status})`)
  assert(!!r.data?.data?.entryNumber, `OBE close JE ${r.data?.data?.entryNumber}`)
  assert(Math.abs(Number(r.data?.data?.amount) - Math.abs(obeBefore)) < 0.01,
    `Close amount = |balance| (got ${r.data?.data?.amount})`)

  r = await admin.api(`/finance/balances/${obeId}`)
  const obeAfter = Number(r.data?.data?.balance)
  assert(Math.abs(obeAfter) < 0.01, `OBE zero after close (got ${obeAfter})`)

  r = await admin.api('/finance/journal?sourceModule=ADJUSTMENT&limit=10')
  const obeJe = (r.data?.data || []).find(e => (e.description || '').includes('Close Opening Balance Equity'))
  assert(!!obeJe, 'OBE close JE found in journal')
  const obeDr = obeJe.lines.find(l => Number(l.debit) > 0 && findAccountCode(l) === '3000')
  const reCr = obeJe.lines.find(l => Number(l.credit) > 0 && findAccountCode(l) === '3100')
  assert(!!obeDr && !!reCr, 'JE legs: Dr 3000 / Cr 3100 (credit-balance case)')

  r = await admin.api('/finance/obe/close', { method: 'POST' })
  assert(r.status === 400, `Repeat close rejected 400 (got ${r.status})`)
  assert(r.data?.error?.code === 'OBE_ALREADY_ZERO', `Error OBE_ALREADY_ZERO (got ${r.data?.error?.code})`)

  // --- Summary ---
  const passed = results.filter(x => x.pass).length
  log(`\n=== ${passed}/${results.length} assertions passed ===`)
  if (passed !== results.length) process.exit(1)
}

main().catch(err => {
  console.error('\nProbe failed:', err.message)
  const passed = results.filter(x => x.pass).length
  console.log(`=== ${passed}/${results.length} assertions passed before failure ===`)
  process.exit(1)
})
