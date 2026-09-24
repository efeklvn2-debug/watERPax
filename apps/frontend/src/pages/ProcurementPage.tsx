import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { procurementApi, PurchaseOrder, SupplierInvoice, SupplierCreditNote } from '../api/procurement'
import { inventoryApi, MaterialWithStock } from '../api/inventory'
import { suppliersApi, Supplier } from '../api/suppliers'
import { financeApi, Account } from '../api/finance'
import { hasPermission } from '../stores/authStore'
import { todayLocal } from '../utils/dates'
import { useBooksLocked, isDateLocked } from '../hooks/useBooksLocked'

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

type TabType = 'pos' | 'invoices' | 'credit-notes'

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  RECEIVED: 'bg-green-100 text-green-800',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-red-100 text-red-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800'
}

interface DraftLine {
  materialId: string
  quantity: string
  unitPrice: string
}

const emptyLine = (): DraftLine => ({ materialId: '', quantity: '', unitPrice: '' })

export function ProcurementPage() {
  const notify = useNotification()
  const { booksLockedUntil } = useBooksLocked()
  const [activeTab, setActiveTab] = useState<TabType>('pos')
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([])
  const [materials, setMaterials] = useState<MaterialWithStock[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierNames, setSupplierNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PurchaseOrder | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [supplier, setSupplier] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [busy, setBusy] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [receiveAutoInvoice, setReceiveAutoInvoice] = useState(true)
  const [receiveInvAmount, setReceiveInvAmount] = useState('')
  const [receiveInvDate, setReceiveInvDate] = useState('')
  const [showPay, setShowPay] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'Cash' | 'Bank Transfer'>('Cash')
  const [payDate, setPayDate] = useState(todayLocal())
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState<Account[]>([])
  const [poSearch, setPoSearch] = useState('')
  const [poStatus, setPoStatus] = useState('')
  const [invSearch, setInvSearch] = useState('')
  const [invStatus, setInvStatus] = useState('')
  const [creditNotes, setCreditNotes] = useState<SupplierCreditNote[]>([])
  const [showCreditNote, setShowCreditNote] = useState(false)
  const [cnSupplier, setCnSupplier] = useState('')
  const [cnPoId, setCnPoId] = useState('')
  const [cnAmount, setCnAmount] = useState('')
  const [cnDate, setCnDate] = useState(todayLocal())
  const [cnReason, setCnReason] = useState('')
  const [cnNotes, setCnNotes] = useState('')
  const [cnMaterialId, setCnMaterialId] = useState('')
  const [cnQuantity, setCnQuantity] = useState('')

  const canCreate = hasPermission('procurement:create')
  const canEdit = hasPermission('procurement:edit')
  const canReceive = hasPermission('procurement:receive')
  const canReturn = hasPermission('procurement:return')

  const loadPOs = async () => {
    setLoading(true)
    const res = await procurementApi.getPOs()
    if (res.error) notify.error(res.error.message)
    else setPos(unwrap<PurchaseOrder[]>(res) || [])
    setLoading(false)
  }

  const loadInvoices = async () => {
    setLoading(true)
    const res = await procurementApi.getSupplierInvoices()
    if (res.error) notify.error(res.error.message)
    else setInvoices(unwrap<SupplierInvoice[]>(res) || [])
    setLoading(false)
  }

  const loadCreditNotes = async () => {
    setLoading(true)
    const res = await procurementApi.getCreditNotes()
    if (res.error) notify.error(res.error.message)
    else setCreditNotes(unwrap<SupplierCreditNote[]>(res) || [])
    setLoading(false)
  }

  useEffect(() => {
    if (activeTab === 'pos') loadPOs()
    else if (activeTab === 'invoices') loadInvoices()
    else loadCreditNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  useEffect(() => {
    inventoryApi.getMaterials().then(res => {
      if (!res.error) setMaterials(unwrap<MaterialWithStock[]>(res) || [])
    })
    suppliersApi.getAll().then((res: any) => {
      const list = unwrap<any[]>(res) || []
      setSuppliers(list)
      setSupplierNames(list.map((s: any) => s.name))
    }).catch(() => {})
    financeApi.getAccounts().then(res => {
      const all = (res.data as any)?.data || []
      const bank1100 = all.find((a: Account) => a.code === '1100')
      if (bank1100) setBankAccounts(all.filter((a: Account) => a.parentId === bank1100.id))
    })
  }, [])

  const refreshSelected = async (id: string) => {
    const res = await procurementApi.getPO(id)
    if (!res.error) setSelected(unwrap<PurchaseOrder>(res) || null)
  }

  const doCreate = async () => {
    const items = lines
      .filter(l => l.materialId && Number(l.quantity) > 0 && l.unitPrice !== '')
      .map(l => ({
        materialId: l.materialId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice)
      }))
    if (!supplier.trim() || items.length === 0) { notify.error('Supplier and at least one line are required'); return }
    setBusy(true)
    const res = await procurementApi.createPO({
      supplier: supplier.trim(),
      expectedDate: expectedDate || undefined,
      items
    })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Purchase order created')
    setShowNew(false); setSupplier(''); setExpectedDate(''); setLines([emptyLine()])
    loadPOs()
  }

  const doReceive = async (id: string) => {
    const payload: { date?: string; invoice?: { amount: number; date: string } } = {}
    if (receiveAutoInvoice) {
      if (!receiveInvAmount || !receiveInvDate) { notify.error('Invoice amount and date are required'); return }
      if (isDateLocked(receiveInvDate, booksLockedUntil)) { notify.error(`Cannot post to ${receiveInvDate} — period is locked`); return }
      payload.invoice = { amount: Number(receiveInvAmount), date: receiveInvDate }
    }
    setBusy(true)
    const res = await procurementApi.receivePO(id, payload)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success(receiveAutoInvoice ? 'PO received + supplier invoice booked' : 'PO received — stock updated')
    setShowReceive(false); setReceiveAutoInvoice(true); setReceiveInvAmount(''); setReceiveInvDate('')
    loadPOs(); refreshSelected(id)
  }

  const doDelete = async (id: string) => {
    if (!window.confirm('Delete this pending PO?')) return
    setBusy(true)
    const res = await procurementApi.deletePO(id)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('PO deleted')
    setSelected(null); loadPOs()
  }

  const doPay = async (invoiceId: string) => {
    if (!payAmount) return
    if (isDateLocked(payDate, booksLockedUntil)) { notify.error(`Cannot post to ${payDate} — period is locked`); return }
    setBusy(true)
    const res = await procurementApi.addPayment(invoiceId, {
      amount: Number(payAmount),
      date: payDate,
      paymentMethod: payMethod,
      bankAccountId: payBankAccountId || undefined
    })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Payment recorded')
    setShowPay(null); setPayAmount(''); setPayDate(todayLocal()); setPayBankAccountId('')
    loadInvoices()
  }

  const doCreateCreditNote = async () => {
    if (!cnSupplier.trim() || !cnAmount || !cnDate || !cnReason.trim()) {
      notify.error('Supplier, amount, date, and reason are required'); return
    }
    if (isDateLocked(cnDate, booksLockedUntil)) { notify.error(`Cannot post to ${cnDate} — period is locked`); return }
    setBusy(true)
    const res = await procurementApi.createCreditNote({
      supplierId: cnSupplier.trim(),
      poId: cnPoId || undefined,
      amount: Number(cnAmount),
      date: cnDate,
      reason: cnReason.trim(),
      materialId: cnMaterialId || undefined,
      quantity: cnQuantity ? Number(cnQuantity) : undefined,
      notes: cnNotes || undefined
    })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Credit note created')
    setShowCreditNote(false); setCnSupplier(''); setCnPoId(''); setCnAmount(''); setCnDate(todayLocal()); setCnReason(''); setCnNotes(''); setCnMaterialId(''); setCnQuantity('')
    loadCreditNotes()
  }

  const matById = (id: string) => materials.find(m => m.id === id)

  const cnSupplierPOs = (() => {
    if (!cnSupplier) return []
    const sup = suppliers.find(s => s.id === cnSupplier)
    if (!sup) return []
    return pos.filter(p => p.supplier === sup.name && (p.status === 'RECEIVED' || p.status === 'PARTIALLY_RECEIVED'))
  })()

  const filteredPOs = pos.filter(p => {
    const q = poSearch.toLowerCase()
    const matchesSearch = !q || p.poNumber.toLowerCase().includes(q) || p.supplier?.toLowerCase().includes(q)
    const matchesStatus = !poStatus || p.status === poStatus
    return matchesSearch && matchesStatus
  })

  const filteredInvoices = invoices.filter(inv => {
    const q = invSearch.toLowerCase()
    const matchesSearch = !q || inv.invoiceNumber?.toLowerCase().includes(q) || inv.supplier?.name?.toLowerCase().includes(q)
    const matchesStatus = !invStatus || inv.status === invStatus
    return matchesSearch && matchesStatus
  })

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Procurement</h1>
            <p className="text-slate-500 mt-1">Preforms (per-lot spec), caps, labels, wrap — received straight to stock</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
              <button onClick={() => setActiveTab('pos')} className={`px-4 py-2 font-medium ${activeTab === 'pos' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Orders</button>
              <button onClick={() => setActiveTab('invoices')} className={`px-4 py-2 font-medium ${activeTab === 'invoices' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Invoices</button>
              <button onClick={() => setActiveTab('credit-notes')} className={`px-4 py-2 font-medium ${activeTab === 'credit-notes' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Credit Notes</button>
            </div>
            {activeTab === 'pos' && canCreate && (
              <button onClick={() => setShowNew(true)} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">+ New PO</button>
            )}
            {activeTab === 'credit-notes' && canReturn && (
              <button onClick={() => setShowCreditNote(true)} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700">+ Record Credit Note</button>
            )}
          </div>
        </div>

        {activeTab === 'pos' && (
          <div className="flex items-center gap-2">
            <input value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="Search POs..."
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <select value={poStatus} onChange={e => setPoStatus(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="RECEIVED">Received</option>
              <option value="PARTIALLY_RECEIVED">Partially Received</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        )}

        {activeTab === 'pos' && showNew && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h2 className="font-semibold text-slate-800">New purchase order</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier" list="supplier-list"
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <datalist id="supplier-list">{supplierNames.map(n => <option key={n} value={n} />)}</datalist>
              <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            {lines.map((l, i) => {
              const mat = matById(l.materialId)
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-center border-t border-slate-100 pt-3">
                  <select value={l.materialId} onChange={e => {
                    const next = [...lines]; next[i] = { ...next[i], materialId: e.target.value }
                    const selected = materials.find(m => m.id === e.target.value)
                    if (selected && selected.costPrice) next[i] = { ...next[i], unitPrice: String(selected.costPrice) }
                    setLines(next)
                  }} className="col-span-5 px-2 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Material...</option>
                    {materials.filter(m => m.isActive).map(m => <option key={m.id} value={m.id}>{m.code} — {m.name} ({m.unitOfMeasure})</option>)}
                  </select>
                  <input type="number" min="0" step="any" value={l.quantity} onChange={e => {
                    const next = [...lines]; next[i] = { ...next[i], quantity: e.target.value }; setLines(next)
                  }} placeholder={`Qty${mat ? ` (${mat.unitOfMeasure})` : ''}`} className="col-span-3 px-2 py-2 border border-slate-300 rounded-lg text-sm" />
                  <input type="number" min="0" step="any" value={l.unitPrice} onChange={e => {
                    const next = [...lines]; next[i] = { ...next[i], unitPrice: e.target.value }; setLines(next)
                  }} placeholder="₦/unit" className="col-span-3 px-2 py-2 border border-slate-300 rounded-lg text-sm" />
                  <div className="col-span-1 flex items-center justify-center">
                    <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-red-500 text-lg">&times;</button>
                  </div>
                </div>
              )
            })}
            <div className="flex gap-2">
              <button onClick={() => setLines([...lines, emptyLine()])} className="text-sm text-blue-600 font-medium">+ Add line</button>
              <span className="flex-1" />
              <button onClick={doCreate} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Save PO</button>
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            </div>
          </div>
        )}

        {activeTab === 'pos' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Purchase orders</h2></div>
              {loading ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
              ) : pos.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">No purchase orders yet.</div>
              ) : filteredPOs.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">No POs match your search.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredPOs.map(p => (
                    <div key={p.id} className={`px-6 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer ${selected?.id === p.id ? 'bg-blue-50' : ''}`}
                      onClick={() => setSelected(p)}>
                    <div>
                      <p className="font-medium text-slate-900">{p.poNumber} · {p.supplier}</p>
                      <p className="text-sm text-slate-500">{p.totalAmount != null ? money(p.totalAmount) : ''}{p.expectedDate && ` · Exp ${fmtDate(p.expectedDate)}`}{p.createdAt && ` · Created ${fmtDate(p.createdAt)}`}</p>
                    </div>
                      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              {!selected ? (
                <p className="text-sm text-slate-400 text-center py-8">Select a PO.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">{selected.poNumber}</h3>
                      <p className="text-sm text-slate-500">{selected.supplier}{selected.totalAmount != null && ` · ${money(selected.totalAmount)}`}{selected.expectedDate && ` · Exp ${new Date(selected.expectedDate).toLocaleDateString()}`}{selected.receivedDate && ` · Received ${new Date(selected.receivedDate).toLocaleDateString()}`}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-400">
                      <th className="max-w-[200px]">Material</th>
                      <th className="text-right whitespace-nowrap w-20">Qty</th>
                      <th className="text-right whitespace-nowrap w-28 pl-4">₦/unit</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {(selected.items || []).map(item => (
                        <tr key={item.id}>
                          <td className="py-1.5 max-w-[200px] truncate">{item.material?.code} — {item.material?.name}
                            <span className="text-slate-400 text-xs ml-1">({item.material?.unitOfMeasure})</span></td>
                          <td className="py-1.5 text-right whitespace-nowrap w-20">{item.quantity}</td>
                          <td className="py-1.5 text-right whitespace-nowrap w-28 pl-4">{money(item.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selected.status === 'PENDING' && canReceive && (
                      <button onClick={() => { setShowReceive(true); setReceiveInvAmount(String(selected.totalAmount || '')); setReceiveInvDate(todayLocal()) }} disabled={busy} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">Receive into stock</button>
                    )}
                    {selected.status === 'PENDING' && canEdit && (
                      <button onClick={() => doDelete(selected.id)} disabled={busy} className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg disabled:opacity-50">Delete</button>
                    )}
                  </div>
                  {showReceive && (
                    <div className="border-t border-slate-100 pt-3 space-y-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={receiveAutoInvoice} onChange={e => setReceiveAutoInvoice(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                        <span className="font-medium text-slate-700">Also book supplier invoice</span>
                      </label>
                      {receiveAutoInvoice && (
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="block">
                            <span className="block text-xs font-medium text-slate-600 mb-1">Invoice amount (VAT incl)</span>
                            <input type="number" min="0" value={receiveInvAmount} onChange={e => setReceiveInvAmount(e.target.value)} className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                          </label>
                          <label className="block">
                            <span className="block text-xs font-medium text-slate-600 mb-1">Invoice date</span>
                            <input type="date" value={receiveInvDate} onChange={e => setReceiveInvDate(e.target.value)}
                              className={`px-3 py-2 border rounded-lg text-sm ${isDateLocked(receiveInvDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                          </label>
                          {isDateLocked(receiveInvDate, booksLockedUntil) && (
                            <p className="text-xs text-red-600">Locked period</p>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => doReceive(selected.id)} disabled={busy || (receiveAutoInvoice && isDateLocked(receiveInvDate, booksLockedUntil))} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">
                          {receiveAutoInvoice ? 'Receive & Invoice' : 'Receive only'}
                        </button>
                        <button onClick={() => setShowReceive(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input value={invSearch} onChange={e => setInvSearch(e.target.value)} placeholder="Search invoices..."
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              <select value={invStatus} onChange={e => setInvStatus(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
              </select>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Supplier invoices</h2></div>
            {loading ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
            ) : invoices.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No supplier invoices yet.</div>
            ) : filteredInvoices.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No invoices match your search.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredInvoices.map(inv => (
                  <div key={inv.id} className="px-6 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{inv.invoiceNumber} · {inv.supplier?.name}</p>
                        <p className="text-sm text-slate-500">{money(inv.amount)} · paid {money(inv.amountPaid)}{inv.date && ` · ${new Date(inv.date).toLocaleDateString()}`}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                        {inv.status !== 'PAID' && canCreate && (
                          <button onClick={() => { setShowPay(inv.id); setPayAmount(String(Number(inv.amount) - Number(inv.amountPaid))) }} className="text-sm text-green-700 font-medium">Pay</button>
                        )}
                      </div>
                    </div>
                    {showPay === inv.id && (
                      <div className="flex flex-wrap items-end gap-2 mt-3">
                        <label className="block">
                          <span className="block text-xs font-medium text-slate-600 mb-1">Amount</span>
                          <input type="number" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                        </label>
                        <label className="block">
                          <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
                          <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                            className={`px-3 py-2 border rounded-lg text-sm ${isDateLocked(payDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                        </label>
                        {isDateLocked(payDate, booksLockedUntil) && (
                          <p className="text-xs text-red-600 w-full">This date is in a locked period.</p>
                        )}
                        <label className="block">
                          <span className="block text-xs font-medium text-slate-600 mb-1">Method</span>
                          <select value={payMethod} onChange={e => { setPayMethod(e.target.value as any); setPayBankAccountId('') }} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                            <option value="Cash">Cash</option>
                            <option value="Bank Transfer">Bank transfer</option>
                          </select>
                        </label>
                        {payMethod === 'Bank Transfer' && (
                          <label className="block">
                            <span className="block text-xs font-medium text-slate-600 mb-1">Bank Account</span>
                            <select value={payBankAccountId} onChange={e => setPayBankAccountId(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                              <option value="">Default (Bank — 1100)</option>
                            </select>
                          </label>
                        )}
                        <button onClick={() => doPay(inv.id)} disabled={busy || isDateLocked(payDate, booksLockedUntil)} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg disabled:opacity-50">Pay</button>
                        <button onClick={() => setShowPay(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        )}

        {activeTab === 'credit-notes' && (
          <div className="space-y-4">
            {showCreditNote && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h2 className="font-semibold text-slate-800">Record Supplier Credit Note</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select value={cnSupplier} onChange={e => { setCnSupplier(e.target.value); setCnPoId('') }}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Select supplier</option>
                    {suppliers.filter(s => s.isActive).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input type="number" min="0" step="any" value={cnAmount} onChange={e => setCnAmount(e.target.value)}
                    placeholder="Credit amount (₦)" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  <input type="date" value={cnDate} onChange={e => setCnDate(e.target.value)}
                    className={`px-3 py-2 border rounded-lg text-sm ${isDateLocked(cnDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                </div>
                {isDateLocked(cnDate, booksLockedUntil) && (
                  <p className="text-xs text-red-600">This date is in a locked period.</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select value={cnPoId} onChange={e => setCnPoId(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Link to PO (optional)</option>
                    {cnSupplierPOs.map(p => (
                      <option key={p.id} value={p.id}>{p.poNumber}</option>
                    ))}
                  </select>
                  <select value={cnMaterialId} onChange={e => { setCnMaterialId(e.target.value); if (!e.target.value) setCnQuantity('') }}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    <option value="">Returned material (optional)</option>
                    {materials.filter(m => m.isActive).map(m => (
                      <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                    ))}
                  </select>
                  {cnMaterialId && (
                    <input type="number" min="0" step="any" value={cnQuantity} onChange={e => setCnQuantity(e.target.value)}
                      placeholder="Quantity returned" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  )}
                </div>
                <input value={cnReason} onChange={e => setCnReason(e.target.value)} placeholder="Reason (e.g., Defective preforms returned)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input value={cnNotes} onChange={e => setCnNotes(e.target.value)} placeholder="Notes (optional)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <div className="flex gap-2">
                  <button onClick={doCreateCreditNote} disabled={busy || isDateLocked(cnDate, booksLockedUntil)} className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg disabled:opacity-50">Save Credit Note</button>
                  <button onClick={() => setShowCreditNote(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Supplier credit notes</h2></div>
              {loading ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
              ) : creditNotes.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">No credit notes yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {creditNotes.map(cn => (
                    <div key={cn.id} className="px-6 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{cn.creditNoteNumber} · {cn.supplier?.name}</p>
                          <p className="text-sm text-slate-500">{money(cn.amount)}{cn.date && ` · ${new Date(cn.date).toLocaleDateString()}`}{cn.po?.poNumber && ` · PO ${cn.po.poNumber}`}{cn.materialId && cn.quantity && (() => { const m = matById(cn.materialId); return m ? ` · ${cn.quantity} ${m.unitOfMeasure} ${m.name}` : ` · ${cn.quantity} pcs` })()}</p>
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
