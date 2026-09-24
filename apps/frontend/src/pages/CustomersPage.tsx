import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { customersApi, Customer, CustomerBalance } from '../api/customers'
import { hasPermission } from '../stores/authStore'

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data
  return value?.data ?? value
}

export function CustomersPage() {
  const notify = useNotification()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [balances, setBalances] = useState<Map<string, CustomerBalance>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT'>('CASH')
  const [discountPercent, setDiscountPercent] = useState('')
  const [busy, setBusy] = useState(false)

  const canWrite = hasPermission('customer:create') || hasPermission('customer:edit')

  const load = async () => {
    setLoading(true)
    const [custRes, balRes] = await Promise.all([customersApi.list(), customersApi.allBalances()])
    if (custRes.error) notify.error(custRes.error.message)
    else setCustomers(unwrap<Customer[]>(custRes) || [])
    if (!balRes.error) {
      const data = unwrap<CustomerBalance[]>(balRes) || []
      setBalances(new Map(data.map(b => [b.customerId, b])))
    }
    setLoading(false)
  }

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => {
    setEditing(null); setName(''); setPhone(''); setAddress(''); setPaymentType('CASH'); setDiscountPercent('')
    setShowForm(true)
  }

  const openEdit = (c: Customer) => {
    setEditing(c); setName(c.name); setPhone(c.phone || ''); setAddress(c.address || '')
    setPaymentType(c.paymentType || 'CASH'); setDiscountPercent(c.discountPercent ? String(c.discountPercent) : '')
    setShowForm(true)
  }

  const save = async () => {
    if (!name.trim()) { notify.error('Name is required'); return }
    setBusy(true)
    const data: any = { name, phone, address, paymentType }
    if (discountPercent !== '') data.discountPercent = Number(discountPercent)
    const res = editing
      ? await customersApi.update(editing.id, data)
      : await customersApi.create(data)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success(editing ? 'Customer updated' : 'Customer created')
    setShowForm(false); load()
  }

  const filtered = customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
            <p className="text-slate-500 mt-1">Retailers, distributors and walk-in buyers</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            {canWrite && (
              <button onClick={openCreate} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">+ Customer</button>
            )}
          </div>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 mb-3">{editing ? 'Edit customer' : 'New customer'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Address" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <select value={paymentType} onChange={e => setPaymentType(e.target.value as any)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="CASH">Cash</option>
                <option value="CREDIT">Credit</option>
              </select>
              <div className="flex items-center gap-1">
                <input type="number" min="0" max="100" step="0.5" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <span className="text-sm text-slate-500 whitespace-nowrap">% discount</span>
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Save</button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {loading ? (
            <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-400 text-sm">No customers yet.</div>
          ) : (
            <>
              <div className="hidden lg:grid grid-cols-12 gap-2 px-6 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <span className="col-span-3">Customer</span>
                <span className="col-span-2 text-right">Invoiced</span>
                <span className="col-span-2 text-right">Balance due</span>
                <span className="col-span-2 text-right">Deposit held</span>
                <span className="col-span-1 text-right">Jars</span>
                <span className="col-span-2"></span>
              </div>
              <div className="divide-y divide-slate-100">
                {filtered.map(c => {
                  const b = balances.get(c.id)
                  return (
                    <div key={c.id} className="px-6 py-3 grid grid-cols-12 gap-2 items-center hover:bg-slate-50">
                      <div className="col-span-3 min-w-0">
                        <Link to={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-blue-700 truncate block">{c.name}</Link>
                        <p className="text-sm text-slate-500 truncate">{c.phone || ''}</p>
                      </div>
                      <div className="col-span-2 text-right text-sm text-slate-700 font-mono">
                        {b ? `₦${b.totalInvoiced.toLocaleString()}` : '—'}
                      </div>
                      <div className="col-span-2 text-right text-sm font-mono">
                        {b ? <span className={b.balanceDue > 0 ? 'text-red-600 font-medium' : 'text-slate-700'}>₦{b.balanceDue.toLocaleString()}</span> : '—'}
                      </div>
                      <div className="col-span-2 text-right text-sm text-blue-700 font-mono">
                        {b ? `₦${b.depositHeld.toLocaleString()}` : '—'}
                      </div>
                      <div className="col-span-1 text-right text-sm font-mono">
                        {b ? <span className={b.jarBalance < 0 ? 'text-amber-600' : b.jarBalance > 0 ? 'text-emerald-600' : 'text-slate-700'}>{b.jarBalance}</span> : '—'}
                      </div>
                      <div className="col-span-2 text-right">
                        {canWrite && (
                          <button onClick={() => openEdit(c)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}
