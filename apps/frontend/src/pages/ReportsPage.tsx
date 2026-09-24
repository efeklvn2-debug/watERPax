import { useState } from 'react'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { reportsApi } from '../api/reports'
import { todayLocal } from '../utils/dates'

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data
  return value?.data ?? value
}

const REPORTS = [
  { name: 'fg-valuation', label: 'FG Valuation', dated: false, hint: 'Finished packs on hand, valued at batch cost' },
  { name: 'production-output', label: 'Production Output', dated: true, hint: 'Completed runs grouped by variant' },
  { name: 'waste', label: 'Waste by Component', dated: true, hint: 'Recorded waste per material' },
  { name: 'variance', label: 'Variance: Procured vs Realised', dated: true, hint: 'Procured IN vs consumed vs theoretical vs unexplained' },
  { name: 'sales-by-sku', label: 'Sales by SKU', dated: true, hint: 'Packs, revenue ex-VAT, COGS and gross profit per variant' },
  { name: 'low-raw', label: 'Low Raw Materials', dated: false, hint: 'Materials at or below minimum stock' }
] as const

type ReportName = typeof REPORTS[number]['name']

export function ReportsPage() {
  const notify = useNotification()
  const [active, setActive] = useState<ReportName>('variance')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayLocal())
  const [result, setResult] = useState<{ meta: Record<string, unknown>; rows: Record<string, string | number>[]; totals: Record<string, string | number> } | null>(null)
  const [loading, setLoading] = useState(false)

  const def = REPORTS.find(r => r.name === active)!

  const run = async () => {
    setLoading(true)
    const res = await reportsApi.getWaterReport(active, def.dated ? from || undefined : undefined, def.dated ? to || undefined : undefined)
    if (res.error) notify.error(res.error.message)
    else setResult(unwrap<any>(res) || null)
    setLoading(false)
  }

  const columns = result && result.rows.length > 0 ? Object.keys(result.rows[0]) : []

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-slate-500 mt-1">Make-to-stock control reports</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {REPORTS.map(r => (
            <button key={r.name} onClick={() => { setActive(r.name); setResult(null) }}
              className={`px-4 py-2 text-sm font-medium rounded-lg border ${active === r.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-sm text-slate-500 mb-4">{def.hint}</p>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            {def.dated && (
              <>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">From</span>
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">To</span>
                  <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </label>
              </>
            )}
            <button onClick={run} disabled={loading} className="px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Running...' : 'Run report'}
            </button>
            {result && result.rows.length > 0 && (
              <a href={reportsApi.waterReportCsvUrl(active, def.dated ? from || undefined : undefined, def.dated ? to || undefined : undefined)}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50" download>
                ↓ CSV
              </a>
            )}
          </div>

          {!result ? (
            <p className="text-sm text-slate-400 text-center py-6">Run the report to see results.</p>
          ) : result.rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No data for this selection.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-400">
                  {columns.map(c => <th key={c} className="px-3 py-2 font-medium">{c.replace(/([A-Z])/g, ' $1').trim()}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {columns.map(c => (
                        <td key={c} className="px-3 py-1.5 text-slate-700">
                          {typeof row[c] === 'number' ? (row[c] as number).toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
                  {columns.map((c, i) => (
                    <td key={c} className="px-3 py-2 text-slate-900">
                      {i === 0 ? 'Total' : (result.totals[c] != null ? Number(result.totals[c]).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')}
                    </td>
                  ))}
                </tr></tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
