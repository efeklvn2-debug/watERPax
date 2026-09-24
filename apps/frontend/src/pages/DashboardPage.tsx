import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { useAuthStore } from '../stores/authStore'
import { reportsApi } from '../api/reports'

interface DashboardData {
  fgAvailable: { packs: number; value: number }
  todayProduction: { packs: number; runs: number }
  todaySales: { packs: number; value: number }
  lowRaw: { count: number; items: { code: string; name: string; unit: string; stock: number; minStock: number }[] }
  recentBatches: { runNumber: string; variant: string; product: string; batchNumber: string; packs: number; completedAt: string; unitCost: number }[]
}

function money(value: number | undefined | null) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function DashboardPage() {
  const navigate = useNavigate()
  const notify = useNotification()
  const currentUser = useAuthStore(s => s.user)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    if (currentUser?.role === 'SUPER_ADMIN') {
      navigate('/platform', { replace: true })
    }
  }, [currentUser, navigate])

  useEffect(() => {
    // SUPER_ADMIN has no tenant and logged-out mounts have no session:
    // either way there is nothing to fetch (kills pre-login 401 noise).
    if (currentUser?.role === 'SUPER_ADMIN' || !isAuthenticated) {
      setLoading(false)
      return
    }
    let mounted = true
    reportsApi.getDashboard().then(res => {
      if (!mounted) return
      if (res.error) {
        notify.error(res.error.message)
      } else {
        const value: any = (res.data as any)?.data ?? res.data
        if (value) setData(value)
      }
      setLoading(false)
    })
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SUPER_ADMIN is redirected to /platform by the effect above; render
  // nothing meanwhile so no tenant UI flashes before navigation.
  if (currentUser?.role === 'SUPER_ADMIN') return null

  const cards = data ? [
    { label: 'FG Available', value: `${data.fgAvailable.packs.toLocaleString()} packs`, sub: money(data.fgAvailable.value), path: '/inventory', tone: 'blue' },
    { label: 'Today Production', value: `${data.todayProduction.packs.toLocaleString()} packs`, sub: `${data.todayProduction.runs} runs`, path: '/production', tone: 'green' },
    { label: 'Today Sales', value: money(data.todaySales.value), sub: `${data.todaySales.packs.toLocaleString()} packs`, path: '/sales', tone: 'indigo' },
    { label: 'Low Raw Materials', value: String(data.lowRaw.count), sub: data.lowRaw.count > 0 ? 'needs restocking' : 'all stocked', path: '/inventory', tone: data.lowRaw.count > 0 ? 'red' : 'slate' }
  ] : []

  const toneBg: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-500'
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">Make-to-stock overview</p>
          </div>
          <button
            onClick={() => {
              setLoading(true)
              reportsApi.getDashboard().then(res => {
                const value: any = (res.data as any)?.data ?? res.data
                if (res.error) notify.error(res.error.message)
                else if (value) setData(value)
                setLoading(false)
              })
            }}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            {loading ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-1/2 mb-3" />
                <div className="h-8 bg-slate-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-slate-200 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {cards.map(c => (
                <div key={c.label} className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(c.path)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">{c.label}</p>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{c.value}</p>
                      <p className="text-sm text-slate-500 mt-1">{c.sub}</p>
                    </div>
                    <div className={`p-3 rounded-lg ${toneBg[c.tone] || toneBg.slate}`}>
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">Recent Batches</h2>
                  <button onClick={() => navigate('/production')} className="text-sm text-blue-600 hover:text-blue-800 font-medium">View All</button>
                </div>
                {!data || data.recentBatches.length === 0 ? (
                  <div className="px-6 py-8 text-center text-slate-500 text-sm">No completed runs yet</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.recentBatches.map(b => (
                      <div key={b.runNumber} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/production')}>
                        <div>
                          <p className="font-medium text-slate-900">{b.runNumber} · {b.variant}</p>
                          <p className="text-sm text-slate-500">Batch {b.batchNumber} · {b.packs} packs</p>
                        </div>
                        <p className="text-sm text-slate-600">{money(b.unitCost)}/pack</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">Low Raw Materials</h2>
                  <button onClick={() => navigate('/inventory')} className="text-sm text-blue-600 hover:text-blue-800 font-medium">View All</button>
                </div>
                {!data || data.lowRaw.items.length === 0 ? (
                  <div className="px-6 py-8 text-center text-slate-500 text-sm">All materials above minimum stock</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.lowRaw.items.map(m => (
                      <div key={m.code} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/inventory')}>
                        <div>
                          <p className="font-medium text-slate-900">{m.name}</p>
                          <p className="text-sm text-slate-500">{m.code} — {m.stock} / {m.minStock} min {m.unit}</p>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${m.stock <= 0 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          {m.stock <= 0 ? 'Out' : 'Low'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

export { DashboardPage }
