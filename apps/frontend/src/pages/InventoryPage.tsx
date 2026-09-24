import { useEffect, useState, useMemo } from 'react'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { inventoryApi, MaterialWithStock } from '../api/inventory'
import { reportsApi } from '../api/reports'
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
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

interface FgRow {
  variant: string
  product: string
  category: string
  batchNumber: string
  location: string
  packs: number
  unitCost: number
  value: number
}

interface FgGroupedVariant {
  variantId: string
  variant: string
  packSize: number
  packs: number
  unitCost: number
  value: number
  batches: FgRow[]
}

interface FgGroupedProduct {
  productId: string
  product: string
  category: string
  variants: FgGroupedVariant[]
}

type FgViewMode = 'grouped' | 'batches'
type TabType = 'raw' | 'fg'

const CATEGORY_COLORS: Record<string, string> = {
  BOTTLED: 'bg-blue-100 text-blue-700',
  SACHET: 'bg-emerald-100 text-emerald-700',
  JAR: 'bg-amber-100 text-amber-700'
}

const ADJUSTMENT_REASONS = [
  'Opening Balance',
  'Physical Count Variance',
  'Damaged Goods',
  'Theft/Loss',
  'Internal Use',
  'Return to Supplier',
  'Audit Adjustment',
  'Other'
]

export function InventoryPage() {
  const notify = useNotification()
  const { booksLockedUntil } = useBooksLocked()
  const [activeTab, setActiveTab] = useState<TabType>('raw')
  const [materials, setMaterials] = useState<MaterialWithStock[]>([])
  const [fgRows, setFgRows] = useState<FgRow[]>([])
  const [fgGrouped, setFgGrouped] = useState<FgGroupedProduct[]>([])
  const [fgValue, setFgValue] = useState(0)
  const [fgTotalPacks, setFgTotalPacks] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [adjustMaterial, setAdjustMaterial] = useState<MaterialWithStock | null>(null)
  const [adjustValue, setAdjustValue] = useState('')
  const [adjustReason, setAdjustReason] = useState('Physical Count Variance')
  const [adjustDate, setAdjustDate] = useState(todayLocal())
  const [busy, setBusy] = useState(false)

  const [fgViewMode, setFgViewMode] = useState<FgViewMode>('grouped')
  const [fgCategory, setFgCategory] = useState('')
  const [fgProductId, setFgProductId] = useState('')
  const [fgVariantId, setFgVariantId] = useState('')
  const [expandedVariant, setExpandedVariant] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductWithVariants[]>([])

  const canAdjust = hasPermission('inventory:adjust')

  const loadProducts = async () => {
    const res = await productsApi.list()
    if (!res.error) setProducts(unwrap<ProductWithVariants[]>(res) || [])
  }

  const load = async () => {
    setLoading(true)
    if (activeTab === 'raw') {
      const res = await inventoryApi.getMaterials()
      if (res.error) notify.error(res.error.message)
      else setMaterials(unwrap<MaterialWithStock[]>(res) || [])
    } else if (fgViewMode === 'grouped') {
      const res = await reportsApi.getWaterReport('fg-grouped', undefined, undefined, {
        category: fgCategory || undefined,
        productId: fgProductId || undefined,
        variantId: fgVariantId || undefined
      })
      if (res.error) notify.error(res.error.message)
      else {
        const payload: any = unwrap<any>(res)
        setFgGrouped(payload?.rows || [])
        setFgValue(Number(payload?.totals?.value || 0))
        setFgTotalPacks(Number(payload?.totals?.packs || 0))
      }
    } else {
      const res = await reportsApi.getWaterReport('fg-valuation')
      if (res.error) notify.error(res.error.message)
      else {
        const payload: any = unwrap<any>(res)
        setFgRows(payload?.rows || [])
        setFgValue(Number(payload?.totals?.value || 0))
        setFgTotalPacks(Number(payload?.totals?.packs || 0))
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fgViewMode, fgCategory, fgProductId, fgVariantId])

  useEffect(() => {
    if (activeTab === 'fg') loadProducts()
  }, [activeTab])

  const doAdjust = async () => {
    if (!adjustMaterial || adjustValue === '') return
    if (isDateLocked(adjustDate, booksLockedUntil)) { notify.error(`Cannot post to ${adjustDate} — period is locked`); return }
    setBusy(true)
    const res = await inventoryApi.adjustStock(adjustMaterial.id, Number(adjustValue), adjustReason, adjustDate)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Stock adjusted')
    setAdjustMaterial(null); setAdjustValue(''); setAdjustDate(todayLocal())
    load()
  }

  const filtered = materials.filter(m =>
    !search ||
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.code.toLowerCase().includes(search.toLowerCase())
  )
  const rawMats = filtered.filter(m => m.category === 'RAW_MATERIAL')
  const packMats = filtered.filter(m => m.category === 'PACKAGING')
  const otherMats = filtered.filter(m => m.category !== 'RAW_MATERIAL' && m.category !== 'PACKAGING')

  const filteredFg = fgRows.filter(r => {
    const q = search.toLowerCase()
    return !q || r.product?.toLowerCase().includes(q) || r.variant?.toLowerCase().includes(q) || r.batchNumber?.toLowerCase().includes(q)
  })

  const filteredProducts = useMemo(() => {
    if (!fgCategory) return products
    return products.filter(p => p.category === fgCategory)
  }, [products, fgCategory])

  const filteredVariants = useMemo(() => {
    const src = fgProductId ? products.filter(p => p.id === fgProductId) : filteredProducts
    return src.flatMap(p => p.variants.map(v => ({ ...v, productName: p.name })))
  }, [products, fgProductId, filteredProducts])

  const resetFilters = () => {
    setFgCategory('')
    setFgProductId('')
    setFgVariantId('')
    setSearch('')
    setExpandedVariant(null)
  }

  const renderTable = (title: string, rows: MaterialWithStock[]) => (
    rows.length > 0 && (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
        <div className="px-6 py-3 border-b border-slate-100"><h2 className="font-semibold text-slate-800 text-sm">{title}</h2></div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400">
            <th className="px-6 py-2">Code</th><th className="px-6 py-2">Material</th>
            <th className="px-6 py-2 text-right">Stock</th><th className="px-6 py-2 text-right">Min</th>
            <th className="px-6 py-2 text-right">Cost</th><th className="px-6 py-2 text-right">Created</th><th className="px-6 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(m => {
              const stock = m.totalStock ?? 0
              const low = stock <= (m.minStock || 0)
              return (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-6 py-2 font-mono text-xs">{m.code}</td>
                  <td className="px-6 py-2 font-medium text-slate-800">{m.name}
                    <span className="text-slate-400 text-xs ml-2">{m.unitOfMeasure}</span></td>
                  <td className={`px-6 py-2 text-right font-medium ${low ? 'text-red-600' : ''}`}>{stock.toLocaleString()}</td>
                  <td className="px-6 py-2 text-right text-slate-500">{m.minStock}</td>
                  <td className="px-6 py-2 text-right text-slate-500">{m.costPrice != null ? money(Number(m.costPrice)) : '—'}</td>
                  <td className="px-6 py-2 text-right text-slate-400 text-xs">{fmtDate((m as any).createdAt)}</td>
                  <td className="px-6 py-2 text-right">
                    {canAdjust && (
                      <button onClick={() => { setAdjustMaterial(m); setAdjustValue(String(stock)); }} className="text-xs text-blue-600 font-medium">Adjust</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  )

  const renderFgGrouped = () => {
    const defectivePacks = fgGrouped.flatMap(g => g.variants).flatMap((v: any) => v.batches).filter((b: any) => b.location === 'FG_DEFECTIVE').reduce((s: number, b: any) => s + b.packs, 0)
    const defectiveValue = fgGrouped.flatMap(g => g.variants).flatMap((v: any) => v.batches).filter((b: any) => b.location === 'FG_DEFECTIVE').reduce((s: number, b: any) => s + b.value, 0)
    return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-slate-800 text-sm">Finished Goods Store</h2>
          {defectivePacks > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">{defectivePacks.toLocaleString()} defective ({money(defectiveValue)})</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{fgTotalPacks.toLocaleString()} packs</span>
          <span className="text-sm font-medium text-blue-700">{money(fgValue)}</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <select value={fgCategory} onChange={e => { setFgCategory(e.target.value); setFgProductId(''); setFgVariantId('') }}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="">All categories</option>
          <option value="BOTTLED">Bottled</option>
          <option value="SACHET">Sachet</option>
          <option value="JAR">Jar</option>
        </select>
        <select value={fgProductId} onChange={e => { setFgProductId(e.target.value); setFgVariantId('') }}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="">All products</option>
          {filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={fgVariantId} onChange={e => setFgVariantId(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white">
          <option value="">All variants</option>
          {filteredVariants.map(v => <option key={v.id} value={v.id}>{v.productName} — {v.label}</option>)}
        </select>
        {(fgCategory || fgProductId || fgVariantId) && (
          <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-slate-700 underline">Clear filters</button>
        )}
        <div className="ml-auto flex rounded-lg border border-slate-300 overflow-hidden text-xs">
          <button onClick={() => setFgViewMode('grouped')} className={`px-3 py-1.5 font-medium ${fgViewMode === 'grouped' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Grouped</button>
          <button onClick={() => setFgViewMode('batches')} className={`px-3 py-1.5 font-medium ${fgViewMode === 'batches' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Batches</button>
        </div>
      </div>

      {fgGrouped.length === 0 ? (
        <div className="px-6 py-8 text-center text-slate-400 text-sm">No finished stock — complete a production run.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {fgGrouped.map(group => (
            <div key={group.productId}>
              {/* Product header */}
              <div className="px-6 py-2.5 bg-slate-50 flex items-center gap-3">
                <span className="font-semibold text-slate-800 text-sm">{group.product}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[group.category] || 'bg-slate-100 text-slate-600'}`}>
                  {group.category}
                </span>
                <span className="text-xs text-slate-400 ml-auto">
                  {group.variants.reduce((s, v) => s + v.packs, 0).toLocaleString()} packs
                </span>
              </div>
              {/* Variant rows */}
              {group.variants.map(v => {
                const isExpanded = expandedVariant === v.variantId
                const isZero = v.packs === 0
                return (
                  <div key={v.variantId}>
                    <div
                      className={`px-6 py-2 flex items-center gap-4 cursor-pointer hover:bg-slate-50 ${isZero ? 'opacity-50' : ''}`}
                      onClick={() => setExpandedVariant(isExpanded ? null : v.variantId)}
                    >
                      <span className={`w-5 text-xs text-slate-400 ${isExpanded ? 'rotate-90' : ''} transition-transform`}>▶</span>
                      <span className="font-medium text-slate-800 text-sm w-48">{v.variant}</span>
                      <span className="text-xs text-slate-400 w-20">x{v.packSize}</span>
                      <span className={`text-right flex-1 font-medium text-sm ${isZero ? 'text-slate-300' : 'text-slate-800'}`}>
                        {v.packs.toLocaleString()}
                      </span>
                      <span className="text-right w-28 text-sm text-slate-500">{isZero ? '—' : money(v.unitCost)}</span>
                      <span className={`text-right w-28 font-medium text-sm ${isZero ? 'text-slate-300' : 'text-slate-800'}`}>
                        {isZero ? '—' : money(v.value)}
                      </span>
                    </div>
                    {/* Batch sub-table */}
                    {isExpanded && v.batches.length > 0 && (
                      <div className="bg-slate-50 border-t border-slate-100">
                        <table className="w-full text-xs">
                          <thead><tr className="text-left text-slate-400">
                            <th className="px-6 pl-12 py-1.5">Batch</th>
                            <th className="px-6 py-1.5">Location</th>
                            <th className="px-6 py-1.5 text-right">Packs</th>
                            <th className="px-6 py-1.5 text-right">Unit cost</th>
                            <th className="px-6 py-1.5 text-right">Value</th>
                          </tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {v.batches.map((b, i) => (
                              <tr key={i} className={`hover:bg-white ${b.location === 'FG_DEFECTIVE' ? 'bg-red-50' : ''}`}>
                                <td className="px-6 pl-12 py-1.5 font-mono">{b.batchNumber}</td>
                                <td className="px-6 py-1.5">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${b.location === 'FG_DEFECTIVE' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{b.location}</span>
                                </td>
                                <td className="px-6 py-1.5 text-right">{b.packs.toLocaleString()}</td>
                                <td className="px-6 py-1.5 text-right text-slate-500">{money(b.unitCost)}</td>
                                <td className="px-6 py-1.5 text-right font-medium">{money(b.value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {isExpanded && v.batches.length === 0 && (
                      <div className="bg-slate-50 border-t border-slate-100 px-6 pl-12 py-2 text-xs text-slate-400">
                        No batches in stock
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
  }

  const renderFgBatches = () => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm">Finished packs at FG_STORE</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{fgTotalPacks.toLocaleString()} packs</span>
          <span className="text-sm font-medium text-blue-700">{money(fgValue)}</span>
        </div>
      </div>
      <div className="px-6 py-2 border-b border-slate-100 flex justify-end">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
          <button onClick={() => setFgViewMode('grouped')} className={`px-3 py-1.5 font-medium ${fgViewMode === 'grouped' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Grouped</button>
          <button onClick={() => setFgViewMode('batches')} className={`px-3 py-1.5 font-medium ${fgViewMode === 'batches' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Batches</button>
        </div>
      </div>
      {fgRows.length === 0 ? (
        <div className="px-6 py-8 text-center text-slate-400 text-sm">No finished stock — complete a production run.</div>
      ) : filteredFg.length === 0 ? (
        <div className="px-6 py-8 text-center text-slate-400 text-sm">No FG matches your search.</div>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400">
            <th className="px-6 py-2">Product</th><th className="px-6 py-2">Variant</th><th className="px-6 py-2">Batch</th><th className="px-6 py-2">Location</th>
            <th className="px-6 py-2 text-right">Packs</th><th className="px-6 py-2 text-right">Unit cost</th>
            <th className="px-6 py-2 text-right">Value</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {filteredFg.map((r, i) => (
              <tr key={i} className={`hover:bg-slate-50 ${r.location === 'FG_DEFECTIVE' ? 'bg-red-50' : ''}`}>
                <td className="px-6 py-2 font-medium text-slate-800">{r.product}</td>
                <td className="px-6 py-2 text-slate-600">{r.variant}</td>
                <td className="px-6 py-2 font-mono text-xs">{r.batchNumber}</td>
                <td className="px-6 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.location === 'FG_DEFECTIVE' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.location}</span></td>
                <td className="px-6 py-2 text-right">{r.packs.toLocaleString()}</td>
                <td className="px-6 py-2 text-right text-slate-500">{money(r.unitCost)}</td>
                <td className="px-6 py-2 text-right font-medium">{money(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
            <p className="text-slate-500 mt-1">Raw lots, packaging and finished packs</p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'raw' && (
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search materials..."
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            )}
            {activeTab === 'fg' && fgViewMode === 'batches' && (
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search FG..."
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            )}
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
              <button onClick={() => setActiveTab('raw')} className={`px-4 py-2 font-medium ${activeTab === 'raw' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>Raw & Packaging</button>
              <button onClick={() => setActiveTab('fg')} className={`px-4 py-2 font-medium ${activeTab === 'fg' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>FG Store</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 text-sm py-8">Loading...</div>
        ) : activeTab === 'raw' ? (
          <div>
            {renderTable('Raw materials (preforms, caps, labels, nylon, jars)', rawMats)}
            {renderTable('Packaging (shrink-wrap, packing bags)', packMats)}
            {renderTable('Other', otherMats)}
            {filtered.length === 0 && <div className="text-center text-slate-400 text-sm py-8">No materials found.</div>}
          </div>
        ) : fgViewMode === 'grouped' ? (
          renderFgGrouped()
        ) : (
          renderFgBatches()
        )}

        {adjustMaterial && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm">
              <h3 className="font-bold text-slate-900 mb-1">Adjust stock</h3>
              <p className="text-sm text-slate-500 mb-4">{adjustMaterial.code} — {adjustMaterial.name}</p>
              <label className="block mb-3">
                <span className="block text-xs font-medium text-slate-600 mb-1">New quantity ({adjustMaterial.unitOfMeasure})</span>
                <input type="number" min="0" step="any" value={adjustValue} onChange={e => setAdjustValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </label>
              <label className="block mb-4">
                <span className="block text-xs font-medium text-slate-600 mb-1">Reason (posted to audit + GL)</span>
                <select value={adjustReason} onChange={e => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  {ADJUSTMENT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block mb-4">
                <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
                <input type="date" value={adjustDate} onChange={e => setAdjustDate(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${isDateLocked(adjustDate, booksLockedUntil) ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
              </label>
              {isDateLocked(adjustDate, booksLockedUntil) && (
                <p className="text-xs text-red-600 mb-3">This date is in a locked period.</p>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAdjustMaterial(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button onClick={doAdjust} disabled={busy || isDateLocked(adjustDate, booksLockedUntil)} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
