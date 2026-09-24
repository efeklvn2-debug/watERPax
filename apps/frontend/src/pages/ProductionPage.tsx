import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { productionRunsApi, ProductionRun } from '../api/productionRuns'
import { productsApi, ProductWithVariants } from '../api/products'
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
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

const STATUS_COLORS: Record<string, string> = {
  PLANNED: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800'
}

export function ProductionPage() {
  const notify = useNotification()
  const { booksLockedUntil } = useBooksLocked()
  const [runs, setRuns] = useState<ProductionRun[]>([])
  const [products, setProducts] = useState<ProductWithVariants[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ProductionRun | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [planVariant, setPlanVariant] = useState('')
  const [planPacks, setPlanPacks] = useState('')
  const [planBatch, setPlanBatch] = useState('')
  const [completePacks, setCompletePacks] = useState('')
  const [completeDate, setCompleteDate] = useState(todayLocal())
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  const canPlan = hasPermission('production:plan')
  const canComplete = hasPermission('production:complete')
  const canCancel = hasPermission('production:cancel')

  const load = async () => {
    setLoading(true)
    const res = await productionRunsApi.list(statusFilter || undefined)
    if (res.error) notify.error(res.error.message)
    else setRuns(unwrap<ProductionRun[]>(res) || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    productsApi.list().then(res => {
      if (!res.error) setProducts(unwrap<ProductWithVariants[]>(res) || [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const refreshSelected = async (id: string) => {
    const res = await productionRunsApi.get(id)
    if (!res.error) setSelected(unwrap<ProductionRun>(res) || null)
  }

  const doPlan = async () => {
    if (!planVariant || !planPacks) { notify.error('Choose a variant and packs'); return }
    setBusy(true)
    const res = await productionRunsApi.create({
      variantId: planVariant,
      plannedPacks: Number(planPacks),
      batchNumber: planBatch || undefined
    })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Run planned')
    setShowPlan(false); setPlanVariant(''); setPlanPacks(''); setPlanBatch('')
    load()
  }

  const doStart = async (id: string) => {
    setBusy(true)
    const res = await productionRunsApi.start(id)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Run started — BOM frozen')
    load(); refreshSelected(id)
  }

  const doComplete = async () => {
    if (!selected || !completePacks) return
    if (isDateLocked(completeDate, booksLockedUntil)) { notify.error(`Cannot post to ${completeDate} — period is locked`); return }
    setBusy(true)
    const res = await productionRunsApi.complete(selected.id, { actualPacks: Number(completePacks), date: completeDate })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    const payload: any = unwrap<any>(res)
    notify.success(payload?.alreadyCompleted ? 'Run was already completed' : 'Run completed — FG posted')
    setCompletePacks(''); setCompleteDate(todayLocal())
    load(); refreshSelected(selected.id)
  }

  const doCancel = async (id: string) => {
    if (!window.confirm('Cancel this run?')) return
    setBusy(true)
    const res = await productionRunsApi.cancel(id)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Run cancelled')
    setSelected(null); load()
  }

  const variants = products.flatMap(p => (p.variants || []).filter(v => v.isActive).map(v => ({ ...v, productName: p.name })))
  const filtered = runs.filter(r => {
    const q = search.toLowerCase()
    return !q || r.runNumber.toLowerCase().includes(q) || r.variant?.product?.name?.toLowerCase().includes(q) || r.batchNumber?.toLowerCase().includes(q)
  })

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Production Runs</h1>
            <p className="text-slate-500 mt-1">Produce to stock — forecast driven, no customer orders</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search runs..."
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">All statuses</option>
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            {canPlan && (
              <button onClick={() => setShowPlan(true)} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                + Plan run
              </button>
            )}
          </div>
        </div>

        {showPlan && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Plan production run</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Variant</span>
                <select value={planVariant} onChange={e => setPlanVariant(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="">Select variant...</option>
                  {variants.map(v => <option key={v.id} value={v.id}>{v.productName} — {v.label} (×{v.packSize})</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Planned packs</span>
                <input type="number" min="1" value={planPacks} onChange={e => setPlanPacks(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. 500" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Batch (optional)</span>
                <input value={planBatch} onChange={e => setPlanBatch(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="auto = run number" />
              </label>
              <div className="flex items-end gap-2">
                <button onClick={doPlan} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Save</button>
                <button onClick={() => setShowPlan(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">Runs {statusFilter && `— ${statusFilter}`}</h2>
            </div>
            {loading ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading...</div>
            ) : runs.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No runs yet — plan the first one.</div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No runs match your search.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map(r => (
                  <div key={r.id} className={`px-6 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer ${selected?.id === r.id ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelected(r)}>
                    <div>
                      <p className="font-medium text-slate-900">{r.runNumber} · {r.variant?.product?.name} {r.variant?.label}</p>
                      <p className="text-sm text-slate-500">
                        {r.plannedPacks} planned{r.actualPacks != null && ` · ${r.actualPacks} actual`} · Batch {r.batchNumber} · {fmtDate((r as any).completedAt || (r as any).startedAt || (r as any).createdAt)}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-slate-100'}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            {!selected ? (
              <p className="text-sm text-slate-400 text-center py-8">Select a run to see detail and actions.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">{selected.runNumber}</h3>
                    <p className="text-sm text-slate-500">{selected.variant?.product?.name} — {selected.variant?.label} (×{selected.variant?.packSize})</p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{selected.status.replace('_', ' ')}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Planned</span><strong>{selected.plannedPacks}</strong></div>
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Actual</span><strong>{selected.actualPacks ?? '—'}</strong></div>
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Batch</span><strong>{selected.batchNumber}</strong></div>
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Material cost</span><strong>{selected.totalMaterialCost != null ? money(selected.totalMaterialCost) : '—'}</strong></div>
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Created</span><strong>{fmtDate((selected as any).createdAt)}</strong></div>
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Started</span><strong>{fmtDate(selected.startedAt)}</strong></div>
                  <div className="border-b border-slate-100 py-1.5 flex justify-between"><span className="text-slate-500">Completed</span><strong>{fmtDate(selected.completedAt)}</strong></div>
                </div>

                {selected.usages && selected.usages.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Component usage</p>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-slate-400"><th>Material</th><th className="text-right">Planned</th><th className="text-right">Actual</th><th className="text-right">Waste</th></tr></thead>
                      <tbody className="divide-y divide-slate-50">
                        {selected.usages.map(u => (
                          <tr key={u.id}>
                            <td className="py-1">{u.material?.code}</td>
                            <td className="py-1 text-right">{u.plannedQty}</td>
                            <td className="py-1 text-right">{u.actualQty}</td>
                            <td className="py-1 text-right">{u.wasteQty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {selected.status === 'PLANNED' && canPlan && (
                    <button onClick={() => doStart(selected.id)} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Start run</button>
                  )}
                  {selected.status === 'IN_PROGRESS' && canComplete && (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                          <span className="block text-xs font-medium text-slate-600 mb-1">Actual packs</span>
                          <input type="number" min="1" value={completePacks} onChange={e => setCompletePacks(e.target.value)}
                            placeholder="e.g. 500" className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                        </label>
                        <label className="block">
                          <span className="block text-xs font-medium text-slate-600 mb-1">Completion date</span>
                          <input type="date" value={completeDate} onChange={e => setCompleteDate(e.target.value)}
                            className={`w-40 px-3 py-2 border rounded-lg text-sm ${isDateLocked(completeDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
                        </label>
                        <button onClick={doComplete} disabled={busy || isDateLocked(completeDate, booksLockedUntil)} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">Complete</button>
                      </div>
                      {isDateLocked(completeDate, booksLockedUntil) && (
                        <p className="text-xs text-red-600">Locked period</p>
                      )}
                    </div>
                  )}
                  {(selected.status === 'PLANNED' || selected.status === 'IN_PROGRESS') && canCancel && (
                    <button onClick={() => doCancel(selected.id)} disabled={busy} className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">Cancel</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
