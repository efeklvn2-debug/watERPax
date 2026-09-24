import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { productsApi, ProductWithVariants, ProductVariant, BOMLine } from '../api/products'
import { inventoryApi, MaterialWithStock } from '../api/inventory'
import { hasPermission } from '../stores/authStore'

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data
  return value?.data ?? value
}

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

const CATEGORIES = ['BOTTLED', 'SACHET', 'JAR'] as const

export function ProductsPage() {
  const notify = useNotification()
  const [products, setProducts] = useState<ProductWithVariants[]>([])
  const [materials, setMaterials] = useState<MaterialWithStock[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVariant, setSelectedVariant] = useState<(ProductVariant & { productName: string; category?: string }) | null>(null)
  const [bom, setBom] = useState<BOMLine[]>([])
  const [showProduct, setShowProduct] = useState(false)
  const [pName, setPName] = useState('')
  const [pCategory, setPCategory] = useState<string>('BOTTLED')
  const [addingVariantFor, setAddingVariantFor] = useState<string | null>(null)
  const [vLabel, setVLabel] = useState('')
  const [vPackSize, setVPackSize] = useState('')
  const [vPrice, setVPrice] = useState('')
  const [bomDraft, setBomDraft] = useState<{ materialId: string; qtyPerPack: string; wastagePct: string }[]>([])
  const [refillDraft, setRefillDraft] = useState('')
  const [jarMaterialDraft, setJarMaterialDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [priceDraft, setPriceDraft] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState<(ProductVariant & { productName: string }) | null>(null)
  const [saving, setSaving] = useState(false)

  const canWrite = hasPermission('product:write')

  const load = async (includeInactive?: boolean) => {
    setLoading(true)
    const res = await productsApi.list(includeInactive !== undefined ? includeInactive : showArchived)
    if (res.error) notify.error(res.error.message)
    else setProducts(unwrap<ProductWithVariants[]>(res) || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    inventoryApi.getMaterials().then(res => {
      if (!res.error) setMaterials(unwrap<MaterialWithStock[]>(res) || [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openBom = async (productName: string, v: ProductVariant, lines: BOMLine[], category?: string) => {
    setSelectedVariant({ ...v, productName, category })
    setBom(lines)
    setBomDraft(lines.map(l => ({ materialId: l.componentMaterialId, qtyPerPack: String(l.qtyPerPack), wastagePct: String(l.wastagePct) })))
    setPriceDraft(String(v.pricePerUnit))
    setRefillDraft(v.refillPrice != null ? String(v.refillPrice) : '')
    setJarMaterialDraft(v.jarMaterialId || '')
  }

  const doCreateProduct = async () => {
    if (!pName) { notify.error('Product name is required'); return }
    setBusy(true)
    const res = await productsApi.create({ code: pName.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 20), name: pName, category: pCategory as any })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Product created')
    setShowProduct(false); setPName('')
    load()
  }

  const doCreateVariant = async (productId: string) => {
    if (!vLabel || !vPackSize || !vPrice) { notify.error('All fields are required'); return }
    setBusy(true)
    const res = await productsApi.createVariant(productId, {
      label: vLabel, packSize: Number(vPackSize), pricePerUnit: Number(vPrice)
    })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Variant added')
    setAddingVariantFor(null); setVLabel(''); setVPackSize(''); setVPrice('')
    load()
  }

  const doSaveBom = async () => {
    if (!selectedVariant) return
    const lines = bomDraft
      .filter(d => d.materialId && Number(d.qtyPerPack) > 0)
      .map(d => ({ materialId: d.materialId, qtyPerPack: Number(d.qtyPerPack), wastagePct: Number(d.wastagePct) || 0 }))
    setBusy(true)
    const res = await productsApi.replaceBom(selectedVariant.id, lines)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('BOM saved')
    setBom(unwrap<BOMLine[]>(res) || [])
    setSelectedVariant(null)
    load()
  }

  const doSaveRefillPrice = async () => {
    if (!selectedVariant) return
    const val = refillDraft === '' ? null : Number(refillDraft)
    setBusy(true)
    const res = await productsApi.updateVariant(selectedVariant.id, { refillPrice: val } as any)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Refill price saved')
    load()
  }

  const doSaveVariantPrice = async () => {
    if (!selectedVariant) return
    const val = Number(priceDraft)
    if (isNaN(val) || val < 0) { notify.error('Enter a valid price'); return }
    setBusy(true)
    const res = await productsApi.updateVariant(selectedVariant.id, { pricePerUnit: val })
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Price updated')
    load()
  }

  const doSaveJarMaterial = async () => {
    if (!selectedVariant) return
    setBusy(true)
    const res = await productsApi.updateVariant(selectedVariant.id, { jarMaterialId: jarMaterialDraft || null } as any)
    setBusy(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success('Jar material linked')
    load()
  }

  const doArchiveVariant = async () => {
    if (!archiveConfirm) return
    setSaving(true)
    const res = await productsApi.updateVariant(archiveConfirm.id, { isActive: false })
    setSaving(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success(`${archiveConfirm.label} archived`)
    setArchiveConfirm(null)
    load()
  }

  const doRestoreVariant = async (v: ProductVariant & { productName: string }) => {
    setSaving(true)
    const res = await productsApi.updateVariant(v.id, { isActive: true })
    setSaving(false)
    if (res.error) { notify.error(res.error.message); return }
    notify.success(`${v.label} restored`)
    load()
  }

  const categoryColor = (c: string) => {
    if (c === 'BOTTLED') return 'bg-blue-100 text-blue-700'
    if (c === 'SACHET') return 'bg-emerald-100 text-emerald-700'
    return 'bg-amber-100 text-amber-700'
  }

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    const matchesCat = !catFilter || p.category === catFilter
    return matchesSearch && matchesCat
  })

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Products</h1>
            <p className="text-slate-500 mt-1">Catalog, variants and bills of materials</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..."
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
              <button onClick={() => setCatFilter('')} className={`px-3 py-2 font-medium ${catFilter === '' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>All</button>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setCatFilter(c)} className={`px-3 py-2 font-medium ${catFilter === c ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>{c.charAt(0) + c.slice(1).toLowerCase()}</button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={showArchived}
                onChange={() => { const next = !showArchived; setShowArchived(next); load(next) }}
                className="rounded border-slate-300" />
              Show archived
            </label>
            {canWrite && (
              <button onClick={() => setShowProduct(!showProduct)} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                {showProduct ? 'Close' : '+ Product'}
              </button>
            )}
          </div>
        </div>

        {showProduct && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 mb-3">New product line</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input value={pName} onChange={e => setPName(e.target.value)} placeholder="Product name" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <select value={pCategory} onChange={e => setPCategory(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={doCreateProduct} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Save</button>
                <button onClick={() => setShowProduct(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-slate-400 text-sm py-8">Loading catalog...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 space-y-4">
              {filtered.map(p => (
                <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-200">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-slate-900">{p.name}</h2>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${categoryColor(p.category)}`}>{p.category}</span>
                    </div>
                    {canWrite && (
                      <button onClick={() => { setAddingVariantFor(addingVariantFor === p.id ? null : p.id); setVLabel(''); setVPackSize(''); setVPrice('') }}
                        className="text-xs text-blue-600 font-medium hover:text-blue-800">
                        {addingVariantFor === p.id ? 'Close' : '+ Variant'}
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-slate-50">
                    {(p.variants || []).map(v => (
                      <div key={v.id}
                        className={`px-5 py-2.5 flex items-center justify-between hover:bg-slate-50 cursor-pointer ${selectedVariant?.id === v.id ? 'bg-blue-50' : ''} ${!v.isActive ? 'opacity-50' : ''}`}
                        onClick={() => { if (v.isActive) openBom(p.name, v, v.boms || [], p.category) }}>
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-slate-800 text-sm">{v.label}</span>
                          <span className="text-[11px] text-slate-500">×{v.packSize}</span>
                          <span className="text-[11px] font-medium text-slate-700">{money(v.pricePerUnit)}</span>
                          {v.refillPrice != null && v.refillPrice > 0 && <span className="text-[11px] text-emerald-600">Refill {money(v.refillPrice)}</span>}
                          {v.jarMaterialId && <span className="text-[11px] text-amber-600">Jar linked</span>}
                          {!v.isActive && <span className="text-[10px] text-red-500 font-medium">archived</span>}
                        </div>
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <span className="text-[11px] text-slate-400">{(v.boms || []).length} BOM</span>
                          {canWrite && (
                            v.isActive ? (
                              <button onClick={() => setArchiveConfirm({ ...v, productName: p.name })} className="text-[11px] text-red-500 font-medium hover:text-red-700">Archive</button>
                            ) : (
                              <button onClick={() => doRestoreVariant({ ...v, productName: p.name })} disabled={saving} className="text-[11px] text-emerald-600 font-medium hover:text-emerald-800 disabled:opacity-50">Restore</button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                    {(p.variants || []).length === 0 && !addingVariantFor && (
                      <p className="px-5 py-3 text-sm text-slate-400">No variants yet.</p>
                    )}
                    {addingVariantFor === p.id && (
                      <div className="px-5 py-3 bg-slate-50">
                        <div className="flex items-center gap-2">
                          <input value={vLabel} onChange={e => setVLabel(e.target.value)} placeholder="Label (e.g. 50cl)" className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
                          <input type="number" min="1" value={vPackSize} onChange={e => setVPackSize(e.target.value)} placeholder="Pack" className="w-20 px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
                          <input type="number" min="0" value={vPrice} onChange={e => setVPrice(e.target.value)} placeholder="₦/pack" className="w-24 px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
                          <button onClick={() => doCreateVariant(p.id)} disabled={busy} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded disabled:opacity-50">Add</button>
                          <button onClick={() => setAddingVariantFor(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-200 rounded">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div
              className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-5"
              onClick={e => { if (e.target === e.currentTarget) setSelectedVariant(null) }}
            >
              {!selectedVariant ? (
                <p className="text-sm text-slate-400 text-center py-8">Select a variant to view/edit its BOM.</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <h3 className="font-bold text-slate-900">{selectedVariant.label}</h3>
                    <p className="text-xs text-slate-500">{selectedVariant.productName} · frozen into run snapshots</p>
                  </div>
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    <label className="text-xs font-medium text-blue-700 whitespace-nowrap">Selling price (₦)</label>
                    <input type="number" min="0" step="0.01" value={priceDraft} onChange={e => setPriceDraft(e.target.value)}
                      className="w-28 px-2 py-1 border border-blue-300 rounded text-sm" />
                    <button onClick={doSaveVariantPrice} disabled={busy} className="px-3 py-1 text-xs text-white bg-blue-600 rounded disabled:opacity-50">Save</button>
                    <span className="text-[11px] text-blue-600">Price per pack</span>
                  </div>
                  {selectedVariant.category === 'JAR' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <label className="text-xs font-medium text-emerald-700 whitespace-nowrap">Refill price (₦)</label>
                        <input type="number" min="0" step="0.01" value={refillDraft} onChange={e => setRefillDraft(e.target.value)}
                          placeholder="e.g. 750" className="w-28 px-2 py-1 border border-emerald-300 rounded text-sm" />
                        <button onClick={doSaveRefillPrice} disabled={busy} className="px-3 py-1 text-xs text-white bg-emerald-600 rounded disabled:opacity-50">Save</button>
                        <span className="text-[11px] text-emerald-600">Jar refill price (excludes jar cost)</span>
                      </div>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <label className="text-xs font-medium text-amber-700 whitespace-nowrap">Jar material</label>
                        <select value={jarMaterialDraft} onChange={e => setJarMaterialDraft(e.target.value)}
                          className="flex-1 px-2 py-1 border border-amber-300 rounded text-sm">
                          <option value="">None</option>
                          {materials.filter(m => m.category === 'RAW_MATERIAL' || m.category === 'PACKAGING').map(m => (
                            <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                          ))}
                        </select>
                        <button onClick={doSaveJarMaterial} disabled={busy} className="px-3 py-1 text-xs text-white bg-amber-600 rounded disabled:opacity-50">Save</button>
                        <span className="text-[11px] text-amber-600">Material returned on refill delivery</span>
                      </div>
                    </div>
                  )}
                  {bomDraft.length > 0 && (
                    <div className="grid grid-cols-12 gap-2 items-center text-xs font-medium text-slate-500 px-1">
                      <span className="col-span-6">Material</span>
                      <span className="col-span-3">Qty/pack</span>
                      <span className="col-span-2">Waste %</span>
                      <span className="col-span-1"></span>
                    </div>
                  )}
                  {bomDraft.map((d, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <select value={d.materialId} onChange={e => {
                        const next = [...bomDraft]; next[i] = { ...next[i], materialId: e.target.value }; setBomDraft(next)
                      }} disabled={!canWrite} className="col-span-6 px-2 py-1.5 border border-slate-300 rounded text-sm">
                        <option value="">Material...</option>
                        {materials.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                      </select>
                      <input type="number" min="0" step="any" value={d.qtyPerPack} onChange={e => {
                        const next = [...bomDraft]; next[i] = { ...next[i], qtyPerPack: e.target.value }; setBomDraft(next)
                      }} disabled={!canWrite} placeholder="qty/pack" className="col-span-3 px-2 py-1.5 border border-slate-300 rounded text-sm" />
                      <input type="number" min="0" max="100" step="any" value={d.wastagePct} onChange={e => {
                        const next = [...bomDraft]; next[i] = { ...next[i], wastagePct: e.target.value }; setBomDraft(next)
                      }} disabled={!canWrite} placeholder="waste %" className="col-span-2 px-2 py-1.5 border border-slate-300 rounded text-sm" />
                      <button onClick={() => setBomDraft(bomDraft.filter((_, j) => j !== i))} disabled={!canWrite}
                        className="col-span-1 text-red-500 text-lg leading-none disabled:opacity-30">&times;</button>
                    </div>
                  ))}
                  {canWrite && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setBomDraft([...bomDraft, { materialId: '', qtyPerPack: '', wastagePct: '0' }])}
                        className="text-sm text-blue-600 font-medium">+ Add line</button>
                      <span className="flex-1" />
                      <button onClick={doSaveBom} disabled={busy} className="px-4 py-1.5 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">Save BOM</button>
                    </div>
                  )}
                  {bom.length > 0 && (
                    <p className="text-[11px] text-slate-400 pt-2">
                      {bom.map(l => `${l.material?.code} ${l.qtyPerPack}`).join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {archiveConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Archive Variant</h2>
            <p className="text-slate-600 mb-6">
              Are you sure you want to archive <strong>{archiveConfirm.label}</strong> ({archiveConfirm.productName})? It will be hidden from Sales and Production.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setArchiveConfirm(null)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
              <button onClick={doArchiveVariant} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-lg">{saving ? 'Archiving...' : 'Archive'}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
