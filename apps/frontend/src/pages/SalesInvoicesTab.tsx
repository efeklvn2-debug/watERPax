import { useEffect, useState } from 'react'
import { useNotification } from '../contexts/NotificationContext'
import { salesApi, SalesInvoice, Sale } from '../api/sales'
import { hasPermission } from '../stores/authStore'
import { todayLocal } from '../utils/dates'
import { useBooksLocked, isDateLocked } from '../hooks/useBooksLocked'

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ISSUED: 'bg-blue-100 text-blue-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-red-100 text-red-700'
}

function loadSettings() {
  let settingsStr = localStorage.getItem('appSettings')
  try { return settingsStr ? JSON.parse(settingsStr) : null } catch { return null }
}

function buildInvoiceHtml(invoice: any, sale: any, settings: any) {
  const companyName = settings?.invoiceCompanyName || ''
  const businessAddress = settings?.businessAddress || ''
  const businessTin = settings?.businessTin || ''
  const footerText = settings?.invoiceFooter || ''
  const logoUrl = settings?.invoiceLogoUrl || ''
  const customerName = invoice.customer?.name || 'N/A'
  const dateStr = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const dueDateStr = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const formatNaira = (n: number) => '₦' + n.toLocaleString('en-US', { minimumFractionDigits: 2 })
  const totalIncl = Number(invoice.totalAmount)
  const depositApplied = Number(invoice.depositApplied || 0)
  const previousPayments = Number(invoice.previousPayments || 0)
  const balanceDue = Number(invoice.balanceDue)
  const isPaid = invoice.status === 'PAID'
  const lines = sale?.lines || []

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice - ${invoice.invoiceNumber}</title>
<style>
  @page { width: 80mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; font-family: 'Courier New', monospace; font-size: 12px; color: #000; padding: 8px 6px; line-height: 1.4; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .logo { max-width: 50px; display: block; margin: 0 auto 4px; }
  .company-name { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 2px; }
  .info { font-size: 10px; text-align: center; color: #333; }
  .title { font-size: 18px; font-weight: bold; text-align: center; margin: 2px 0; }
  .doc-no { font-size: 13px; text-align: center; margin-bottom: 1px; }
  .row { display: flex; justify-content: space-between; font-size: 12px; margin: 1px 0; }
  .label { color: #333; } .value { font-weight: bold; }
  .item-header { font-size: 10px; font-weight: bold; color: #555; margin-bottom: 2px; }
  .item-row { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
  .item-desc { flex: 1; } .item-qty { text-align: right; width: 60px; } .item-amount { text-align: right; width: 90px; }
  .totals-row { display: flex; justify-content: space-between; font-size: 12px; margin: 2px 0; }
  .totals-label { text-align: left; } .totals-value { font-weight: bold; text-align: right; }
  .balance-due { font-size: 14px; font-weight: bold; text-align: center; color: #dc2626; margin: 4px 0; }
  .amount-paid { font-size: 14px; font-weight: bold; text-align: center; color: #16a34a; margin: 4px 0; }
  .footer { text-align: center; font-size: 10px; margin-top: 8px; color: #555; }
  .stamp-wrapper { position: relative; }
  .stamp-overlay { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .stamp-text { font-size: 48px; font-weight: 900; color: rgba(22,163,74,0.12); border: 5px solid rgba(22,163,74,0.18); border-radius: 12px; padding: 8px 20px; transform: rotate(-30deg); text-transform: uppercase; letter-spacing: 0.2em; font-family: 'Courier New', monospace; }
  .stamp-badge { position: absolute; top: 4px; right: 4px; z-index: 11; background: #16a34a; color: #fff; font-size: 10px; font-weight: bold; padding: 3px 10px; border-radius: 20px; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); font-family: Arial, sans-serif; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="stamp-wrapper">
  ${isPaid ? `<div class="stamp-overlay"><div class="stamp-text">PAID</div><div class="stamp-badge">PAID ${invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : ''}</div></div>` : ''}
  ${logoUrl ? `<img src="${logoUrl}" class="logo" alt="Logo">` : ''}
  <div class="company-name">${companyName}</div>
  ${businessAddress ? `<div class="info">${businessAddress}</div>` : ''}
  ${businessTin ? `<div class="info">TIN: ${businessTin}</div>` : ''}
  <div class="line"></div>
  <div class="title">INVOICE</div>
  <div class="doc-no">${invoice.invoiceNumber}</div>
  <div class="info">${dateStr}${dueDateStr ? '  |  Due: ' + dueDateStr : ''}</div>
  <div class="info">Status: ${invoice.status}</div>
  <div class="line"></div>
  <div class="row"><span class="label">Customer:</span><span class="value">${customerName}</span></div>
  <div class="row"><span class="label">Sale:</span><span class="value">${sale?.saleNumber || '—'}</span></div>
  <div class="line"></div>
  <div class="item-header">Items</div>
  ${lines.map((l: any) => `<div class="item-row"><span class="item-desc">${l.variant?.product?.name || ''} ${l.variant?.label || ''}</span><span class="item-qty">${l.qty} packs</span><span class="item-amount">${formatNaira(Number(l.subtotal))}</span></div>`).join('\n')}
  ${lines.length === 0 ? '<div class="item-row"><span class="item-desc">—</span></div>' : ''}
  <div class="line"></div>
  <div class="totals-row"><span class="totals-label">Subtotal (excl. VAT)</span><span class="totals-value">${formatNaira(totalIncl - depositApplied - previousPayments)}</span></div>
  ${depositApplied > 0 ? `<div class="totals-row"><span class="totals-label" style="color:#dc2626">Deposit Applied</span><span class="totals-value" style="color:#dc2626">-${formatNaira(depositApplied)}</span></div>` : ''}
  ${previousPayments > 0 ? `<div class="totals-row"><span class="totals-label" style="color:#dc2626">Previous Payments</span><span class="totals-value" style="color:#dc2626">-${formatNaira(previousPayments)}</span></div>` : ''}
  ${balanceDue > 0
    ? `<div class="balance-due">${formatNaira(balanceDue)}</div><div class="info" style="font-size:10px">Balance Due</div>`
    : `<div class="amount-paid">${formatNaira(totalIncl - balanceDue)}</div><div class="info" style="font-size:10px">Amount Paid</div>`}
  <div class="line"></div>
  <div class="footer">${footerText}</div>
</div></body></html>`
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

export function SalesInvoicesTab() {
  const notify = useNotification()
  const { booksLockedUntil } = useBooksLocked()
  const [invoices, setInvoices] = useState<SalesInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedInv, setSelectedInv] = useState<SalesInvoice | null>(null)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH')
  const [payRef, setPayRef] = useState('')
  const [payDate, setPayDate] = useState(todayLocal())
  const [busy, setBusy] = useState(false)

  const canPay = hasPermission('sales:payment')

  const load = async () => {
    setLoading(true)
    const res = await salesApi.listInvoices(statusFilter ? { status: statusFilter } : undefined)
    if (res.error) notify.error(res.error.message)
    else setInvoices((res.data as any)?.data || res.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter])

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase()
    return !q || inv.invoiceNumber.toLowerCase().includes(q) || inv.customer?.name?.toLowerCase().includes(q) || inv.sale?.saleNumber?.toLowerCase().includes(q)
  })

  const openDetail = async (inv: SalesInvoice) => {
    setShowPay(false); setPayAmount(''); setPayRef(''); setPayMethod('CASH'); setPayDate(todayLocal())
    setSelectedInv(inv)
    if (inv.saleId) {
      const res = await salesApi.get(inv.saleId)
      if (!res.error) setSelectedSale((res.data as any)?.data || res.data || null)
      else setSelectedSale(null)
    } else {
      setSelectedSale(null)
    }
  }

  const refreshSale = async () => {
    if (!selectedInv?.saleId) return
    const res = await salesApi.get(selectedInv.saleId)
    if (!res.error) setSelectedSale((res.data as any)?.data || res.data || null)
  }

  const doPay = async () => {
    if (!selectedSale || !payAmount) return
    if (isDateLocked(payDate, booksLockedUntil)) { notify.error(`Cannot post to ${payDate} — period is locked`); return }
    setBusy(true)
    const res = await salesApi.recordPayment(selectedSale.id, { amount: Number(payAmount), method: payMethod, date: payDate, reference: payRef || undefined })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    const payload: any = (res.data as any)?.data || res.data
    const over = Number(payload?.overpayment || 0)
    const casc = Number(payload?.cascadedAmount || 0)
    notify.success(`Payment recorded${payload?.receiptNumber ? ` (${payload.receiptNumber})` : ''}${casc > 0 ? ` — ₦${casc.toLocaleString()} applied to other outstanding debts` : ''}${over > 0 ? ` — ₦${over.toLocaleString()} held as advance deposit` : ''}`)
    setShowPay(false); setPayAmount(''); setPayRef(''); setPayDate(todayLocal())
    load()
    refreshSale()
  }

  const handlePrintInvoice = async (inv: SalesInvoice) => {
    const settings = loadSettings()
    const companyName = settings?.invoiceCompanyName || ''
    if (!companyName) { notify.error('Configure your company name in Settings first'); return }
    let sale = selectedSale
    if (!sale && inv.saleId) {
      const res = await salesApi.get(inv.saleId)
      sale = (res.data as any)?.data || res.data || undefined
    }
    const win = window.open('', '_blank', 'width=400,height=700')
    if (!win) return
    win.document.write(buildInvoiceHtml(inv, sale, settings))
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 500)
  }

  const handleDownloadInvoice = async (invoiceId: string) => {
    try { await salesApi.downloadInvoicePdf(invoiceId) }
    catch (err: any) { notify.error(err.message || 'Failed to download invoice') }
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

  const openBalance = selectedInv ? Number(selectedInv.balanceDue) : 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Invoices</h2>
            <div className="flex items-center gap-2">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..."
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">All statuses</option>
                <option value="ISSUED">Issued</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
                <option value="OVERDUE">Overdue</option>
              </select>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">No invoices found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Invoice</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(inv => (
                  <tr key={inv.id}
                    className={`hover:bg-slate-50 cursor-pointer ${selectedInv?.id === inv.id ? 'bg-blue-50' : ''}`}
                    onClick={() => openDetail(inv)}>
                    <td className="px-4 py-3 font-medium text-blue-600 underline decoration-dotted underline-offset-2">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.customer?.name || '—'}</td>
                    <td className="px-4 py-3 text-right">{money(inv.totalAmount)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${Number(inv.balanceDue) > 0 ? 'text-red-600' : 'text-green-600'}`}>{money(inv.balanceDue)}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[inv.status] || 'bg-slate-100 text-slate-700'}`}>{inv.status}</span></td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handlePrintInvoice(inv)} title="Print invoice"
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">{PRINT_ICON}</button>
                        <button onClick={() => handleDownloadInvoice(inv.id)} title="Download invoice PDF"
                          className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors">{DOWNLOAD_ICON}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        {!selectedInv ? (
          <p className="text-sm text-slate-400 text-center py-8">Select an invoice.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-slate-900">{selectedInv.invoiceNumber}</h3>
                <p className="text-sm text-slate-500">{selectedInv.customer?.name} · {selectedSale?.saleNumber || selectedInv.sale?.saleNumber}</p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[selectedInv.status] || 'bg-slate-100 text-slate-700'}`}>{selectedInv.status}</span>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => handlePrintInvoice(selectedInv)} className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors flex items-center gap-1">
                {PRINT_ICON} Print Invoice
              </button>
              <button onClick={() => handleDownloadInvoice(selectedInv.id)} className="px-3 py-1.5 text-xs font-medium text-green-600 bg-green-50 rounded hover:bg-green-100 transition-colors flex items-center gap-1">
                {DOWNLOAD_ICON} PDF
              </button>
            </div>

            {selectedSale?.lines && selectedSale.lines.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-400"><th>Variant</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {selectedSale.lines.map(l => (
                    <tr key={l.id}>
                      <td className="py-1">{l.variant?.product?.name} {l.variant?.label}</td>
                      <td className="py-1 text-right">{l.qty}</td>
                      <td className="py-1 text-right">{money(l.unitPrice)}</td>
                      <td className="py-1 text-right">{money(l.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-xs">
              {Number(selectedInv.depositApplied || 0) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Deposit Applied:</span><span className="font-medium text-blue-600">-{money(selectedInv.depositApplied)}</span></div>
              )}
              {Number(selectedInv.previousPayments || 0) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Previous Payments:</span><span className="font-medium text-blue-600">-{money(selectedInv.previousPayments)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Total:</span><span className="font-medium">{money(selectedInv.totalAmount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Paid:</span><span className="font-medium">{money(selectedInv.amountPaid)}</span></div>
              {openBalance > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Balance Due:</span><span className="font-bold text-red-600">{money(openBalance)}</span></div>
              )}
            </div>

            {(selectedSale?.paymentTransactions as any[])?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Payment History</h4>
                <div className="space-y-1">
                  {(selectedSale?.paymentTransactions as any[] || []).map((pt: any) => {
                    const receipt = pt.receipts?.[0]
                    return (
                      <div key={pt.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                        <div>
                          <span className="font-medium">{money(pt.amount)}</span>
                          <span className="text-slate-500 ml-1.5">{pt.paymentMethod === 'BANK_TRANSFER' ? 'Transfer' : 'Cash'}</span>
                          <span className="text-slate-400 ml-1.5">{new Date(pt.receivedAt).toLocaleDateString()}</span>
                        </div>
                        {receipt && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => handlePrintReceipt(receipt)} className="p-0.5 text-slate-400 hover:text-blue-600 rounded transition-colors" title="Print receipt">
                              {PRINT_ICON}
                            </button>
                            <button onClick={() => handleDownloadReceipt(receipt.id)} className="p-0.5 text-slate-400 hover:text-green-600 rounded transition-colors" title="Download receipt PDF">
                              {DOWNLOAD_ICON}
                            </button>
                            <span className="text-slate-400 ml-0.5">{receipt.receiptNumber}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {openBalance > 0 && canPay && (
              <div>
                {!showPay ? (
                  <button onClick={() => { setShowPay(true); setPayAmount(String(openBalance)) }} disabled={busy}
                    className="w-full px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                    Record payment
                  </button>
                ) : (
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                        placeholder={`Amount (open ${money(openBalance)})`} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value as any)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                      </select>
                    </div>
                    {Number(payAmount) > openBalance && (
                      <p className="text-xs text-blue-600">Excess over {money(openBalance)} auto-applies to the customer's other debts, oldest first — remainder held as advance deposit.</p>
                    )}
                    <label className="block">
                      <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
                      <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                        className={`w-40 px-3 py-2 border rounded-lg text-sm ${isDateLocked(payDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                    </label>
                    {isDateLocked(payDate, booksLockedUntil) && (
                      <p className="text-xs text-red-600">This date is in a locked period.</p>
                    )}
                    <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Reference (optional)"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                    <div className="flex gap-2">
                      <button onClick={doPay} disabled={busy || isDateLocked(payDate, booksLockedUntil)} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">Save payment</button>
                      <button onClick={() => setShowPay(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
