import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { customersApi, Customer, CustomerBalance } from '../api/customers'
import { hasPermission } from '../stores/authStore'

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data
  return value?.data ?? value
}

function money(value: number | undefined | null) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function CustomerDetailPage() {
  const { customerId } = useParams()
  const notify = useNotification()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [balance, setBalance] = useState<CustomerBalance | null>(null)
  const [txns, setTxns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [jarReturnQty, setJarReturnQty] = useState('')
  const [jarReturnNotes, setJarReturnNotes] = useState('')
  const [jarReturnLoading, setJarReturnLoading] = useState(false)
  const canCreateSale = hasPermission('sales:create')

  const refresh = () => {
    if (!customerId) return
    Promise.all([customersApi.get(customerId), customersApi.balance(customerId), customersApi.transactions(customerId)])
      .then(([cRes, bRes, tRes]) => {
        if (cRes.error) notify.error(cRes.error.message)
        else setCustomer(unwrap<Customer>(cRes) || null)
        if (!bRes.error) setBalance(unwrap<CustomerBalance>(bRes) || null)
        if (!tRes.error) setTxns(unwrap<any[]>(tRes) || [])
        setLoading(false)
      })
  }

  useEffect(() => { refresh() }, [customerId])

  const handleJarReturn = async () => {
    const qty = parseInt(jarReturnQty, 10)
    if (!qty || qty < 1) return notify.error('Enter a valid quantity')
    setJarReturnLoading(true)
    const res = await customersApi.recordJarReturn(customerId!, { quantity: qty, notes: jarReturnNotes || undefined })
    setJarReturnLoading(false)
    if (res.error) return notify.error(res.error.message)
    notify.success(`${qty} empty jar(s) returned`)
    setJarReturnQty('')
    setJarReturnNotes('')
    refresh()
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl">
        <Link to="/customers" className="text-sm text-blue-600 hover:text-blue-800">← Customers</Link>
        {loading ? (
          <div className="text-center text-slate-400 text-sm py-8">Loading...</div>
        ) : !customer ? (
          <div className="text-center text-slate-400 text-sm py-8">Customer not found.</div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">{customer.name}</h1>
                  <p className="text-slate-500 text-sm mt-1">{customer.phone || ''}{customer.address ? ` · ${customer.address}` : ''}</p>
                </div>
                {canCreateSale && (
                  <Link to={`/sales?new=1&customerId=${customer.id}`}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap">
                    + New sale
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-5 gap-4 mt-4">
                <div><p className="text-xs text-slate-500">Total invoiced</p><p className="font-bold">{money(balance?.totalInvoiced)}</p></div>
                <div><p className="text-xs text-slate-500">Total paid</p><p className="font-bold text-green-700">{money(balance?.totalPaid)}</p></div>
                <div><p className="text-xs text-slate-500">Balance due</p><p className={`font-bold ${(balance?.balanceDue || 0) > 0 ? 'text-red-700' : ''}`}>{money(balance?.balanceDue)}</p></div>
                <div><p className="text-xs text-slate-500">Deposit held</p><p className="font-bold text-blue-700">{money(balance?.depositHeld)}</p></div>
                <div><p className="text-xs text-slate-500">Empty jars</p><p className="font-bold text-emerald-700">{balance?.jarBalance ?? 0}</p></div>
              </div>
              <div className="mt-4 flex items-center gap-2 pt-4 border-t border-slate-100">
                <span className="text-xs text-slate-500 font-medium">Record jar return</span>
                <input type="number" min="1" value={jarReturnQty} onChange={e => setJarReturnQty(e.target.value)}
                  placeholder="qty" className="w-16 px-2 py-1 border border-slate-300 rounded text-sm" />
                <input type="text" value={jarReturnNotes} onChange={e => setJarReturnNotes(e.target.value)}
                  placeholder="notes (optional)" className="w-40 px-2 py-1 border border-slate-300 rounded text-sm" />
                <button onClick={handleJarReturn} disabled={jarReturnLoading || !jarReturnQty}
                  className="px-3 py-1 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50">
                  {jarReturnLoading ? 'Saving...' : 'Add'}
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-900">Payments</h2></div>
              {txns.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">No payments yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {txns.slice(0, 30).map((t: any) => (
                    <div key={t.id} className="px-6 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{money(t.amount)}</p>
                        <p className="text-xs text-slate-500">{t.paymentMethod} · {t.receivedAt ? new Date(t.receivedAt).toLocaleDateString() : ''}{t.referenceNumber ? ` · ${t.referenceNumber}` : ''}</p>
                      </div>
                      {t.receipts?.[0] && <span className="text-xs text-slate-400">{t.receipts[0].receiptNumber}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
