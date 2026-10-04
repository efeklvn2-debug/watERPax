// watERPax Finance Hygiene E2E (PR A: fix/finance-hygiene)
// Covers: A2 supplier credit-note VAT decomposition, A3 VAT summary netting,
// A4 AP aging nets credit notes, A5 PAYE JE posting + reversal, A6 cash-account
// validation on bankAccountId, A7 CIT double-post TOCTOU guard.
// Run: BASE_URL=... SMOKE_USER=superadmin node scripts/_finance_hygiene.e2e.mjs

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
  const YEAR = new Date().getFullYear()
  log('=== Finance Hygiene E2E (PR A) ===')

  // --- Bootstrap tenant ---
  const sa = createSession()
  let r = await sa.api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: ADMIN_PASSWORD } })
  assert(r.status === 200, 'Superadmin login')

  r = await sa.api('/platform/tenants', { method: 'POST', body: { name: `FinHygiene Co ${ts}`, slug: `finhyg-${ts}` } })
  assert(r.status === 201, 'Tenant created')
  const tenantId = r.data?.data?.id

  const username = `fhadmin-${ts}@test.local`
  r = await sa.api(`/platform/tenants/${tenantId}/users`, {
    method: 'POST', body: { username, password: 'FhPass12345!', role: 'ADMIN' },
  })
  assert(r.status === 201, 'Tenant admin created')

  const admin = createSession()
  r = await admin.api('/auth/login', { method: 'POST', body: { username, password: 'FhPass12345!' } })
  assert(r.status === 200, 'Tenant admin login')

  // --- Seed default COA accounts for this tenant ---
  r = await admin.api('/finance/seed', { method: 'POST' })
  assert(r.status === 200, 'Default COA accounts seeded')

  // Account id lookup helper
  r = await admin.api('/finance/accounts')
  const accounts = r.data?.data || []
  const accId = (code) => accounts.find(a => a.code === code)?.id
  assert(!!accId('2100') && !!accId('4200') && !!accId('1000') && !!accId('1100') && !!accId('6300'), 'Key accounts present (2100/4200/1000/1100/6300)')

  const today = new Date().toISOString().split('T')[0]

  // --- Supplier + PACKAGING material + PO + receive + supplier invoice ---
  r = await admin.api('/suppliers', { method: 'POST', body: { name: `FH Supplier ${ts}` } })
  assert(r.status === 201, 'Supplier created')
  const supplierId = r.data?.data?.id

  r = await admin.api('/inventory/materials', {
    method: 'POST',
    body: { code: `FH-PKG-${ts}`, name: 'Shrink Wrap', category: 'PACKAGING', unitOfMeasure: 'rolls', costPrice: 5, minStock: 0 },
  })
  assert(r.status === 201, 'PACKAGING material created')
  const pkgMatId = r.data?.data?.id

  r = await admin.api('/procurement/purchase-orders', {
    method: 'POST',
    body: { supplier: `FH Supplier ${ts}`, items: [{ materialId: pkgMatId, quantity: 40, unitPrice: 5 }] },
  })
  assert(r.status === 201, `PO created (got ${r.status})`)
  const poId = r.data?.data?.id

  r = await admin.api(`/procurement/purchase-orders/${poId}`)
  const poItems = r.data?.data?.items || r.data?.data?.lineItems || []
  const poLine = poItems.find(i => i.materialId === pkgMatId)
  assert(!!poLine, 'PO line found')

  r = await admin.api(`/procurement/purchase-orders/${poId}/receive`, {
    method: 'POST', body: { receivedLines: [{ lineItemId: poLine.id, receivedQty: 40 }] },
  })
  assert(r.status === 201, `PO received (got ${r.status})`)

  // Invoice 215 inclusive of 7.5% VAT => ex 200, VAT 15
  r = await admin.api('/procurement/supplier-invoices', {
    method: 'POST', body: { poId, date: today, amount: 215 },
  })
  assert(r.status === 201, `Supplier invoice created (got ${r.status})`)

  // ========== TEST 1 (A3 input baseline): input VAT = 15 ==========
  log('\n1. Input VAT baseline after invoice (expect ~15)')
  r = await admin.api('/finance/vat')
  const inputVat1 = Number(r.data?.data?.inputVat)
  assert(Math.abs(inputVat1 - 15) < 0.02, `inputVat ≈ 15 (got ${inputVat1})`)

  // ========== TEST 2 (A2): credit note decomposes VAT ==========
  log('\n2. Supplier credit note 100 on PACKAGING material')
  r = await admin.api('/procurement/supplier-credit-notes', {
    method: 'POST',
    body: { supplierId, amount: 100, date: today, reason: 'Damaged rolls', materialId: pkgMatId, quantity: 20 },
  })
  assert(r.status === 201, `Credit note created (got ${r.status})`)

  r = await admin.api('/finance/journal?sourceModule=PROCUREMENT&limit=10')
  const entries = r.data?.data || []
  const cnEntry = entries.find(e => (e.description || '').toLowerCase().includes('credit note'))
  assert(!!cnEntry, 'Credit note JE found')
  const dr2000 = cnEntry.lines.find(l => Number(l.debit) > 0 && findAccountCode(l) === '2000')
  const cr1400 = cnEntry.lines.find(l => Number(l.credit) > 0 && findAccountCode(l) === '1400')
  const cr1311 = cnEntry.lines.find(l => Number(l.credit) > 0 && findAccountCode(l) === '1311')
  assert(!!dr2000 && Math.abs(Number(dr2000.debit) - 100) < 0.01, `Dr 2000 full inclusive 100 (got ${dr2000?.debit})`)
  assert(!!cr1400, 'Cr 1400 Input VAT reversal leg present')
  assert(!!cr1311, `Cr 1311 Packaging inventory (got ${findAccountCode(cr1311 || {})})`)
  const vatPortion = Number(cr1400?.credit || 0)
  const exPortion = Number(cr1311?.credit || 0)
  assert(Math.abs(vatPortion - 6.9767) < 0.02, `VAT portion ≈ 6.98 (got ${vatPortion})`)
  assert(Math.abs(vatPortion + exPortion - 100) < 0.01, `Legs sum to 100 (got ${vatPortion + exPortion})`)

  // ========== TEST 3 (A3): input VAT netted down by credit note ==========
  log('\n3. Input VAT summary nets credit note (15 -> ~8.02)')
  r = await admin.api('/finance/vat')
  const inputVat2 = Number(r.data?.data?.inputVat)
  assert(Math.abs(inputVat2 - (15 - 6.9767)) < 0.02, `inputVat ≈ 8.02 (got ${inputVat2})`)

  // ========== TEST 4 (A3): output VAT nets reversal side ==========
  log('\n4. Output VAT netting: +80 then −50 reversal')
  r = await admin.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'FH probe: output VAT setup',
      sourceModule: 'ADJUSTMENT',
      date: today,
      lines: [
        { accountId: accId('4200'), debit: 80, credit: 0, memo: 'revenue gross-up' },
        { accountId: accId('2100'), debit: 0, credit: 80, memo: 'output VAT' },
      ],
    },
  })
  assert(r.status === 201, `Manual JE +80 output VAT posted (got ${r.status})`)
  r = await admin.api('/finance/vat')
  assert(Math.abs(Number(r.data?.data?.outputVat) - 80) < 0.02, `outputVat = 80 (got ${r.data?.data?.outputVat})`)

  r = await admin.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'FH probe: output VAT reversal (credit note style)',
      sourceModule: 'ADJUSTMENT',
      date: today,
      lines: [
        { accountId: accId('2100'), debit: 50, credit: 0, memo: 'output VAT reversal' },
        { accountId: accId('4200'), debit: 0, credit: 50, memo: 'revenue reduction' },
      ],
    },
  })
  assert(r.status === 201, `Reversal JE posted (got ${r.status})`)
  r = await admin.api('/finance/vat')
  assert(Math.abs(Number(r.data?.data?.outputVat) - 30) < 0.02, `outputVat netted to 30 (got ${r.data?.data?.outputVat})`)

  // ========== TEST 5 (A4): AP aging nets credit note (215 − 100 = 115) ==========
  log('\n5. AP aging ties: invoice 215 − credit note 100 = 115')
  r = await admin.api('/reports/aging/payables')
  const aging = r.data?.data
  const sEntry = (aging?.entries || []).find(e => e.id === supplierId)
  assert(!!sEntry, 'Supplier appears in aging')
  assert(Math.abs(Number(sEntry.total) - 115) < 0.01, `Supplier aging total 115 (got ${sEntry?.total})`)
  assert(Math.abs(Number(aging?.totalOutstanding) - 115) < 0.01, `totalOutstanding 115 (got ${aging?.totalOutstanding})`)

  // ========== TEST 6 (A5): PAYE posts JE, delete reverses it ==========
  log('\n6. PAYE 50000 -> Dr 6300 / Cr 2300 JE; delete -> reversal')
  r = await admin.api('/tax/paye', {
    method: 'POST',
    body: { period: `${YEAR}-10`, year: YEAR, month: 10, amount: 50000, description: 'FH probe payroll' },
  })
  assert(r.status === 201, `PAYE entry created (got ${r.status})`)
  const payeId = r.data?.data?.id

  r = await admin.api('/finance/journal?sourceModule=TAX&limit=10')
  const taxEntries = r.data?.data || []
  const payeJe = taxEntries.find(e => (e.description || '').startsWith(`PAYE ${YEAR}-10`))
  assert(!!payeJe, 'PAYE JE found in TAX module')
  const pDr = payeJe.lines.find(l => Number(l.debit) > 0)
  const pCr = payeJe.lines.find(l => Number(l.credit) > 0)
  assert(findAccountCode(pDr) === '6300', `PAYE JE Dr 6300 (got ${findAccountCode(pDr)})`)
  assert(findAccountCode(pCr) === '2300', `PAYE JE Cr 2300 (got ${findAccountCode(pCr)})`)
  assert(Math.abs(Number(pDr.debit) - 50000) < 0.01, 'PAYE JE amount 50000')

  r = await admin.api(`/tax/paye/${payeId}`, { method: 'DELETE' })
  assert(r.status === 200 || r.status === 204, `PAYE entry deleted (got ${r.status})`)

  r = await admin.api('/finance/journal?sourceModule=TAX&limit=10')
  const revJe = (r.data?.data || []).find(e => (e.description || '').startsWith('Reversal of') && (e.description || '').includes('PAYE'))
  assert(!!revJe, 'PAYE reversal JE found')
  const rDr = revJe.lines.find(l => Number(l.debit) > 0)
  const rCr = revJe.lines.find(l => Number(l.credit) > 0)
  assert(findAccountCode(rDr) === '2300' && findAccountCode(rCr) === '6300', 'Reversal swaps legs (Dr 2300 / Cr 6300)')

  r = await admin.api('/tax/paye')
  assert(!(r.data?.data || []).some(e => e.id === payeId), 'PAYE list no longer contains entry')

  // ========== TEST 7 (A6): bankAccountId must be a cash account ==========
  log('\n7. Deposit with expense account rejected; 1100 accepted')
  r = await admin.api('/customers', { method: 'POST', body: { name: `FH Customer ${ts}` } })
  assert(r.status === 201, 'Customer created')
  const customerId = r.data?.data?.id

  r = await admin.api('/sales/deposits', {
    method: 'POST',
    body: { customerId, amount: 100, method: 'BANK_TRANSFER', bankAccountId: accId('6300') },
  })
  assert(r.status === 400, `Expense account rejected 400 (got ${r.status})`)
  assert(r.data?.error?.code === 'INVALID_CASH_ACCOUNT', `Error INVALID_CASH_ACCOUNT (got ${r.data?.error?.code})`)

  r = await admin.api('/sales/deposits', {
    method: 'POST',
    body: { customerId, amount: 100, method: 'BANK_TRANSFER', bankAccountId: accId('1100') },
  })
  assert(r.status === 201, `Bank account 1100 accepted (got ${r.status})`)

  // ========== TEST 8 (A7): CIT double-post blocked ==========
  log('\n8. CIT provision posted once; second post -> 400 CONFLICT')
  r = await admin.api('/finance/journal', {
    method: 'POST',
    body: {
      description: 'FH probe: revenue for CIT',
      sourceModule: 'ADJUSTMENT',
      date: today,
      lines: [
        { accountId: accId('1000'), debit: 1000000, credit: 0, memo: 'cash' },
        { accountId: accId('4200'), debit: 0, credit: 1000000, memo: 'other income' },
      ],
    },
  })
  assert(r.status === 201, `Revenue JE posted (got ${r.status})`)

  r = await admin.api('/tax/provision', { method: 'POST', body: { year: YEAR } })
  assert(r.status === 201 || r.status === 200, `CIT provision posted (got ${r.status})`)

  r = await admin.api('/tax/cit')
  assert(r.data?.data?.posted === true, 'CIT shows posted: true')

  r = await admin.api('/tax/provision', { method: 'POST', body: { year: YEAR } })
  assert(r.status === 400, `Second CIT post rejected 400 (got ${r.status})`)
  assert(r.data?.error?.code === 'CONFLICT', `Error CONFLICT (got ${r.data?.error?.code})`)

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
