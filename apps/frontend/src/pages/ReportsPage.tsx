import { Fragment, useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { reportsApi, type ProfitRangeReport, type BalanceSheetReport } from '../api/reports'
import { financeApi, type TrialBalance, type AccountBalance } from '../api/finance'
import { productsApi, type ProductWithVariants } from '../api/products'
import { dateInputLocal, todayLocal } from '../utils/dates'
import { formatNaira } from '../utils/currency'

function unwrap<T>(response: { data?: T } | undefined): T | undefined {
  const value: any = response?.data
  return value?.data ?? value
}

function formatCurrency(amount: number): string {
  return formatNaira(amount)
}

const MONEY_COLUMN = /cost|value|price|amount|revenue|cogs|profit|collected|outstanding|vat/i
const formatCellNumber = (column: string, n: number): string =>
  MONEY_COLUMN.test(column) ? formatNaira(n) : n.toLocaleString(undefined, { maximumFractionDigits: 2 })

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
}

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <button onClick={onClick} className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">
        ↓ CSV
      </button>
    </div>
  )
}

function Card({ title, value, subtitle, color }: { title: string; value: string; subtitle?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-sm text-slate-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${color || 'text-slate-900'}`}>{value}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
  )
}

function EmptyReport() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
      <p className="text-slate-500">No data available for this report</p>
    </div>
  )
}

const WATER_REPORTS = [
  { name: 'production-output', label: 'Production Output', dated: 'range', kind: 'water', hint: 'Completed runs grouped by variant' },
  { name: 'waste', label: 'Waste by Component', dated: 'range', kind: 'water', hint: 'Recorded waste per material' },
  { name: 'variance', label: 'Variance: Procured vs Realised', dated: 'range', kind: 'water', hint: 'Procured IN vs consumed vs theoretical vs unexplained' },
  { name: 'sales-by-sku', label: 'Sales by SKU', dated: 'range', kind: 'water', hint: 'Packs, revenue ex-VAT, COGS and gross profit per variant' },
  { name: 'fg-valuation', label: 'FG Valuation', dated: 'none', kind: 'water', hint: 'Finished packs on hand, valued at batch cost — totals cover sellable (FG_STORE) packs; defective batches listed per row' },
  { name: 'low-raw', label: 'Low Raw Materials', dated: 'none', kind: 'water', hint: 'Materials at or below minimum stock' }
] as const

const FINANCIAL_REPORTS = [
  { name: 'profit-loss', label: 'Profit & Loss', dated: 'range', kind: 'financial', hint: 'Revenue, COGS, expenses and net profit for a period' },
  { name: 'balance-sheet', label: 'Balance Sheet', dated: 'asof', kind: 'financial', hint: 'Assets, liabilities and equity as of a date' },
  { name: 'trial-balance', label: 'Trial Balance', dated: 'asof', kind: 'financial', hint: 'Debit and credit totals per account as of a date — Dr must equal Cr' }
] as const

const REPORTS = [...WATER_REPORTS, ...FINANCIAL_REPORTS]

type ReportName = typeof REPORTS[number]['name']

type Row = Record<string, string | number>

const PALETTE = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#65a30d', '#0ea5e9', '#f59e0b']

const compact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n * 100) / 100)
}

const axisTick = { fontSize: 11, fill: '#64748b' }

const PERIOD_PRESETS = [
  { kind: 'today', label: 'Today' },
  { kind: 'yesterday', label: 'Yesterday' },
  { kind: '7d', label: 'Last 7 days' },
  { kind: '30d', label: 'Last 30 days' },
  { kind: 'mtd', label: 'This month' },
  { kind: 'last-month', label: 'Last month' },
  { kind: 'ytd', label: 'This year' }
] as const

type PresetKind = typeof PERIOD_PRESETS[number]['kind']

function presetRange(kind: PresetKind): { from: string; to: string } {
  const now = new Date()
  const t = todayLocal()
  const shift = (days: number) => dateInputLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days))
  switch (kind) {
    case 'today': return { from: t, to: t }
    case 'yesterday': {
      const y = shift(1)
      return { from: y, to: y }
    }
    case '7d': return { from: shift(6), to: t }
    case '30d': return { from: shift(29), to: t }
    case 'mtd': return { from: dateInputLocal(new Date(now.getFullYear(), now.getMonth(), 1)), to: t }
    case 'last-month': return {
      from: dateInputLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: dateInputLocal(new Date(now.getFullYear(), now.getMonth(), 0))
    }
    case 'ytd': return { from: dateInputLocal(new Date(now.getFullYear(), 0, 1)), to: t }
  }
}

function chartLabel(r: Row): string {
  const p = String(r.product ?? '')
  const v = String(r.variant ?? r.name ?? r.code ?? '')
  return p ? `${p} ${v}` : v
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="bg-slate-50 rounded-lg border border-slate-100 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function ReportCharts({ name, rows, meta }: { name: ReportName; rows: Row[]; meta: Record<string, unknown> }) {
  if (name === 'production-output') {
    const data = rows.map(r => ({
      name: chartLabel(r),
      packs: Number(r.packs)
    }))
    const trend = (meta.trend as { date: string; packs: number }[] | undefined) || []
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Production trend (packs per day)">
          <LineChart data={trend} margin={{ bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => v.slice(5)} angle={-90} textAnchor="end" height={70} interval="preserveStartEnd" />
            <YAxis tick={axisTick} tickFormatter={compact} />
            <Tooltip formatter={v => Number(v).toLocaleString()} />
            <Line dataKey="packs" name="Packs produced" stroke="#2563eb" strokeWidth={2} dot={trend.length <= 31 ? { r: 3 } : false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Packs produced by variant">
          <BarChart data={data} margin={{ bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={axisTick} angle={-25} textAnchor="end" interval={0} />
            <YAxis tick={axisTick} tickFormatter={compact} />
            <Tooltip formatter={v => Number(v).toLocaleString()} />
            <Bar dataKey="packs" name="Packs" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>
    )
  }

  if (name === 'sales-by-sku') {
    const data = rows.map(r => ({
      name: chartLabel(r),
      revenueExVat: Number(r.revenueExVat),
      grossProfit: Number(r.grossProfit)
    }))
    const trend = (meta.trend as { date: string; packs: number }[] | undefined) || []
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Sales trend (packs per day)">
          <LineChart data={trend} margin={{ bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => v.slice(5)} angle={-90} textAnchor="end" height={70} interval="preserveStartEnd" />
            <YAxis tick={axisTick} tickFormatter={compact} />
            <Tooltip formatter={v => Number(v).toLocaleString()} />
            <Line dataKey="packs" name="Packs sold" stroke="#7c3aed" strokeWidth={2} dot={trend.length <= 31 ? { r: 3 } : false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Revenue ex-VAT share by variant (₦)">
          <PieChart>
            <Tooltip formatter={(v, n, p) => [
              `${formatNaira(Number(v))} (gross profit: ${formatNaira(Number((p?.payload as any)?.grossProfit || 0))})`,
              String(n)
            ]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie data={data} dataKey="revenueExVat" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={false}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
          </PieChart>
        </ChartCard>
      </div>
    )
  }

  if (name === 'waste') {
    const data = rows.slice(0, 10).map(r => ({ name: String(r.name || r.code), waste: Number(r.waste) }))
    return (
      <div className="mb-6">
        <ChartCard title="Waste by material (top 10)">
          <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={axisTick} tickFormatter={compact} />
            <YAxis type="category" dataKey="name" tick={axisTick} width={160} />
            <Tooltip formatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
            <Bar dataKey="waste" name="Waste" fill="#dc2626" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartCard>
      </div>
    )
  }

  if (name === 'fg-valuation') {
    const byVariant = new Map<string, number>()
    for (const r of rows) {
      const key = chartLabel(r)
      byVariant.set(key, (byVariant.get(key) || 0) + Number(r.value))
    }
    const data = [...byVariant.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
    return (
      <div className="mb-6">
        <ChartCard title="Stock value share by variant (₦)">
          <PieChart>
            <Tooltip formatter={v => formatNaira(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={false}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
          </PieChart>
        </ChartCard>
      </div>
    )
  }

  return null
}

export function ReportsPage() {
  const notify = useNotification()
  const [active, setActive] = useState<ReportName>('production-output')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayLocal())
  const [preset, setPreset] = useState<PresetKind | null>(null)
  const [result, setResult] = useState<{ meta: Record<string, unknown>; rows: Record<string, string | number>[]; totals: Record<string, string | number> } | null>(null)
  const [profitData, setProfitData] = useState<ProfitRangeReport | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null)
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null)
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<ProductWithVariants[]>([])
  const [productCategory, setProductCategory] = useState('all')
  const [productId, setProductId] = useState('all')

  useEffect(() => {
    productsApi.list().then(res => {
      const data = unwrap<ProductWithVariants[]>(res)
      if (data) setProducts(data)
    })
  }, [])

  const def = REPORTS.find(r => r.name === active)!

  const categories = [...new Set(products.map(p => p.category))]
  const filteredProducts = productCategory === 'all' ? products : products.filter(p => p.category === productCategory)
  const activeFilters = active === 'production-output' || active === 'sales-by-sku'
    ? {
        category: productCategory !== 'all' ? productCategory : undefined,
        productId: productId !== 'all' ? productId : undefined
      }
    : undefined

  const run = async () => {
    setLoading(true)
    if (def.kind === 'financial') {
      if (active === 'profit-loss') {
        const res = await reportsApi.getProfitRange(from, to)
        if (res.error) notify.error(res.error.message)
        else setProfitData(unwrap<ProfitRangeReport>(res) || null)
      } else if (active === 'balance-sheet') {
        const res = await reportsApi.getBalanceSheet(to)
        if (res.error) notify.error(res.error.message)
        else setBalanceSheet(unwrap<BalanceSheetReport>(res) || null)
      } else {
        const res = await financeApi.getTrialBalance(to)
        if (res.error) notify.error(res.error.message)
        else setTrialBalance(unwrap<TrialBalance>(res) || null)
      }
    } else {
      const res = await reportsApi.getWaterReport(active as Parameters<typeof reportsApi.getWaterReport>[0], def.dated === 'range' ? from || undefined : undefined, def.dated === 'range' ? to || undefined : undefined, activeFilters)
      if (res.error) notify.error(res.error.message)
      else setResult(unwrap<any>(res) || null)
    }
    setLoading(false)
  }

  const columns = result && result.rows.length > 0 ? Object.keys(result.rows[0]) : []

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-slate-500 mt-1">Operational and financial reports</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {WATER_REPORTS.map(r => (
            <button key={r.name} onClick={() => { setActive(r.name); setResult(null) }}
              className={`px-4 py-2 text-sm font-medium rounded-lg border ${active === r.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {r.label}
            </button>
          ))}
          <span className="w-px h-6 bg-slate-300 mx-1" aria-hidden />
          {FINANCIAL_REPORTS.map(r => (
            <button key={r.name}
              onClick={() => {
                setActive(r.name); setResult(null)
                if (r.name === 'profit-loss' && !from) setFrom(dateInputLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
              }}
              className={`px-4 py-2 text-sm font-medium rounded-lg border ${active === r.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <p className="text-sm text-slate-500 mb-4">{def.hint}</p>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            {def.dated !== 'none' && (
              <>
                <div className="flex flex-wrap items-center gap-1.5 w-full">
                  {PERIOD_PRESETS.map(p => (
                    <button key={p.kind}
                      onClick={() => { const r = presetRange(p.kind); setFrom(r.from); setTo(r.to); setPreset(p.kind) }}
                      className={`px-3 py-1 text-xs rounded-full border ${preset === p.kind ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                      {p.label}
                    </button>
                  ))}
                  <span className="text-xs text-slate-400 ml-1">or pick dates below</span>
                </div>
                {def.dated === 'range' && (
                  <label className="block">
                    <span className="block text-xs font-medium text-slate-600 mb-1">From</span>
                    <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset(null) }} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </label>
                )}
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">{def.dated === 'asof' ? 'As of' : 'To'}</span>
                  <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset(null) }} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </label>
              </>
            )}
            {(active === 'production-output' || active === 'sales-by-sku') && (
              <>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">Category</span>
                  <select value={productCategory}
                    onChange={e => { setProductCategory(e.target.value); setProductId('all') }}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                    <option value="all">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">Product</span>
                  <select value={productId} onChange={e => setProductId(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white max-w-[220px]">
                    <option value="all">All products</option>
                    {filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              </>
            )}
            <button onClick={run} disabled={loading} className="px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Running...' : 'Run report'}
            </button>
            {def.kind === 'water' && result && result.rows.length > 0 && (
              <a href={reportsApi.waterReportCsvUrl(active, def.dated === 'range' ? from || undefined : undefined, def.dated === 'range' ? to || undefined : undefined, activeFilters)}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50" download>
                ↓ CSV
              </a>
            )}
          </div>

          {def.kind === 'water' && result && result.rows.length > 0 && <ReportCharts name={active} rows={result.rows} meta={result.meta} />}

          {active === 'profit-loss' ? (
            <ProfitLossView data={profitData} from={from} to={to} />
          ) : active === 'balance-sheet' ? (
            <BalanceSheetView data={balanceSheet} />
          ) : active === 'trial-balance' ? (
            <TrialBalanceView data={trialBalance} />
          ) : !result ? (
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
                          {typeof row[c] === 'number' ? formatCellNumber(c, row[c] as number) : String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
                  {columns.map((c, i) => (
                    <td key={c} className="px-3 py-2 text-slate-900">
                      {i === 0 ? 'Total' : (result.totals[c] != null ? formatCellNumber(c, Number(result.totals[c])) : '')}
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

// ─── Profit & Loss ──────────────────────────────────
function ProfitLossView({ data: rawData, from, to }: { data: ProfitRangeReport | null; from: string; to: string }) {
  if (!rawData) return <EmptyReport />
  const data = rawData
  // Signed contributions to profit: deductions are negative, so the bars and
  // the exported rows add up to Net Profit.
  const chartData = [
    { name: 'Revenue', amount: data.breakdown.salesRevenue + data.breakdown.packingRevenue + data.breakdown.otherIncome },
    { name: 'COGS', amount: -data.costOfGoodsSold },
    { name: 'Expenses', amount: -data.expenses },
    { name: 'Net Profit', amount: data.netProfit },
  ]

  const doExport = () => {
    exportCSV(`profit_loss_${from}_${to}.csv`,
      ['Category', 'Amount'],
      [
        ['Sales Revenue', String(data.breakdown.salesRevenue)],
        ['Packing Revenue', String(data.breakdown.packingRevenue)],
        ['Other Income', String(data.breakdown.otherIncome)],
        ['Total Revenue', String(data.revenue)],
        ['Cost of Goods Sold', String(-data.costOfGoodsSold)],
        ['Gross Profit', String(data.revenue - data.costOfGoodsSold)],
        ['Expenses', String(-data.expenses)],
        ['Net Profit', String(data.netProfit)],
      ]
    )
  }

  return (
    <div className="space-y-6">
      <CsvButton onClick={doExport} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card title="Total Revenue" value={formatCurrency(data.revenue)} color="text-green-600" />
        <Card title="Cost of Goods Sold" value={formatCurrency(data.costOfGoodsSold)} color="text-red-600" />
        <Card title="Gross Profit" value={formatCurrency(data.revenue - data.costOfGoodsSold)} color={data.revenue - data.costOfGoodsSold >= 0 ? 'text-blue-600' : 'text-red-600'} />
        <Card title="Net Profit" value={formatCurrency(data.netProfit)} color={data.netProfit >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-slate-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Revenue Breakdown</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-right py-2 font-medium">Amount</th>
                <th className="text-right py-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Sales Revenue', amount: data.breakdown.salesRevenue },
                { label: 'Packing Revenue', amount: data.breakdown.packingRevenue },
                { label: 'Other Income', amount: data.breakdown.otherIncome },
              ].map(item => (
                <tr key={item.label} className="border-b border-slate-100">
                  <td className="py-2">{item.label}</td>
                  <td className="text-right py-2 font-medium">{formatCurrency(item.amount)}</td>
                  <td className="text-right py-2 text-slate-500">{data.revenue > 0 ? Math.round(item.amount / data.revenue * 100) : 0}%</td>
                </tr>
              ))}
              <tr className="font-semibold bg-slate-100">
                <td className="py-2">Total Revenue</td>
                <td className="text-right py-2">{formatCurrency(data.revenue)}</td>
                <td className="text-right py-2">100%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-slate-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Expense Breakdown</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-right py-2 font-medium">Amount</th>
                <th className="text-right py-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.expenseBreakdown || {}).filter(([, v]) => v !== 0).map(([key, amount]) => (
                <tr key={key} className="border-b border-slate-100">
                  <td className="py-2">{key.replace(/([A-Z])/g, ' $1').trim()}</td>
                  <td className="text-right py-2 font-medium">{formatCurrency(-amount)}</td>
                  <td className="text-right py-2 text-slate-500">{data.revenue > 0 ? Math.round(-amount / data.revenue * 100) : 0}%</td>
                </tr>
              ))}
              <tr className="font-semibold bg-slate-100">
                <td className="py-2">Total Expenses</td>
                <td className="text-right py-2">{formatCurrency(-data.expenses)}</td>
                <td className="text-right py-2">{data.revenue > 0 ? Math.round(-data.expenses / data.revenue * 100) : 0}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-4">Revenue vs COGS vs Expenses</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: any) => formatCurrency(v)} />
            <Tooltip formatter={(value: any) => formatCurrency(value)} />
            <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 bg-slate-50 rounded-lg p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left py-2 font-medium">Line Item</th>
              <th className="text-right py-2 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100"><td className="py-2 font-medium text-slate-700">Sales Revenue</td><td className="text-right py-2">{formatCurrency(data.breakdown.salesRevenue)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2 font-medium text-slate-700">Packing Revenue</td><td className="text-right py-2">{formatCurrency(data.breakdown.packingRevenue)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2 font-medium text-slate-700">Other Income</td><td className="text-right py-2">{formatCurrency(data.breakdown.otherIncome)}</td></tr>
            <tr className="border-b border-slate-100 bg-white"><td className="py-2 font-semibold">Total Revenue</td><td className="text-right py-2 font-semibold">{formatCurrency(data.revenue)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2 font-medium text-red-600">Cost of Goods Sold</td><td className="text-right py-2 text-red-600">{formatCurrency(-data.costOfGoodsSold)}</td></tr>
            <tr className="border-b border-slate-100 bg-white"><td className="py-2 font-semibold">Gross Profit</td><td className="text-right py-2 font-semibold">{formatCurrency(data.revenue - data.costOfGoodsSold)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2 font-medium text-red-600">Expenses</td><td className={`text-right py-2 ${-data.expenses < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(-data.expenses)}</td></tr>
            <tr className="bg-blue-50"><td className="py-2 font-bold text-lg">Net Profit</td><td className="text-right py-2 font-bold text-lg">{formatCurrency(data.netProfit)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Balance Sheet ──────────────────────────────────
function BalanceSheetView({ data: rawData }: { data: BalanceSheetReport | null }) {
  if (!rawData) return <EmptyReport />
  const data = rawData

  const doExport = () => {
    const rows: string[][] = []
    rows.push(['ASSETS', '', ''])
    data.assets.accounts.forEach(a => rows.push([a.accountCode, a.accountName, String(a.balance)]))
    rows.push(['', `Total Assets`, String(data.assets.total)])
    rows.push(['', '', ''])
    rows.push(['LIABILITIES', '', ''])
    data.liabilities.accounts.forEach(a => rows.push([a.accountCode, a.accountName, String(a.balance)]))
    rows.push(['', `Total Liabilities`, String(data.liabilities.total)])
    rows.push(['', '', ''])
    rows.push(['EQUITY', '', ''])
    data.equity.accounts.forEach(a => rows.push([a.accountCode, a.accountName, String(a.balance)]))
    rows.push(['', `Total Equity`, String(data.equity.total)])
    rows.push(['', '', ''])
    rows.push(['', `Total Liabilities & Equity`, String(data.totalLiabilitiesAndEquity)])
    exportCSV(`balance_sheet_${data.asOfDate}.csv`,
      ['Code', 'Account', 'Balance'],
      rows
    )
  }

  function SectionTable({ title, section, color }: { title: string; section: typeof data.assets; color: string }) {
    return (
      <div className="bg-slate-50 rounded-lg p-4">
        <h4 className={`text-sm font-semibold mb-3 ${color}`}>{title}</h4>
        <table className="w-full text-sm">
          <tbody>
            {section.accounts.map(a => (
              <tr key={a.accountId} className="border-b border-slate-100">
                <td className="py-1.5 text-slate-400 w-16">{a.parentId ? <span className="inline-block w-4" /> : null}{a.accountCode}</td>
                <td className="py-1.5">{a.parentId ? <span className="inline-block w-4 text-slate-300">↳ </span> : null}{a.accountName}</td>
                <td className="py-1.5 text-right font-medium">{formatCurrency(a.balance)}</td>
              </tr>
            ))}
            {section.accounts.length === 0 && (
              <tr><td colSpan={3} className="py-2 text-slate-400 text-center text-xs">No balances</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-semibold bg-slate-100">
              <td colSpan={2} className="py-2 px-2">Total {title}</td>
              <td className="py-2 text-right">{formatCurrency(section.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <CsvButton onClick={doExport} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card title="Total Assets" value={formatCurrency(data.totalAssets)} color="text-blue-600" />
        <Card title="Total Liabilities" value={formatCurrency(data.liabilities.total)} color="text-red-600" />
        <Card title="Total Equity" value={formatCurrency(data.equity.total)} color="text-green-600" />
        <Card
          title={data.balanced ? 'Balanced' : 'Out of Balance'}
          value={formatCurrency(Math.abs(data.totalAssets - data.totalLiabilitiesAndEquity))}
          color={data.balanced ? 'text-green-600' : 'text-red-600'}
          subtitle={`As of ${formatDate(data.asOfDate)}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionTable title="Assets" section={data.assets} color="text-blue-700" />
        <div className="space-y-6">
          <SectionTable title="Liabilities" section={data.liabilities} color="text-red-700" />
          <SectionTable title="Equity" section={data.equity} color="text-green-700" />
          <div className="bg-slate-100 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Total Liabilities & Equity</span>
              <span className="font-bold text-lg">{formatCurrency(data.totalLiabilitiesAndEquity)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Trial Balance ──────────────────────────────────
function TrialBalanceView({ data: rawData }: { data: TrialBalance | null }) {
  if (!rawData) return <EmptyReport />
  const data = rawData
  const grouped = data.accounts.reduce<Record<string, AccountBalance[]>>((acc, a) => {
    const type = a.accountType || 'Other'
    if (!acc[type]) acc[type] = []
    acc[type].push(a)
    return acc
  }, {})
  const typeOrder = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE']

  const doExport = () => {
    exportCSV('trial_balance.csv',
      ['Account Code', 'Account Name', 'Type', 'Debit', 'Credit'],
      data.accounts.map(a => [a.accountCode, a.accountName, a.accountType, String(a.totalDebit), String(a.totalCredit)])
    )
  }

  return (
    <div className="space-y-6">
      <CsvButton onClick={doExport} />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card title="Total Debits" value={formatCurrency(data.totals?.totalDebit || 0)} />
        <Card title="Total Credits" value={formatCurrency(data.totals?.totalCredit || 0)} />
        <Card title="Balance" value={formatCurrency(data.totals?.totalBalance || 0)} color={data.totals?.totalBalance === 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left py-2.5 px-4 font-medium text-slate-600">Code</th>
              <th className="text-left py-2.5 px-4 font-medium text-slate-600">Account</th>
              <th className="text-right py-2.5 px-4 font-medium text-slate-600">Debit</th>
              <th className="text-right py-2.5 px-4 font-medium text-slate-600">Credit</th>
            </tr>
          </thead>
          <tbody>
            {typeOrder.map(type => {
              const accounts = grouped[type]
              if (!accounts?.length) return null
              const typeLabel = type.charAt(0) + type.slice(1).toLowerCase()
              const typeDebit = accounts.reduce((s, a) => s + a.totalDebit, 0)
              const typeCredit = accounts.reduce((s, a) => s + a.totalCredit, 0)
              return (
                <Fragment key={type}>
                  <tr className="bg-slate-100">
                    <td colSpan={4} className="py-2 px-4 font-semibold text-slate-700">{typeLabel}</td>
                  </tr>
                  {accounts.map(a => (
                    <tr key={a.accountId} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-4 text-slate-500">{a.accountCode}</td>
                      <td className="py-2 px-4">{a.accountName}</td>
                      <td className="py-2 px-4 text-right">{a.totalDebit > 0 ? formatCurrency(a.totalDebit) : ''}</td>
                      <td className="py-2 px-4 text-right">{a.totalCredit > 0 ? formatCurrency(a.totalCredit) : ''}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-medium border-b border-slate-200">
                    <td colSpan={2} className="py-2 px-4 text-slate-600">Total {typeLabel}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(typeDebit)}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(typeCredit)}</td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold text-base">
              <td colSpan={2} className="py-3 px-4">Totals</td>
              <td className="py-3 px-4 text-right">{formatCurrency(data.totals?.totalDebit || 0)}</td>
              <td className="py-3 px-4 text-right">{formatCurrency(data.totals?.totalCredit || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
