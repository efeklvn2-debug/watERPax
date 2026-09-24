import { useEffect, useRef, useState } from 'react'
import { useNotification } from '../contexts/NotificationContext'
import { salesApi, SalesPayment } from '../api/sales'
import { customersApi, Customer } from '../api/customers'
import { financeApi, Account } from '../api/finance'
import { hasPermission } from '../stores/authStore'
import { todayLocal } from '../utils/dates'
import { useBooksLocked, isDateLocked } from '../hooks/useBooksLocked'

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const TYPE_COLORS: Record<string, string> = {
  PAYMENT: 'bg-green-100 text-green-800',
  DEPOSIT: 'bg-blue-100 text-blue-800',
  DEPOSIT_APPLIED: 'bg-amber-100 text-amber-800',
  REFUND: 'bg-red-100 text-red-800',
  CORE_BUYBACK: 'bg-purple-100 text-purple-800'
}

function loadSettings() {
  let settingsStr = localStorage.getItem('appSettings')
  try { return settingsStr ? JSON.parse(settingsStr) : null } catch { return null }
}

function buildReceiptHtml(receipt: any, settings: any) {
  const companyName = settings?.receiptCompanyName || settings?.invoiceCompanyName || ''
  const businessAddress = settings?.businessAddress || ''
  const businessTin = settings?.businessTin || ''
  const footerText = settings?.receiptFooter || settings?.invoiceFooter || ''
  const logoUrl = settings?.receiptLogoUrl || settings?.invoiceLogoUrl || ''
  const dateStr = new Date(receipt.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = new Date(receipt.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const amount = Number(receipt.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt - ${receipt.receiptNumber}</title>
<style>
  @page { width: 80mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; font-family: 'Courier New', monospace; font-size: 12px; color: #000; padding: 8px 6px; line-height: 1.4; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .logo { max-width: 50px; display: block; margin: 0 auto 4px; }
  .company-name { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 2px; }
  .info { font-size: 10px; text-align: center; color: #333; }
  .receipt-title { font-size: 18px; font-weight: bold; text-align: center; margin: 2px 0; }
  .receipt-no { font-size: 13px; text-align: center; margin-bottom: 1px; }
  .datetime { font-size: 10px; text-align: center; margin-bottom: 4px; }
  .row { display: flex; justify-content: space-between; font-size: 12px; margin: 1px 0; }
  .label { color: #333; } .value { font-weight: bold; }
  .amount { font-size: 14px; font-weight: bold; text-align: center; margin: 4px 0; }
  .footer { text-align: center; font-size: 10px; margin-top: 8px; color: #555; }
  @media print { body { padding: 0; } }
</style></head><body>
  ${logoUrl ? `<img src="${logoUrl}" class="logo" alt="Logo">` : ''}
  <div class="company-name">${companyName}</div>
  ${businessAddress ? `<div class="info">${businessAddress}</div>` : ''}
  ${businessTin ? `<div class="info">TIN: ${businessTin}</div>` : ''}
  <div class="line"></div>
  <div class="receipt-title">RECEIPT</div>
  <div class="receipt-no">${receipt.receiptNumber}</div>
  <div class="datetime">${dateStr}  ${timeStr}</div>
  <div class="line"></div>
  <div class="row"><span class="label">Customer:</span><span class="value">${receipt.customerName}</span></div>
  <div class="line"></div>
  <div class="row"><span class="label">Payment:</span><span class="value">${receipt.paymentMethod === 'Cash' ? 'Cash' : 'Bank Transfer'}</span></div>
  <div class="amount">₦${amount}</div>
  ${receipt.referenceNumber ? `<div class="row"><span class="label">Ref:</span><span class="value">${receipt.referenceNumber}</span></div>` : ''}
  <div class="line"></div>
  <div class="footer">${footerText}</div>
</body></html>`
}

const PRINT_ICON = <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
const DOWNLOAD_ICON = <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>

export function SalesPaymentsTab() {
  const notify = useNotification()
  const { booksLockedUntil } = useBooksLocked()
  const [payments, setPayments] = useState<SalesPayment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showDeposit, setShowDeposit] = useState(false)
  const [depCustomer, setDepCustomer] = useState('')
  const [depAmount, setDepAmount] = useState('')
  const [depMethod, setDepMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH')
  const [depDate, setDepDate] = useState(todayLocal())
  const [depRef, setDepRef] = useState('')
  const [depBankAccountId, setDepBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [receiptDropdown, setReceiptDropdown] = useState<string | null>(null)
  const receiptMenuRef = useRef<HTMLDivElement | null>(null)

  const canDeposit = hasPermission('sales:payment')

  const load = async () => {
    setLoading(true)
    const filters: any = {}
    if (dateFrom) filters.dateFrom = dateFrom
    if (dateTo) filters.dateTo = dateTo
    const res = await salesApi.listPayments(filters)
    if (res.error) notify.error(res.error.message)
    else setPayments((res.data as any)?.data || res.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    customersApi.list().then(res => { if (!res.error) setCustomers((res.data as any)?.data || res.data || []) })
    financeApi.getAccounts().then(res => {
      const all = (res.data as any)?.data || []
      const bank1100 = all.find((a: Account) => a.code === '1100')
      if (bank1100) setBankAccounts(all.filter((a: Account) => a.parentId === bank1100.id))
    })
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (!receiptDropdown) return
    const handleClick = (e: MouseEvent) => {
      if (receiptMenuRef.current && receiptMenuRef.current.contains(e.target as Node)) return
      setReceiptDropdown(null)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [receiptDropdown])

  const filtered = payments.filter(p => {
    const q = search.toLowerCase()
    return !q || p.customer?.name?.toLowerCase().includes(q) || p.referenceNumber?.toLowerCase().includes(q) || p.sale?.saleNumber?.toLowerCase().includes(q)
  })

  const handleDoDeposit = async () => {
    if (!depCustomer || !depAmount) { notify.error('Customer and amount required'); return }
    if (isDateLocked(depDate, booksLockedUntil)) { notify.error(`Cannot post to ${depDate} — period is locked`); return }
    setBusy(true)
    const res = await salesApi.recordDeposit({ customerId: depCustomer, amount: Number(depAmount), method: depMethod, date: depDate, reference: depRef || undefined, bankAccountId: depBankAccountId || undefined })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    const payload = res.data
    notify.success(`Deposit recorded${payload?.receiptNumber ? ` (${payload.receiptNumber})` : ''}`)
    setShowDeposit(false); setDepCustomer(''); setDepAmount(''); setDepRef(''); setDepBankAccountId(''); setDepDate(todayLocal())
    load()
  }

  const handlePrintReceipt = async (receipt: any) => {
    const settings = loadSettings()
    const companyName = settings?.receiptCompanyName || settings?.invoiceCompanyName || ''
    if (!companyName) { notify.error('Configure your company name in Settings first'); return }
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) return
    win.document.write(buildReceiptHtml(receipt, settings))
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 500)
  }

  const handleDownloadReceipt = async (receiptId: string) => {
    try { await salesApi.downloadReceiptPdf(receiptId) }
    catch (err: any) { notify.error(err.message || 'Failed to download receipt') }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Payment Transactions</h2>
            <div className="flex items-center gap-2">
              {canDeposit && (
                <button onClick={() => { setShowDeposit(true); setDepDate(todayLocal()) }}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700">+ Deposit</button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search payments..."
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">From:</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">To:</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg" />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }}
                className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">Clear</button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">No payments found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Sale</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Method</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Reference</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600">{fmtDate(p.receivedAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${TYPE_COLORS[p.transactionType] || 'bg-slate-100 text-slate-700'}`}>
                        {p.transactionType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.customer?.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{p.sale?.saleNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{p.paymentMethod === 'BANK_TRANSFER' ? 'Transfer' : 'Cash'}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">{money(p.amount)}</td>
                    <td className="px-4 py-3 text-slate-500">{p.referenceNumber || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {p.receipts && p.receipts.length > 0 && (
                        <div className="relative inline-block" ref={receiptDropdown === p.id ? receiptMenuRef : undefined}>
                          <button onClick={() => setReceiptDropdown(receiptDropdown === p.id ? null : p.id)}
                            className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-300 rounded-lg transition-colors">
                            Receipt
                          </button>
                          {receiptDropdown === p.id && (
                            <div className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
                              <button onClick={() => { handlePrintReceipt(p.receipts![0]); setReceiptDropdown(null) }}
                                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-t-lg border-b border-slate-100">
                                {PRINT_ICON} Print
                              </button>
                              <button onClick={() => { handleDownloadReceipt(p.receipts![0].id); setReceiptDropdown(null) }}
                                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-b-lg">
                                {DOWNLOAD_ICON} Download
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDeposit && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowDeposit(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-4">Record Deposit</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Customer</label>
                <select value={depCustomer} onChange={e => setDepCustomer(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="">Select customer...</option>
                  {customers.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                  <input type="number" min="0" value={depAmount} onChange={e => setDepAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                  <select value={depMethod} onChange={e => { setDepMethod(e.target.value as any); setDepBankAccountId('') }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                  </select>
                </div>
              </div>
              {depMethod === 'BANK_TRANSFER' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Bank Account</label>
                  <select value={depBankAccountId} onChange={e => setDepBankAccountId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    <option value="">Default (Bank — 1100)</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${isDateLocked(depDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                {isDateLocked(depDate, booksLockedUntil) && <p className="text-xs text-red-600 mt-1">Period is locked.</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Reference (optional)</label>
                <input value={depRef} onChange={e => setDepRef(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={handleDoDeposit} disabled={busy || isDateLocked(depDate, booksLockedUntil)}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                {busy ? 'Saving...' : 'Save deposit'}
              </button>
              <button onClick={() => setShowDeposit(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
