import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import {
  guideAngelApi, GuideAngelCustomerRow, GuideAngelData, GuideAngelDraft,
  GuideAngelSession, GuideAngelStockRow, GuideAngelSummary
} from '../api/guideAngel'
import { todayLocal } from '../utils/dates'

const today = todayLocal()

const emptyDraft: GuideAngelDraft = {
  goLiveDate: today, cashBalance: 0, bankAccounts: [], loans: 0,
  fixedAssets: 0, accumulatedDepreciation: 0, ownerCapital: 0,
  customerBalances: [], supplierBalances: [], stockItems: []
}

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data; return value?.data ?? value
}

function money(value: number | undefined) {
  return `N${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Field({ label, value, onChange, type = 'text', placeholder, min, hint }: {
  label: string; value: string | number; onChange: (v: string) => void
  type?: string; placeholder?: string; min?: string; hint?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <input type={type} value={value} min={min} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </label>
  )
}

function SummaryCards({ summary }: { summary?: GuideAngelSummary }) {
  if (!summary) return null
  const items = [
    ['Customers owe us', summary.customerReceivables],
    ['We owe suppliers', summary.supplierPayables],
    ['Cash and bank', summary.cashBalance + summary.bankBalance],
    ['Opening stock value', summary.stockValue]
  ] as const
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {items.map(([label, value]) => (
        <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-lg font-bold text-slate-800 mt-1">{typeof value === 'number' ? money(value) : value}</p>
        </div>
      ))}
    </div>
  )
}

export function GuideAngelPage() {
  const navigate = useNavigate()
  const notify = useNotification()
  const [draft, setDraft] = useState<GuideAngelDraft>(emptyDraft)
  const [summary, setSummary] = useState<GuideAngelSummary | undefined>()
  const [status, setStatus] = useState<GuideAngelSession['status']>('NOT_STARTED')
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [data, setData] = useState<GuideAngelData>({ customers: [], suppliers: [], materials: [] })

  const updateStockItem = (materialId: string, updater: (s: { materialId: string; quantity: number }) => { materialId: string; quantity: number }) => {
    const existing = draft.stockItems.filter(s => s.materialId !== materialId)
    const current = draft.stockItems.find(s => s.materialId === materialId) || { materialId, quantity: 0 }
    setDraft({ ...draft, stockItems: [...existing, updater(current)] })
  }

  const removeStockItem = (materialId: string) => {
    setDraft({ ...draft, stockItems: draft.stockItems.filter(s => s.materialId !== materialId) })
  }

  const addStockMaterial = (materialId: string) => {
    if (draft.stockItems.some(s => s.materialId === materialId)) return
    setDraft({ ...draft, stockItems: [...draft.stockItems, { materialId, quantity: 0 }] })
  }

  useEffect(() => {
    let mounted = true
    Promise.all([guideAngelApi.data(), guideAngelApi.get()]).then(([dataRes, sessionRes]) => {
      if (!mounted) return
      if (dataRes.error) { notify.error(dataRes.error.message); setLoading(false); return }
      const fetched = unwrap<GuideAngelData>(dataRes); if (fetched) setData(fetched)
      if (sessionRes.error) { notify.error(sessionRes.error.message); setLoading(false); return }
      const session = unwrap<GuideAngelSession>(sessionRes)
      if (session) {
        setStatus(session.status)
        if (session.draft) { setDraft({ ...emptyDraft, ...session.draft }) }
        setSummary(session.summary)
      }
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  const save = async () => {
    setSaving(true); setErrors([])
    const r = await guideAngelApi.save(draft)
    setSaving(false)
    if (r.error) { notify.error(r.error.message); return false }
    const s = unwrap<GuideAngelSession>(r); if (s) { setSummary(s.summary); setStatus(s.status) }
    return true
  }

  const next = async () => { if (step < 4) { if (!(await save())) return; setStep(s => s + 1) } }

  const validateAndComplete = async () => {
    if (!(await save())) return
    const v = await guideAngelApi.validate(draft); const result: any = unwrap<any>(v)
    if (v.error) { notify.error(v.error.message); return }
    setSummary(result?.summary)
    if (!result?.valid) { setErrors(result?.errors || ['Please review']); return }
    if (!window.confirm('Complete Guide Angel and post the opening records? This cannot be repeated.')) return
    setSaving(true)
    const r = await guideAngelApi.complete(); setSaving(false)
    if (r.error) { notify.error(r.error.message); return }
    setStatus('COMPLETED')
    notify.success('Guide Angel completed.')
  }

  if (loading) return <Layout><div className="text-center py-20 text-slate-500">Loading Guide Angel...</div></Layout>

  if (status === 'COMPLETED') {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-2xl">&#10003;</div>
            <h1 className="text-2xl font-bold text-slate-800 mt-4">Guide Angel is complete</h1>
            <p className="text-slate-500 mt-2">The opening records for this organization have been posted successfully.</p>
            <div className="text-left mt-8"><SummaryCards summary={summary} /></div>
            <button onClick={() => navigate('/')} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">Go to Dashboard</button>
          </div>
        </div>
      </Layout>
    )
  }

  const steps = ['Start', 'Customers', 'Suppliers', 'Stock', 'Review']

  const customers: GuideAngelCustomerRow[] = data.customers.map(c => {
    const b = draft.customerBalances.find(b => b.customerId === c.id)
    return { ...c, receivableAmount: b?.receivableAmount || 0, depositAmount: b?.depositAmount || 0, jarBalance: b?.jarBalance || 0 }
  })

  const suppliers = data.suppliers.map(s => {
    const b = draft.supplierBalances.find(b => b.supplierId === s.id)
    return { ...s, payableAmount: b?.payableAmount || 0 }
  })

  const stockRows: GuideAngelStockRow[] = draft.stockItems.map(item => {
    const m = data.materials.find(m => m.id === item.materialId)
    return { id: item.materialId, code: m?.code || '', name: m?.name || '', category: m?.category || '', unitOfMeasure: m?.unitOfMeasure || '', costPrice: m?.costPrice || 0, quantity: item.quantity }
  })

  const unusedMaterials = data.materials.filter(m => !draft.stockItems.some(s => s.materialId === m.id))

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">WatERPax</p>
            <h1 className="text-2xl font-bold text-slate-800 mt-1">Guide Angel</h1>
            <p className="text-sm text-slate-500 mt-1">Add customers, suppliers, and materials first in their respective pages. Then come here for opening balances.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {steps.map((label, index) => (
            <div key={label} className="flex items-center gap-2 shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${index === step ? 'bg-blue-600 text-white' : index < step ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{index < step ? '\u2713' : index + 1}</div>
              <span className={`text-sm ${index === step ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{label}</span>
              {index < steps.length - 1 && <span className="w-8 h-px bg-slate-200 mx-1" />}
            </div>
          ))}
        </div>

        <SummaryCards summary={summary} />

        {errors.length > 0 && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p className="font-semibold mb-1">Please review:</p>{errors.map(e => <p key={e}>{e}</p>)}</div>}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

          {step === 0 && <>
            <h2 className="text-lg font-semibold text-slate-800">Money, assets, and liabilities</h2>
            <p className="text-sm text-slate-500 mt-1 mb-6">Enter the cash, bank balances, loans, and equipment your business holds on the go-live date.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Go-live date" type="date" value={draft.goLiveDate} onChange={v => setDraft({ ...draft, goLiveDate: v })} />
              <Field label="Cash on hand" type="number" min="0" value={draft.cashBalance} onChange={v => setDraft({ ...draft, cashBalance: Number(v) || 0 })} />
              <Field label="Loans still owed" type="number" min="0" value={draft.loans} onChange={v => setDraft({ ...draft, loans: Number(v) || 0 })} />
              <Field label="Equipment and machinery (gross cost)" type="number" min="0" value={draft.fixedAssets} onChange={v => setDraft({ ...draft, fixedAssets: Number(v) || 0 })} hint="Original purchase cost of all equipment" />
              <Field label="Accumulated depreciation so far" type="number" min="0" value={draft.accumulatedDepreciation} onChange={v => setDraft({ ...draft, accumulatedDepreciation: Number(v) || 0 })} hint="Total depreciation already recorded" />
              <Field label="Owner cumulative investment" type="number" min="0" value={draft.ownerCapital} onChange={v => setDraft({ ...draft, ownerCapital: Number(v) || 0 })} hint="Leave at zero if unknown. Your accountant can reclassify later." />
            </div>
            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between mb-3"><h3 className="font-medium text-slate-700">Bank accounts</h3><button onClick={() => setDraft({ ...draft, bankAccounts: [...draft.bankAccounts, { name: '', balance: 0 }] })} className="text-sm text-blue-600 font-medium">+ Add bank</button></div>
              {draft.bankAccounts.length === 0 && <p className="text-sm text-slate-400">No bank account added.</p>}
              <div className="space-y-2">{draft.bankAccounts.map((bank, index) => <div key={index} className="flex gap-2"><input value={bank.name} onChange={e => setDraft({ ...draft, bankAccounts: draft.bankAccounts.map((b, i) => i === index ? { ...b, name: e.target.value } : b) })} placeholder="Bank name" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" /><input type="number" min="0" value={bank.balance} onChange={e => setDraft({ ...draft, bankAccounts: draft.bankAccounts.map((b, i) => i === index ? { ...b, balance: Number(e.target.value) || 0 } : b) })} placeholder="Balance" className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none" /><button onClick={() => setDraft({ ...draft, bankAccounts: draft.bankAccounts.filter((_, i) => i !== index) })} className="px-2 text-red-600">x</button></div>)}</div>
            </div>
          </>}

          {step === 1 && <>
            <h2 className="text-lg font-semibold text-slate-800">Customer opening balances</h2>
            <p className="text-sm text-slate-500 mt-1 mb-4">Enter what each customer owes you, any deposit they hold, and empty jars they have.</p>
            {data.customers.length === 0 ? <div className="text-center py-12 text-slate-400">No customers found. Add customers first, then return here.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase"><th className="pb-2">Customer</th><th className="pb-2 w-36">Amount owed</th><th className="pb-2 w-36">Deposit held</th><th className="pb-2 w-36">Jars owed</th></tr></thead><tbody className="divide-y divide-slate-100">
                {customers.map(c => {
                  const update = (f: 'receivableAmount' | 'depositAmount' | 'jarBalance', v: number) => {
                    const rest = draft.customerBalances.filter(b => b.customerId !== c.id)
                    const cur = draft.customerBalances.find(b => b.customerId === c.id) || { customerId: c.id, receivableAmount: 0, depositAmount: 0, jarBalance: 0 }
                    setDraft({ ...draft, customerBalances: [...rest, { ...cur, [f]: v }] })
                  }
                  return <tr key={c.id}><td className="py-2 pr-2"><span className="font-medium text-slate-700">{c.name}</span></td><td className="py-2"><input type="number" min="0" value={c.receivableAmount || ''} onChange={e => update('receivableAmount', Number(e.target.value) || 0)} placeholder="0" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm outline-none" /></td><td className="py-2"><input type="number" min="0" value={c.depositAmount || ''} onChange={e => update('depositAmount', Number(e.target.value) || 0)} placeholder="0" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm outline-none" /></td><td className="py-2"><input type="number" min="0" step="1" value={c.jarBalance || ''} onChange={e => update('jarBalance', Number(e.target.value) || 0)} placeholder="0" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm outline-none" /></td></tr>
                })}
              </tbody></table></div>
            )}
          </>}

          {step === 2 && <>
            <h2 className="text-lg font-semibold text-slate-800">Supplier opening balances</h2>
            <p className="text-sm text-slate-500 mt-1 mb-4">Enter what you owe each supplier.</p>
            {data.suppliers.length === 0 ? <div className="text-center py-12 text-slate-400">No suppliers found. Add suppliers first, then return here.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase"><th className="pb-2">Supplier</th><th className="pb-2 w-40">Amount owed</th></tr></thead><tbody className="divide-y divide-slate-100">
                {suppliers.map(s => {
                  const update = (v: number) => {
                    const rest = draft.supplierBalances.filter(b => b.supplierId !== s.id)
                    setDraft({ ...draft, supplierBalances: [...rest, { supplierId: s.id, payableAmount: v }] })
                  }
                  return <tr key={s.id}><td className="py-2 pr-2"><span className="font-medium text-slate-700">{s.name}</span><span className="text-slate-400 ml-1">{s.code}</span></td><td className="py-2"><input type="number" min="0" value={s.payableAmount || ''} onChange={e => update(Number(e.target.value) || 0)} placeholder="0" className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm outline-none" /></td></tr>
                })}
              </tbody></table></div>
            )}
          </>}

          {step === 3 && <>
            <h2 className="text-lg font-semibold text-slate-800">Opening stock</h2>
            <p className="text-sm text-slate-500 mt-1 mb-2">For each material, enter the total quantity on hand at go-live date.</p>

            {draft.stockItems.length > 0 && <div className="space-y-5 mb-6">
              {stockRows.map((item) => {
                return (
                  <div key={item.id} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="font-semibold text-slate-700">{item.name}</span>
                        <span className="text-slate-400 text-xs ml-2">{item.category.replace(/_/g, ' ')}</span>
                        <span className="text-slate-400 text-xs ml-2">Cost: {money(item.costPrice)}/{item.unitOfMeasure}</span>
                        <span className="text-blue-600 text-xs ml-2 font-medium">Total: {item.quantity} {item.unitOfMeasure}</span>
                      </div>
                      <button onClick={() => removeStockItem(item.id)} className="text-xs text-red-600">Remove</button>
                    </div>

                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500">Qty ({item.unitOfMeasure}):</span>
                        <input type="number" min="0" value={item.quantity || ''}
                          onChange={e => updateStockItem(item.id, s => ({ ...s, quantity: Number(e.target.value) || 0 }))}
                          className="w-28 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none" />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>}

            {unusedMaterials.length > 0 && (
              <div className="flex items-center gap-2">
                <select onChange={e => { if (e.target.value) addStockMaterial(e.target.value); e.target.value = '' }}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none">
                  <option value="">+ Add material...</option>
                  {unusedMaterials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.category.replace(/_/g, ' ')})</option>)}
                </select>
              </div>
            )}

            {draft.stockItems.length === 0 && <div className="text-center py-12 text-slate-400">Add a material from the dropdown above to enter stock quantities.</div>}
          </>}

          {step === 4 && <>
            <h2 className="text-lg font-semibold text-slate-800">Review before finishing</h2>
            <p className="text-sm text-slate-500 mt-1 mb-6">Check the totals carefully. Guide Angel will create the opening records only after you confirm.</p>
            <SummaryCards summary={summary} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 py-2"><span>Customer deposits</span><strong>{money(summary?.customerDeposits)}</strong></div>
              <div className="flex justify-between border-b border-slate-100 py-2"><span>Loans</span><strong>{money(summary?.loans)}</strong></div>
              <div className="flex justify-between border-b border-slate-100 py-2"><span>Fixed assets (net)</span><strong>{money((summary?.fixedAssets || 0) - (summary?.accumulatedDepreciation || 0))}</strong></div>
              <div className="flex justify-between border-b border-slate-100 py-2"><span>Owner capital</span><strong>{money(summary?.ownerCapital)}</strong></div>
              <div className="flex justify-between border-b border-slate-100 py-2"><span>Opening balancing entry</span><strong>{money(Math.abs(summary?.openingEquity || 0))}</strong></div>
            </div>
            <div className="mt-6 rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">Guide Angel will post one opening accounting record, create customer and supplier opening balances, and initialize your stock records. Do not enter pre-go-live finished goods in the Stock step — they stay off-book. When customers purchase them later, record the payments normally via Sales.</div>
          </>}

          <div className="flex justify-between mt-8 pt-5 border-t border-slate-100">
            <button onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{step === 0 ? 'Cancel' : 'Back'}</button>
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50">{saving ? 'Saving...' : 'Save draft'}</button>
              {step < 4 ? <button onClick={next} disabled={saving} className="px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Next</button>
              : <button onClick={validateAndComplete} disabled={saving} className="px-5 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">{saving ? 'Completing...' : 'Complete Guide Angel'}</button>}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
