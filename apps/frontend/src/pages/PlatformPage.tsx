import { useState } from 'react'
import { useNotification } from '../contexts/NotificationContext'
import { Layout } from '../components/Layout'
import { platformApi, Tenant, TenantDetail } from '../api/platform'
import { useCachedFetch } from '../hooks/useCachedFetch'
import { useMutationGuard } from '../hooks/useMutationGuard'

export function PlatformPage() {
  const notify = useNotification()
  const { data: tenants, loading, refetch: loadTenants } = useCachedFetch<Tenant[]>('platform:tenants', async () => {
    const res = await platformApi.listTenants()
    return Array.isArray(res.data) ? res.data : (res.data as any)?.data || []
  })
  const { run } = useMutationGuard()

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // Create tenant modal
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [creating, setCreating] = useState(false)

  // Create user modal
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [selectedTenantName, setSelectedTenantName] = useState('')
  const [userUsername, setUserUsername] = useState('')
  const [userPassword, setUserPassword] = useState('')
  const [userRole, setUserRole] = useState<'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'>('ADMIN')
  const [creatingUser, setCreatingUser] = useState(false)

  // Toggle active confirmation
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; name: string; newActive: boolean } | null>(null)
  const [toggling, setToggling] = useState(false)

  // Delete tenant confirmation
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Tenant detail modal
  const [showDetail, setShowDetail] = useState(false)
  const [detailData, setDetailData] = useState<TenantDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const handleCreate = async () => {
    await run(async () => {
      setShowCreate(false)
      setCreateName('')
      setCreateSlug('')
      setCreating(true)
      try {
        const res = await platformApi.createTenant({ name: createName, slug: createSlug })
        if (res.error) { notify.error(res.error.message); return }
        notify.success('Tenant created successfully')
        loadTenants()
      } catch (err: any) {
        notify.error(err.message || 'Failed to create tenant')
      }
      setCreating(false)
    })
  }

  const handleCreateUser = async () => {
    await run(async () => {
      setShowCreateUser(false)
      setUserUsername('')
      setUserPassword('')
      setUserRole('ADMIN')
      setCreatingUser(true)
      try {
        const res = await platformApi.createTenantUser(selectedTenantId, { username: userUsername, password: userPassword, role: userRole })
        if (res.error) { notify.error(res.error.message); setCreatingUser(false); return }
        notify.success('User created successfully')
        setCreatingUser(false)
        loadTenants()
      } catch (err: any) {
        notify.error(err.message || 'Failed to create user')
        setCreatingUser(false)
      }
    })
  }

  const handleToggleActive = async () => {
    if (!confirmToggle) return
    await run(async () => {
      const toggle = confirmToggle
      setConfirmToggle(null)
      setToggling(true)
      try {
        const res = await platformApi.updateTenant(toggle.id, { isActive: toggle.newActive })
        if (res.error) { notify.error(res.error.message); return }
        notify.success(`Tenant ${toggle.newActive ? 'activated' : 'deactivated'} successfully`)
        loadTenants()
      } catch (err: any) {
        notify.error(err.message || 'Failed to update tenant')
      }
      setToggling(false)
    })
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    await run(async () => {
      const toDelete = confirmDelete
      setConfirmDelete(null)
      setDeleting(true)
      try {
        const res = await platformApi.deleteTenant(toDelete.id)
        if (res.error) { notify.error(res.error.message); setDeleting(false); return }
        notify.success(`Tenant "${toDelete.name}" deleted permanently`)
        loadTenants()
      } catch (err: any) {
        notify.error(err.message || 'Failed to delete tenant')
      }
      setDeleting(false)
    })
  }

  const openCreateUser = (tenant: Tenant) => {
    setSelectedTenantId(tenant.id)
    setSelectedTenantName(tenant.name)
    setShowCreateUser(true)
  }

  const openDetail = async (tenant: Tenant) => {
    setDetailLoading(true)
    setShowDetail(true)
    try {
      const res = await platformApi.getTenant(tenant.id)
      setDetailData(Array.isArray(res.data) ? null : (res.data as any)?.data || res.data as any)
    } catch (err: any) {
      notify.error(err.message || 'Failed to load tenant details')
      setShowDetail(false)
    }
    setDetailLoading(false)
  }

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!detailData) return
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setDetailData({
      ...detailData,
      users: detailData.users.filter(u => u.id !== userId),
    })
    try {
      await platformApi.deleteTenantUser(detailData.id, userId)
      notify.success(`User "${username}" deleted`)
    } catch (err: any) {
      notify.error(err.message || 'Failed to delete user — refresh to see current state')
    }
  }

  const slugFromName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const formatDate = (d: string) => new Date(d).toLocaleDateString()

  const filteredTenants = (tenants ?? []).filter(t => {
    if (statusFilter === 'active' && !t.isActive) return false
    if (statusFilter === 'inactive' && t.isActive) return false
    if (search) {
      const q = search.toLowerCase()
      if (!t.name.toLowerCase().includes(q) && !t.slug.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Platform Management</h1>
            <p className="text-sm text-slate-500 mt-1">Super admin — manage all tenants</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            + New Tenant
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or slug..." className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-64" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="text-xs text-slate-400">{filteredTenants.length} of {tenants?.length ?? 0} shown</span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading tenants...</div>
        ) : filteredTenants.length === 0 ? (
          <div className="text-center py-12 text-slate-400">No tenants match the current filters.</div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Users</th>
                  <th className="px-4 py-3 text-center">Orders</th>
                  <th className="px-4 py-3 text-center">Customers</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTenants.map(t => (
                  <tr key={t.id} className={`hover:bg-slate-50 ${!t.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{t.slug}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{t.userCount ?? 0}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{t.salesOrderCount ?? 0}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{t.customerCount ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{formatDate(t.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openDetail(t)} className="px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors">View</button>
                        <button onClick={() => openCreateUser(t)} disabled={!t.isActive} title={!t.isActive ? 'Tenant is inactive' : 'Add user'} className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed">+ User</button>
                        <button onClick={() => setConfirmToggle({ id: t.id, name: t.name, newActive: !t.isActive })} className={`px-2 py-1 text-xs font-medium rounded transition-colors ${t.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                          {t.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => setConfirmDelete({ id: t.id, name: t.name })} className="px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 rounded transition-colors">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* Create Tenant Modal */}
      {showCreate && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-slate-800 mb-4">Create New Tenant</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tenant Name</label>
              <input type="text" value={createName} onChange={e => { setCreateName(e.target.value); setCreateSlug(slugFromName(e.target.value)) }} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="e.g. ACME Prints Ltd" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Slug</label>
              <input type="text" value={createSlug} onChange={e => setCreateSlug(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="e.g. acme-prints" />
              <p className="text-xs text-slate-400 mt-1">Lowercase letters, numbers, hyphens. Used in URLs and references.</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={creating || !createName || !createSlug} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">{creating ? 'Creating...' : 'Create Tenant'}</button>
          </div>
        </div>
      </div>}

      {/* Create User Modal */}
      {showCreateUser && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreateUser(false)}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-slate-800 mb-1">Add User</h2>
          <p className="text-sm text-slate-500 mb-4">for <span className="font-medium text-slate-700">{selectedTenantName}</span></p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <input type="text" value={userUsername} onChange={e => setUserUsername(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="e.g. jane@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={userPassword} onChange={e => setUserPassword(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="Min 8 chars, 1 uppercase, 1 number" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={userRole} onChange={e => setUserRole(e.target.value as any)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="ADMIN">Admin</option>
                <option value="MANAGER">Manager</option>
                <option value="OPERATOR">Operator</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setShowCreateUser(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleCreateUser} disabled={creatingUser || !userUsername || !userPassword} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">{creatingUser ? 'Creating...' : 'Add User'}</button>
          </div>
        </div>
      </div>}

      {/* Toggle Active Confirmation */}
      {confirmToggle && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setConfirmToggle(null)}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-slate-800 mb-2">{confirmToggle.newActive ? 'Activate' : 'Deactivate'} Tenant</h2>
          <p className="text-sm text-slate-600 mb-6">Are you sure you want to {confirmToggle.newActive ? 'activate' : 'deactivate'} <span className="font-semibold">{confirmToggle.name}</span>?{!confirmToggle.newActive ? ' Users of this tenant will not be able to log in.' : ''}</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirmToggle(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleToggleActive} disabled={toggling} className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40 transition-colors ${confirmToggle.newActive ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {toggling ? 'Updating...' : confirmToggle.newActive ? 'Activate' : 'Deactivate'}
            </button>
          </div>
        </div>
      </div>}

      {/* Tenant Detail Modal */}
      {showDetail && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowDetail(false)}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          {detailLoading ? (
            <div className="text-center py-12 text-slate-400">Loading tenant details...</div>
          ) : detailData ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{detailData.name}</h2>
                  <p className="text-sm text-slate-500">Slug: {detailData.slug}</p>
                </div>
                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${detailData.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {detailData.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{detailData._count.salesOrders}</div>
                  <div className="text-xs text-slate-500">Orders</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{detailData._count.customers}</div>
                  <div className="text-xs text-slate-500">Customers</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{detailData._count.materials}</div>
                  <div className="text-xs text-slate-500">Materials</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{detailData._count.productionJobs}</div>
                  <div className="text-xs text-slate-500">Production Jobs</div>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-slate-700 mb-3">Users ({detailData.users.length})</h3>
              {detailData.users.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No users for this tenant.</p>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-2">Username</th>
                      <th className="pb-2">Role</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Created</th>
                      <th className="pb-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailData.users.map(u => (
                      <tr key={u.id} className="text-sm">
                        <td className="py-2 pr-2 text-slate-800">{u.username}</td>
                        <td className="py-2 pr-2">
                          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                            {u.role}
                          </span>
                        </td>
                        <td className="py-2 pr-2">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-slate-500">{formatDate(u.createdAt)}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => handleDeleteUser(u.id, u.username)} className="px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}

              <div className="flex justify-end mt-6">
                <button onClick={() => setShowDetail(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Close</button>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-slate-400">Failed to load tenant details.</div>
          )}
        </div>
      </div>}

      {/* Delete Tenant Confirmation */}
      {confirmDelete && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setConfirmDelete(null)}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-red-700 mb-2">Delete Tenant</h2>
          <p className="text-sm text-slate-600 mb-2">Are you sure you want to permanently delete <span className="font-semibold">{confirmDelete.name}</span>?</p>
          <p className="text-xs text-red-600 mb-6">This will permanently delete ALL data for this tenant — orders, customers, materials, production jobs, invoices, payments, accounts, users, etc. This action cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors">
              {deleting ? 'Deleting...' : 'Permanently Delete'}
            </button>
          </div>
        </div>
      </div>}
    </Layout>
  )
}
