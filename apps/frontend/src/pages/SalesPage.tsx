import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { salesApi, Sale, CustomerCreditNote } from '../api/sales'
import { customersApi, Customer } from '../api/customers'
import { productsApi, ProductWithVariants } from '../api/products'
import { financeApi, Account } from '../api/finance'
import { hasPermission } from '../stores/authStore'
import { todayLocal } from '../utils/dates'
import { useBooksLocked, isDateLocked } from '../hooks/useBooksLocked'
import { SalesInvoicesTab } from './SalesInvoicesTab'
import { SalesPaymentsTab } from './SalesPaymentsTab'

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data
  return value?.data ?? value
}

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  DELIVERED: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800'
}

function loadSettings() {
  const settingsStr = localStorage.getItem('appSettings')
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

function buildInvoiceHtml(invoice: any, sale: Sale, settings: any) {
  const companyName = settings?.invoiceCompanyName || ''
  const businessAddress = settings?.businessAddress || ''
  const businessTin = settings?.businessTin || ''
  const footerText = settings?.invoiceFooter || ''
  const logoUrl = settings?.invoiceLogoUrl || ''
  const customerName = invoice.customer?.name || sale.customer?.name || 'N/A'

  const dateStr = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date(invoice.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const dueDateStr = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  const subtotal = Number(invoice.subtotal)
  const vatAmount = Number(invoice.vatAmount)
  const totalIncl = Number(invoice.totalAmount)
  const depositApplied = Number(invoice.depositApplied)
  const previousPayments = Number(invoice.previousPayments)
  const balanceDue = Number(invoice.balanceDue)
  const isPaid = invoice.status === 'PAID'

  const formatNaira = (n: number) => '₦' + n.toLocaleString('en-US', { minimumFractionDigits: 2 })

  const lines = sale.lines || []

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice - ${invoice.invoiceNumber}</title>
<style>
  @page { width: 80mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; padding: 8px 6px; line-height: 1.4; }
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
  .stamp-text { font-size: 48px; font-weight: 900; color: rgba(22,163,74,0.12); border: 5px solid rgba(22,163,74,0.18); border-radius: 12px; padding: 8px 20px; transform: rotate(-30deg); text-transform: uppercase; letter-spacing: 0.2em; font-family: 'Courier New', Courier, monospace; }
  .stamp-badge { position: absolute; top: 4px; right: 4px; z-index: 11; background: #16a34a; color: #fff; font-size: 10px; font-weight: bold; padding: 3px 10px; border-radius: 20px; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); font-family: Arial, Helvetica, sans-serif; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="stamp-wrapper">
    ${isPaid ? `
    <div class="stamp-overlay">
      <div class="stamp-text">PAID</div>
      <div class="stamp-badge">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
        PAID ${invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : ''}
      </div>
    </div>` : ''}
    ${logoUrl ? `<img src="${logoUrl}" class="logo" alt="Logo">` : ''}
    <div class="company-name">${companyName}</div>
    ${businessAddress ? `<div class="info">${businessAddress}</div>` : ''}
    ${businessTin ? `<div class="info">TIN: ${businessTin}</div>` : ''}
    <div class="line"></div>
    <div class="title">INVOICE</div>
    <div class="doc-no">${invoice.invoiceNumber}</div>
    <div class="info">${dateStr}${dueDateStr ? '  |  Due: ' + dueDateStr : ''}</div>
    <div class="info">Status: ${invoice.status.replace(/_/g, ' ')}</div>
    <div class="line"></div>
    <div class="row"><span class="label">Customer:</span><span class="value">${customerName}</span></div>
    <div class="row"><span class="label">Sale:</span><span class="value">${sale.saleNumber}</span></div>
    <div class="line"></div>
    <div class="item-header">Items</div>
    ${lines.map((l: any) => `<div class="item-row"><span class="item-desc">${l.variant?.product?.name || ''} ${l.variant?.label || ''}</span><span class="item-qty">${l.qty} packs</span><span class="item-amount">${formatNaira(Number(l.subtotal))}</span></div>`).join('\n    ')}
    ${lines.length === 0 ? '<div class="item-row"><span class="item-desc">—</span></div>' : ''}
    <div class="line"></div>
    <div class="totals-row"><span class="totals-label">Subtotal (excl. VAT)</span><span class="totals-value">${formatNaira(subtotal)}</span></div>
    ${vatAmount > 0 ? `<div class="totals-row"><span class="totals-label">VAT</span><span class="totals-value">${formatNaira(vatAmount)}</span></div>` : ''}
    <div class="totals-row"><span class="totals-label" style="font-weight:bold">Total (incl. VAT)</span><span class="totals-value" style="font-weight:bold">${formatNaira(totalIncl)}</span></div>
    ${depositApplied > 0 ? `<div class="totals-row"><span class="totals-label" style="color:#dc2626">Deposit Applied</span><span class="totals-value" style="color:#dc2626">-${formatNaira(depositApplied)}</span></div>` : ''}
    ${previousPayments > 0 ? `<div class="totals-row"><span class="totals-label" style="color:#dc2626">Previous Payments</span><span class="totals-value" style="color:#dc2626">-${formatNaira(previousPayments)}</span></div>` : ''}
    ${balanceDue > 0
      ? `<div class="balance-due">${formatNaira(balanceDue)}</div><div class="info" style="font-size:10px">Balance Due</div>`
      : `<div class="amount-paid">${formatNaira(totalIncl - balanceDue)}</div><div class="info" style="font-size:10px">Amount Paid</div>`
    }
    <div class="line"></div>
    <div class="footer">${footerText}</div>
  </div>
</body>
</html>`
}

const PRINT_ICON = <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
const DOWNLOAD_ICON = <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>

export function SalesPage() {
  const notify = useNotification()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { booksLockedUntil } = useBooksLocked()
  const [sales, setSales] = useState<Sale[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<ProductWithVariants[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Sale | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newCustomer, setNewCustomer] = useState('')
  const [newLines, setNewLines] = useState<{ variantId: string; qty: string; unitPrice: string; isRefill: boolean }[]>([{ variantId: '', qty: '', unitPrice: '', isRefill: false }])
  const [newEmptyBrought, setNewEmptyBrought] = useState('')
  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH')
  const [payRef, setPayRef] = useState('')
  const [payDate, setPayDate] = useState(todayLocal())
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices' | 'payments' | 'returns'>('orders')
  const [bankAccounts, setBankAccounts] = useState<Account[]>([])
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [showDeliverPay, setShowDeliverPay] = useState(false)
  const [deliverMethod, setDeliverMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH')
  const [deliverBankAccountId, setDeliverBankAccountId] = useState('')
  const [creditNotes, setCreditNotes] = useState<CustomerCreditNote[]>([])
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnSaleId, setReturnSaleId] = useState('')
  const [returnVariantId, setReturnVariantId] = useState('')
  const [returnQty, setReturnQty] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [returnDisposition, setReturnDisposition] = useState<'RESTOCK' | 'SCRAP'>('RESTOCK')
  const [returnRefundMethod, setReturnRefundMethod] = useState<'CREDIT' | 'CASH' | 'BANK'>('CREDIT')
  const [returnDate, setReturnDate] = useState(todayLocal())
  const [returnNotes, setReturnNotes] = useState('')
  const [returnBankAccountId, setReturnBankAccountId] = useState('')

  const canCreate = hasPermission('sales:create')
  const canConfirm = hasPermission('sales:confirm')
  const canDeliver = hasPermission('sales:deliver')
  const canPay = hasPermission('sales:payment')
  const canDiscount = hasPermission('sales:discount')
  const canReturn = hasPermission('sales:return')
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState('')
  const fetchSeq = useRef(0)

  const load = async () => {
    setLoading(true)
    const res = await salesApi.list(statusFilter ? { status: statusFilter } : undefined)
    if (res.error) notify.error(res.error.message)
    else setSales(unwrap<Sale[]>(res) || [])
    setLoading(false)
  }

  const loadCreditNotes = async () => {
    const res = await salesApi.getCreditNotes()
    if (!res.error) setCreditNotes(unwrap<CustomerCreditNote[]>(res) || [])
  }

  const loadProducts = async () => {
    const res = await productsApi.list()
    if (!res.error) setProducts(unwrap<ProductWithVariants[]>(res) || [])
  }

  useEffect(() => {
    load()
    loadCreditNotes()
    customersApi.list().then(res => {
      if (!res.error) {
        const list = unwrap<Customer[]>(res) || []
        setCustomers(list)
        const preselect = searchParams.get('customerId')
        if (preselect && list.some(c => c.id === preselect)) {
          setNewCustomer(preselect)
          setShowNew(true)
          setActiveTab('orders')
          loadProducts()
        }
      }
    })
    if (!searchParams.get('customerId')) loadProducts()
    financeApi.getAccounts().then(res => {
      const all = (res.data as any)?.data || []
      const bank1100 = all.find((a: Account) => a.code === '1100')
      if (bank1100) setBankAccounts(all.filter((a: Account) => a.parentId === bank1100.id))
    })
    if (searchParams.toString()) setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(() => {
    if (activeTab === 'returns') loadCreditNotes()
  }, [activeTab])

  const loadSelected = async (id: string) => {
    const seq = ++fetchSeq.current
    const res = await salesApi.get(id)
    if (fetchSeq.current === seq && !res.error) setSelected(unwrap<Sale>(res) || null)
  }

  const refreshSelected = (id: string) => loadSelected(id)

  const checkCompanyConfigured = (type: 'invoice' | 'receipt'): boolean => {
    const settings = loadSettings()
    const name = type === 'receipt'
      ? (settings?.receiptCompanyName || settings?.invoiceCompanyName || '')
      : (settings?.invoiceCompanyName || '')
    if (!name) {
      notify.error(`Please configure your company name in Settings before ${type === 'invoice' ? 'generating invoices' : 'printing receipts'}`)
      navigate('/settings')
      return false
    }
    return true
  }

  const openDetail = async (sale: Sale) => {
    setShowPay(false); setPayAmount(''); setPayRef(''); setPayMethod('CASH')
    setPayDate(todayLocal()); setEditingLineId(null); setEditingPrice(''); setPayBankAccountId('')
    setShowDeliverPay(false); setDeliverMethod('CASH'); setDeliverBankAccountId('')
    await loadSelected(sale.id)
  }

  const doCreate = async () => {
    const lines = newLines.filter(l => l.variantId && Number(l.qty) > 0).map(l => ({
      variantId: l.variantId,
      qty: Number(l.qty),
      ...(l.unitPrice !== '' ? { unitPrice: Number(l.unitPrice) } : {}),
      ...(l.isRefill ? { isRefill: true } : {})
    }))
    if (!newCustomer || lines.length === 0) { notify.error('Choose a customer and at least one line'); return }
    const hasRefill = lines.some(l => l.isRefill)
    const emptyBrought = newEmptyBrought !== '' ? Number(newEmptyBrought) : undefined
    setBusy(true)
    const res = await salesApi.create({ customerId: newCustomer, lines, ...(hasRefill ? { saleType: 'REFILL' } : {}), ...(emptyBrought != null ? { emptyBrought } : {}) })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Sale drafted — confirm to allocate FG')
    setShowNew(false); setNewCustomer(''); setNewLines([{ variantId: '', qty: '', unitPrice: '', isRefill: false }]); setNewEmptyBrought('')
    load()
  }

  const doConfirm = async (id: string) => {
    setBusy(true)
    const res = await salesApi.confirm(id)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Confirmed — FG allocated')
    load(); refreshSelected(id)
  }

  const doDeliver = async (id: string, method?: 'CASH' | 'BANK_TRANSFER', bankAccountId?: string) => {
    setBusy(true)
    const payment = method ? { method, ...(bankAccountId ? { bankAccountId } : {}) } : undefined
    const res = await salesApi.deliver(id, payment ? { payment } : {})
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success(method ? 'Delivered and paid — completed' : 'Delivered — invoice open (credit)')
    setShowDeliverPay(false); setDeliverMethod('CASH'); setDeliverBankAccountId('')
    load(); refreshSelected(id)
  }

  const doPay = async () => {
    if (!selected || !payAmount) return
    if (isDateLocked(payDate, booksLockedUntil)) { notify.error(`Cannot post to ${payDate} — period is locked`); return }
    setBusy(true)
    const res = await salesApi.recordPayment(selected.id, { amount: Number(payAmount), method: payMethod, date: payDate, reference: payRef || undefined, bankAccountId: payBankAccountId || undefined })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    const payload: any = unwrap<any>(res)
    const over = Number(payload?.overpayment || 0)
    const casc = Number(payload?.cascadedAmount || 0)
    notify.success(`Payment recorded${payload?.receiptNumber ? ` (${payload.receiptNumber})` : ''}${casc > 0 ? ` — ₦${casc.toLocaleString()} applied to other outstanding debts` : ''}${over > 0 ? ` — ₦${over.toLocaleString()} held as advance deposit` : ''}`)
    setShowPay(false); setPayAmount(''); setPayRef(''); setPayDate(todayLocal())
    load(); refreshSelected(selected.id)
  }

  const doCancel = async (id: string) => {
    if (!window.confirm('Cancel this sale?')) return
    setBusy(true)
    const res = await salesApi.cancel(id)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Sale cancelled')
    setSelected(null); load()
  }

  const doCreateReturn = async () => {
    if (!returnSaleId || !returnVariantId || !returnQty || !returnReason.trim()) {
      notify.error('Sale, variant, quantity and reason are required'); return
    }
    if (isDateLocked(returnDate, booksLockedUntil)) { notify.error(`Cannot post to ${returnDate} — period is locked`); return }
    const sale = sales.find(s => s.id === returnSaleId)
    if (!sale) { notify.error('Sale not found'); return }
    setBusy(true)
    const res = await salesApi.createCreditNote({
      customerId: sale.customerId,
      saleId: returnSaleId,
      variantId: returnVariantId,
      quantity: Number(returnQty),
      reason: returnReason.trim(),
      disposition: returnDisposition,
      refundMethod: returnRefundMethod,
      date: returnDate,
      notes: returnNotes || undefined,
      bankAccountId: returnRefundMethod === 'BANK' && returnBankAccountId ? returnBankAccountId : undefined
    })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success(`Return recorded — ${(res.data as any)?.data?.creditNoteNumber || (res as any)?.data?.creditNoteNumber || ''} ${returnDisposition === 'RESTOCK' ? '(restocked)' : '(scrapped)'}`)
    setShowReturnForm(false); setReturnSaleId(''); setReturnVariantId(''); setReturnQty(''); setReturnReason(''); setReturnNotes(''); setReturnDisposition('RESTOCK'); setReturnRefundMethod('CREDIT'); setReturnDate(todayLocal()); setReturnBankAccountId('')
    loadCreditNotes()
    if (selected?.id === returnSaleId) refreshSelected(returnSaleId)
  }

  const doUpdateLinePrice = async (saleId: string, lineId: string) => {
    const price = Number(editingPrice)
    if (isNaN(price) || price < 0) { notify.error('Invalid price'); return }
    setBusy(true)
    const res = await salesApi.updateLinePrice(saleId, lineId, price)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    setEditingLineId(null); setEditingPrice('')
    notify.success('Price updated')
    refreshSelected(saleId)
  }

  const handlePrintInvoice = async (invoice: any, sale: Sale) => {
    if (!checkCompanyConfigured('invoice')) return
    const settings = loadSettings()
    const win = window.open('', '_blank', 'width=400,height=700')
    if (!win) return
    win.document.write(buildInvoiceHtml(invoice, sale, settings))
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 500)
  }

  const handleDownloadInvoice = async (invoiceId: string) => {
    if (!checkCompanyConfigured('invoice')) return
    try {
      await salesApi.downloadInvoicePdf(invoiceId)
    } catch (err: any) {
      notify.error(err.message || 'Failed to download invoice')
    }
  }

  const handlePrintReceipt = async (receipt: any) => {
    if (!checkCompanyConfigured('receipt')) return
    const settings = loadSettings()
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) return
    win.document.write(buildReceiptHtml(receipt, settings))
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 500)
  }

  const handleDownloadReceipt = async (receiptId: string) => {
    if (!checkCompanyConfigured('receipt')) return
    try {
      await salesApi.downloadReceiptPdf(receiptId)
    } catch (err: any) {
      notify.error(err.message || 'Failed to download receipt')
    }
  }

  const variants = products.flatMap(p => (p.variants || []).filter(v => v.isActive).map(v => ({ ...v, productName: p.name, category: p.category })))
  const selectedCustomer = customers.find(c => c.id === newCustomer)
  const customerDiscount = Number(selectedCustomer?.discountPercent) || 0

  const getDiscountedPrice = (variantId: string, isRefill = false) => {
    const v = variants.find(x => x.id === variantId)
    if (!v) return ''
    const basePrice = isRefill && v.refillPrice != null && v.refillPrice > 0 ? Number(v.refillPrice) : Number(v.pricePerUnit)
    const discounted = Math.round(basePrice * (1 - customerDiscount / 100) * 100) / 100
    return String(discounted)
  }
  const openBalance = selected?.invoices?.reduce((s, i: any) => s + Number(i.balanceDue || 0), 0) || 0
  const filtered = sales.filter(s => {
    const q = search.toLowerCase()
    return !q || s.saleNumber.toLowerCase().includes(q) || s.customer?.name?.toLowerCase().includes(q)
  })

  const selectedInvoice = selected?.invoices?.[0] as any
  const isDeliveredOrCompleted = (s: Sale) => s.status === 'DELIVERED' || s.status === 'COMPLETED'

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Sales</h1>
            <p className="text-slate-500 mt-1">Sell from FG stock — draft → confirm → deliver → paid</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sales..."
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="DELIVERED">Delivered (credit open)</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            {canCreate && (
              <button onClick={() => { setActiveTab('orders'); setShowNew(true); loadProducts() }} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">+ New sale</button>
            )}
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          <button onClick={() => setActiveTab('orders')} className={`px-4 py-2 font-medium ${activeTab === 'orders' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Orders</button>
          <button onClick={() => setActiveTab('invoices')} className={`px-4 py-2 font-medium ${activeTab === 'invoices' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Invoices</button>
          <button onClick={() => setActiveTab('payments')} className={`px-4 py-2 font-medium ${activeTab === 'payments' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Payments</button>
          <button onClick={() => setActiveTab('returns')} className={`px-4 py-2 font-medium ${activeTab === 'returns' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Returns</button>
          {activeTab === 'returns' && canReturn && (
            <button onClick={() => setShowReturnForm(true)} className="ml-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700">+ Record Return</button>
          )}
        </div>

        {activeTab === 'orders' && (
          <>
          {showNew && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h2 className="font-semibold text-slate-800">New sale (POS)</h2>
            {customerDiscount > 0 && (
              <p className="text-xs text-blue-600 mt-0.5">Customer has {customerDiscount}% discount — prices auto-adjusted</p>
            )}
            <select value={newCustomer} onChange={e => setNewCustomer(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
              <option value="">Customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectedCustomer && (selectedCustomer.jarBalance ?? 0) !== 0 && (
              <p className={`text-xs mt-0.5 ${(selectedCustomer.jarBalance ?? 0) > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                Empty jars: {selectedCustomer.jarBalance} {(selectedCustomer.jarBalance ?? 0) < 0 ? '(owed)' : ''}
              </p>
            )}
            {selectedCustomer && newLines.some(l => l.isRefill) && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600 whitespace-nowrap">Empty jars brought</label>
                <input type="number" min="0" value={newEmptyBrought} onChange={e => setNewEmptyBrought(e.target.value)}
                  placeholder="0" className="w-20 px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
              </div>
            )}
            {newLines.length > 0 && (
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-400 px-1">
                <div className="col-span-5">Variant</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-4 text-center">Price/pack</div>
                <div className="col-span-1"></div>
              </div>
            )}
            {newLines.map((l, i) => {
              const selectedVariant = variants.find(v => v.id === l.variantId)
              const available = selectedVariant?.availableFgQty ?? 0
              const existingQty = l.qty ? Number(l.qty) : 0
              const exceeding = existingQty > available
              const isJarVariant = selectedVariant?.category === 'JAR' && selectedVariant?.refillPrice != null && selectedVariant.refillPrice > 0
              return (
              <div key={i} className="space-y-0.5">
              <div className="grid grid-cols-12 gap-2">
                <select value={l.variantId} onChange={e => {
                  const isJar = !!(e.target.value && variants.find(v => v.id === e.target.value)?.category === 'JAR')
                  const next = [...newLines]; next[i] = { ...next[i], variantId: e.target.value, unitPrice: getDiscountedPrice(e.target.value, isJar), isRefill: isJar }; setNewLines(next)
                }} className="col-span-5 px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="">Variant...</option>
                  {variants.map(v => <option key={v.id} value={v.id}>{v.productName} — {v.label} @ {money(v.pricePerUnit)}</option>)}
                </select>
                <input type="number" min="1" value={l.qty} onChange={e => {
                  const next = [...newLines]; next[i] = { ...next[i], qty: e.target.value }; setNewLines(next)
                }} placeholder="packs" className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <div className="col-span-3 flex items-center gap-1">
                  <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={e => {
                    const next = [...newLines]; next[i] = { ...next[i], unitPrice: e.target.value }; setNewLines(next)
                  }} placeholder="price" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  {l.unitPrice && l.variantId && Number(l.unitPrice) < Number(getDiscountedPrice(l.variantId, l.isRefill)) && (
                    <span className="text-xs text-amber-600 whitespace-nowrap" title="Price differs from expected — requires sales:discount permission">!</span>
                  )}
                </div>
                <button onClick={() => setNewLines(newLines.filter((_, j) => j !== i))} className="col-span-1 text-red-500 text-lg">&times;</button>
              </div>
              {isJarVariant && l.variantId && (
                <div className="flex items-center gap-2 px-1">
                  <button type="button" onClick={() => {
                    const next = [...newLines]; next[i] = { ...next[i], isRefill: false, unitPrice: getDiscountedPrice(l.variantId, false) }; setNewLines(next)
                  }} className={`px-2.5 py-0.5 text-xs rounded-full border ${!l.isRefill ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Outright</button>
                  <button type="button" onClick={() => {
                    const next = [...newLines]; next[i] = { ...next[i], isRefill: true, unitPrice: getDiscountedPrice(l.variantId, true) }; setNewLines(next)
                  }} className={`px-2.5 py-0.5 text-xs rounded-full border ${l.isRefill ? 'bg-emerald-100 border-emerald-300 text-emerald-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Refill</button>
                  {l.isRefill && selectedCustomer?.jarBalance != null && selectedCustomer.jarBalance > 0 && (
                    <span className="text-[11px] text-emerald-600">Empty jars: {selectedCustomer.jarBalance}</span>
                  )}
                </div>
              )}
              {l.variantId && !isJarVariant && (
                <p className={`px-1 text-xs ${exceeding ? 'text-red-600' : available > 0 ? 'text-slate-500' : 'text-amber-600'}`}>
                  Available: {available} {available === 1 ? 'pack' : 'packs'} in FG store
                  {exceeding ? ` — entered qty exceeds available` : ''}
                </p>
              )}
              {l.variantId && isJarVariant && (
                <p className={`px-1 text-xs ${exceeding ? 'text-red-600' : available > 0 ? 'text-slate-500' : 'text-amber-600'}`}>
                  Available: {available} {available === 1 ? 'pack' : 'packs'} in FG store
                  {exceeding ? ` — entered qty exceeds available` : ''}
                </p>
              )}
              </div>
            )})}
            <div className="flex gap-2">
              <button onClick={() => setNewLines([...newLines, { variantId: '', qty: '', unitPrice: '', isRefill: false }])} className="text-sm text-blue-600 font-medium">+ Add line</button>
              <span className="flex-1" />
              <button onClick={doCreate} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Save draft</button>
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Sales</h2></div>
            {loading ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
            ) : sales.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No sales yet.</div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No sales match your search.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map(s => (
                  <div key={s.id}
                    className={`px-6 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer ${selected?.id === s.id ? 'bg-blue-50' : ''}`}
                    onClick={() => openDetail(s)}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900">{s.saleNumber} · {s.customer?.name}</p>
                      <p className="text-sm text-slate-500">
                        {money(s.totalAmount)} · {fmtDate(s.createdAt)}
                        {(s.invoices as any)?.[0]?.issuedAt && ` · Issued ${fmtDate((s.invoices as any)[0].issuedAt)}`}
                        {(s.invoices as any)?.[0]?.dueDate && ` · Due ${fmtDate((s.invoices as any)[0].dueDate)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      {isDeliveredOrCompleted(s) && (s.invoices as any[])?.length > 0 && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); handlePrintInvoice((s.invoices as any[])[0], s) }}
                            title="Print invoice"
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                            {PRINT_ICON}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleDownloadInvoice((s.invoices as any[])[0].id) }}
                            title="Download invoice PDF"
                            className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors">
                            {DOWNLOAD_ICON}
                          </button>
                        </>
                      )}
                      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[s.status]}`}>{s.status}</span>
                      {s.saleType === 'REFILL' && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">R</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            {!selected ? (
              <p className="text-sm text-slate-400 text-center py-8">Select a sale.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">{selected.saleNumber}</h3>
                    <p className="text-sm text-slate-500">{selected.customer?.name} · {money(selected.totalAmount)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                    {selected.saleType === 'REFILL' && <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">REFILL</span>}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-400"><th>Variant</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {(selected.lines || []).map(l => (
                      <tr key={l.id}>
                        <td className="py-1">
                          {l.variant?.product?.name} {l.variant?.label}
                          {l.isRefill && <span className="ml-1 text-[10px] text-emerald-600 font-medium">REFILL</span>}
                        </td>
                        <td className="py-1 text-right">{l.qty}</td>
                        <td className="py-1 text-right">
                          {editingLineId === l.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <input type="number" min="0" step="0.01" value={editingPrice} onChange={e => setEditingPrice(e.target.value)}
                                className="w-20 px-1 py-0.5 border border-slate-300 rounded text-sm text-right" autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') doUpdateLinePrice(selected.id, l.id); if (e.key === 'Escape') setEditingLineId(null) }} />
                              <button onClick={() => doUpdateLinePrice(selected.id, l.id)} className="text-xs text-blue-600 font-medium">OK</button>
                              <button onClick={() => setEditingLineId(null)} className="text-xs text-slate-400">x</button>
                            </div>
                          ) : (
                            <span
                              className={selected.status === 'DRAFT' && canDiscount ? 'cursor-pointer hover:text-blue-600 hover:underline decoration-dotted underline-offset-2' : ''}
                              onClick={() => { if (selected.status === 'DRAFT' && canDiscount) { setEditingLineId(l.id); setEditingPrice(String(l.unitPrice)) } }}
                              title={selected.status === 'DRAFT' && canDiscount ? 'Click to edit price' : ''}
                            >{money(l.unitPrice)}</span>
                          )}
                        </td>
                        <td className="py-1 text-right">{money(l.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {selectedInvoice && isDeliveredOrCompleted(selected) && (
                  <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">Invoice {selectedInvoice.invoiceNumber}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handlePrintInvoice(selectedInvoice, selected)} className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors flex items-center gap-1">
                          {PRINT_ICON} Print
                        </button>
                        <button onClick={() => handleDownloadInvoice(selectedInvoice.id)} className="px-2 py-1 text-xs font-medium text-green-600 bg-green-50 rounded hover:bg-green-100 transition-colors flex items-center gap-1">
                          {DOWNLOAD_ICON} PDF
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div><span className="text-slate-500">Subtotal:</span> <span className="font-medium">{money(selectedInvoice.subtotal)}</span></div>
                      <div><span className="text-slate-500">VAT:</span> <span className="font-medium">{money(selectedInvoice.vatAmount)}</span></div>
                      <div><span className="text-slate-500">Total:</span> <span className="font-medium">{money(selectedInvoice.totalAmount)}</span></div>
                      <div><span className="text-slate-500">Paid:</span> <span className="font-medium">{money(selectedInvoice.amountPaid)}</span></div>
                      {openBalance > 0 && (
                        <div className="col-span-2"><span className="text-slate-500">Balance:</span> <span className="font-bold text-red-600">{money(openBalance)}</span></div>
                      )}
                    </div>
                  </div>
                )}

                {(selected.paymentTransactions as any[])?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Payments</h4>
                    <div className="space-y-1">
                      {(selected.paymentTransactions as any[]).map((pt: any) => {
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

                <div className="flex flex-wrap gap-2 pt-1">
                  {selected.status === 'DRAFT' && canConfirm && (
                    <button onClick={() => doConfirm(selected.id)} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Confirm (allocate FG)</button>
                  )}
                  {selected.status === 'CONFIRMED' && canDeliver && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {!showDeliverPay && (
                        <>
                          <button onClick={() => { setShowDeliverPay(true); setDeliverMethod('CASH'); setDeliverBankAccountId('') }} disabled={busy} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">Deliver + Payment</button>
                          <button onClick={() => doDeliver(selected.id)} disabled={busy} className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg disabled:opacity-50">Deliver on credit</button>
                        </>
                      )}
                    </div>
                  )}
                  {selected.status === 'CONFIRMED' && canDeliver && showDeliverPay && (
                    <div className="border-t border-slate-100 pt-3 space-y-2 w-full">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-slate-600">Payment method</label>
                        <select value={deliverMethod} onChange={e => { setDeliverMethod(e.target.value as any); setDeliverBankAccountId('') }} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                          <option value="CASH">Cash</option>
                          <option value="BANK_TRANSFER">Bank transfer</option>
                        </select>
                      </div>
                      {deliverMethod === 'BANK_TRANSFER' && (
                        <select value={deliverBankAccountId} onChange={e => setDeliverBankAccountId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                          {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                          <option value="">Default (Bank — 1100)</option>
                        </select>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => doDeliver(selected.id, deliverMethod, deliverBankAccountId || undefined)} disabled={busy} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">Confirm delivery</button>
                        <button onClick={() => { setShowDeliverPay(false); setDeliverMethod('CASH'); setDeliverBankAccountId('') }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                      </div>
                    </div>
                  )}
                  {selected.status === 'DELIVERED' && openBalance > 0 && canPay && (
                    <button onClick={() => { setShowPay(true); setPayAmount(String(openBalance)); setPayBankAccountId('') }} disabled={busy} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">Record payment</button>
                  )}
                  {(selected.status === 'DELIVERED' || selected.status === 'COMPLETED') && canReturn && (
                    <button onClick={() => { setActiveTab('returns'); setShowReturnForm(true); setReturnSaleId(selected.id); setReturnVariantId(''); setReturnQty(''); setReturnReason(''); setReturnNotes(''); setReturnDisposition('RESTOCK'); setReturnRefundMethod('CREDIT'); setReturnDate(todayLocal()) }} className="px-4 py-2 text-sm text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50">Record Return</button>
                  )}
                  {(selected.status === 'DRAFT' || selected.status === 'CONFIRMED') && canDeliver && (
                    <button onClick={() => doCancel(selected.id)} disabled={busy} className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg disabled:opacity-50">Cancel</button>
                  )}
                </div>
                {showPay && (
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                        placeholder={`Amount (open ${money(openBalance)})`} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                      <select value={payMethod} onChange={e => { setPayMethod(e.target.value as any); setPayBankAccountId('') }} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                      </select>
                    </div>
                    {payMethod === 'BANK_TRANSFER' && (
                      <select value={payBankAccountId} onChange={e => setPayBankAccountId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        <option value="">Default (Bank — 1100)</option>
                      </select>
                    )}
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
        </div>
        </>
        )}

        {activeTab === 'invoices' && <SalesInvoicesTab />}
        {activeTab === 'payments' && <SalesPaymentsTab />}
        {activeTab === 'returns' && (
          <div className="space-y-4">
            {showReturnForm && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h2 className="font-semibold text-slate-800">Record Customer Return (defective / bad product)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select value={returnSaleId} onChange={e => { setReturnSaleId(e.target.value); setReturnVariantId(''); setReturnQty('') }}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Select sale (DELIVERED/COMPLETED)</option>
                    {sales.filter(s => s.status === 'DELIVERED' || s.status === 'COMPLETED').map(s => (
                      <option key={s.id} value={s.id}>{s.saleNumber} — {s.customer?.name}</option>
                    ))}
                  </select>
                  <select value={returnVariantId} onChange={e => { setReturnVariantId(e.target.value); setReturnQty('') }}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Variant (from sale)</option>
                    {(() => {
                      const sale = sales.find(s => s.id === returnSaleId)
                      return (sale?.lines || []).map(l => (
                        <option key={l.id} value={l.variantId}>{l.variant?.product?.name} {l.variant?.label} — {l.qty} packs @ {money(l.unitPrice)}</option>
                      ))
                    })()}
                  </select>
                </div>
                {returnSaleId && returnVariantId && (() => {
                  const sale = sales.find(s => s.id === returnSaleId)
                  const line = sale?.lines?.find(l => l.variantId === returnVariantId)
                  const alreadyReturned = creditNotes.filter(c => c.saleId === returnSaleId && c.variantId === returnVariantId).reduce((s, c) => s + c.quantity, 0)
                  const maxQty = line ? line.qty - alreadyReturned : 0
                  return (
                    <p className={`text-xs ${maxQty <= 0 ? 'text-red-600' : 'text-slate-500'}`}>
                      Returnable: {maxQty} packs {line ? `(original ${line.qty}, already returned ${alreadyReturned})` : ''} {maxQty <= 0 && '— nothing returnable'}
                    </p>
                  )
                })()}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input type="number" min="1" step="1" value={returnQty} onChange={e => setReturnQty(e.target.value)}
                    placeholder="Quantity (packs)" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
                    className={`px-3 py-2 border rounded-lg text-sm ${isDateLocked(returnDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                  <select value={returnRefundMethod} onChange={e => { setReturnRefundMethod(e.target.value as any); setReturnBankAccountId('') }}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="CREDIT">Credit (advance for next order)</option>
                    <option value="CASH">Refund cash</option>
                    <option value="BANK">Refund bank</option>
                  </select>
                </div>
                {returnRefundMethod === 'BANK' && (
                  <select value={returnBankAccountId} onChange={e => setReturnBankAccountId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Select bank account (optional — defaults to 1100)</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                )}
                {isDateLocked(returnDate, booksLockedUntil) && (
                  <p className="text-xs text-red-600">This date is in a locked period.</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">Disposition:</span>
                  <button type="button" onClick={() => setReturnDisposition('RESTOCK')}
                    className={`px-3 py-1.5 text-xs rounded-full border ${returnDisposition === 'RESTOCK' ? 'bg-emerald-100 border-emerald-300 text-emerald-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    Restock → FG_STORE (sellable)
                  </button>
                  <button type="button" onClick={() => setReturnDisposition('SCRAP')}
                    className={`px-3 py-1.5 text-xs rounded-full border ${returnDisposition === 'SCRAP' ? 'bg-red-100 border-red-300 text-red-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    Scrap → FG_DEFECTIVE (not sellable)
                  </button>
                </div>
                <input value={returnReason} onChange={e => setReturnReason(e.target.value)} placeholder="Reason (e.g., Leaking bottles, bad sachet seal)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input value={returnNotes} onChange={e => setReturnNotes(e.target.value)} placeholder="Notes (optional)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <div className="flex gap-2">
                  <button onClick={doCreateReturn} disabled={busy || isDateLocked(returnDate, booksLockedUntil)} className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg disabled:opacity-50">Save Return</button>
                  <button onClick={() => setShowReturnForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Customer returns (credit notes)</h2></div>
              {creditNotes.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">No returns yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {creditNotes.map(cn => (
                    <div key={cn.id} className="px-6 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{cn.creditNoteNumber} · {cn.customer?.name} · {cn.sale?.saleNumber}</p>
                          <p className="text-sm text-slate-500">{cn.variant?.product?.name} {cn.variant?.label} — {cn.quantity} packs · {money(cn.amount)}{cn.date && ` · ${new Date(cn.date).toLocaleDateString()}`} · {cn.disposition === 'RESTOCK' ? 'Restocked' : 'Scrapped'} → {cn.disposition === 'RESTOCK' ? 'FG_STORE' : 'FG_DEFECTIVE'} · {cn.refundMethod === 'CREDIT' ? 'Credit' : cn.refundMethod === 'CASH' ? 'Cash refund' : 'Bank refund'}</p>
                          <p className="text-xs text-slate-400">{cn.reason}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
