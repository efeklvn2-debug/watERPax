import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { NotificationProvider } from './contexts/NotificationContext'
import { Toast } from './components/Toast'
import { useAuthStore, hasPermission } from './stores/authStore'

const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const CustomersPage = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })))
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage').then(m => ({ default: m.CustomerDetailPage })))
const ProcurementPage = lazy(() => import('./pages/ProcurementPage').then(m => ({ default: m.ProcurementPage })))
const ProductionPage = lazy(() => import('./pages/ProductionPage').then(m => ({ default: m.ProductionPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const FinancePage = lazy(() => import('./pages/FinancePage').then(m => ({ default: m.FinancePage })))
const SalesPage = lazy(() => import('./pages/SalesPage').then(m => ({ default: m.SalesPage })))
const ProductsPage = lazy(() => import('./pages/ProductsPage').then(m => ({ default: m.ProductsPage })))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then(m => ({ default: m.SuppliersPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })))
const PlatformPage = lazy(() => import('./pages/PlatformPage').then(m => ({ default: m.PlatformPage })))
const GuideAngelPage = lazy(() => import('./pages/GuideAngelPage').then(m => ({ default: m.GuideAngelPage })))

function ProtectedRoute({ children, requiredPermissions, requiredRole }: { children: React.ReactNode; requiredPermissions?: string[]; requiredRole?: string }) {
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { isAuthenticated, checkAuth, refreshSession } = useAuthStore.getState()
    // Always revalidate: when already logged in, refresh user + permissions
    // (permissions granted after login would otherwise stay stale in localStorage).
    ;(isAuthenticated ? refreshSession() : checkAuth())
      .finally(() => {
        setOk(useAuthStore.getState().isAuthenticated)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  if (!ok) {
    return <Navigate to="/login" replace />
  }

  if (requiredPermissions && !requiredPermissions.every(p => hasPermission(p))) {
    return <Navigate to="/" replace />
  }

  if (requiredRole) {
    const userRole = useAuthStore.getState().user?.role
    if (userRole !== requiredRole) {
      return <Navigate to="/" replace />
    }
  }

  return <>{children}</>
}

function App() {
  return (
    <NotificationProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Loading...</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/inventory" element={<ProtectedRoute requiredPermissions={['inventory:read']}><InventoryPage /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute requiredPermissions={['customer:read']}><CustomersPage /></ProtectedRoute>} />
          <Route path="/customers/:customerId" element={<ProtectedRoute requiredPermissions={['customer:read']}><CustomerDetailPage /></ProtectedRoute>} />
          <Route path="/procurement" element={<ProtectedRoute requiredPermissions={['procurement:read']}><ProcurementPage /></ProtectedRoute>} />
          <Route path="/production" element={<ProtectedRoute requiredPermissions={['production:read']}><ProductionPage /></ProtectedRoute>} />
          <Route path="/finance" element={<ProtectedRoute requiredPermissions={['finance:read']}><FinancePage /></ProtectedRoute>} />
          <Route path="/sales" element={<ProtectedRoute requiredPermissions={['sales:read']}><SalesPage /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute requiredPermissions={['product:read']}><ProductsPage /></ProtectedRoute>} />
          <Route path="/suppliers" element={<ProtectedRoute requiredPermissions={['supplier:read']}><SuppliersPage /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute requiredPermissions={['report:read']}><ReportsPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute requiredPermissions={['auth:manage_users']}><AdminPage /></ProtectedRoute>} />
          <Route path="/platform" element={<ProtectedRoute requiredRole="SUPER_ADMIN"><PlatformPage /></ProtectedRoute>} />
          <Route path="/guide-angel" element={<ProtectedRoute requiredPermissions={['auth:manage_users']}><GuideAngelPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredPermissions={['settings:read']}><SettingsPage /></ProtectedRoute>} />
          <Route path="/*" element={<ProtectedRoute><Routes><Route path="/" element={<DashboardPage />} /></Routes></ProtectedRoute>} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      <Toast />
    </NotificationProvider>
  )
}

export default App
