import { useState, useEffect } from 'react'
import { useNotification } from '../contexts/NotificationContext'
import { Layout } from '../components/Layout'
import { authApi, UserListItem, PermissionInfo, UserOverride, RoleInfo } from '../api/auth'
import { auditApi, AuditLogEntry } from '../api/audit'

type Tab = 'users' | 'roles' | 'overrides' | 'activity'

function groupByModule(perms: PermissionInfo[]): Record<string, PermissionInfo[]> {
  return perms.reduce((acc, p) => {
    const mod = p.module || 'other'
    if (!acc[mod]) acc[mod] = []
    acc[mod].push(p)
    return acc
  }, {} as Record<string, PermissionInfo[]>)
}

function formatModuleName(mod: string): string {
  return mod.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function AdminPage() {
  const notify = useNotification()
  const [activeTab, setActiveTab] = useState<Tab>('users')

  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)

  // Edit user modal
  const [editUser, setEditUser] = useState<UserListItem | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [saving, setSaving] = useState(false)

  // Roles tab
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [allPermissions, setAllPermissions] = useState<PermissionInfo[]>([])
  const [selectedRole, setSelectedRole] = useState('')
  const [rolePermIds, setRolePermIds] = useState<string[]>([])
  const [roleLoading, setRoleLoading] = useState(false)

  // Overrides tab
  const [selectedUserId, setSelectedUserId] = useState('')
  const [overrides, setOverrides] = useState<UserOverride[]>([])
  const [overrideLoading, setOverrideLoading] = useState(false)
  const [showAddOverride, setShowAddOverride] = useState(false)
  const [newOverridePermId, setNewOverridePermId] = useState('')
  const [newOverrideGranted, setNewOverrideGranted] = useState(true)

  // Activity tab
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditPage, setAuditPage] = useState(0)
  const [auditFilters, setAuditFilters] = useState({ action: '', entityType: '', userId: '' })
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const pageSize = 50

  useEffect(() => {
    if (activeTab === 'users') loadUsers()
    if (activeTab === 'roles') { loadRoles(); loadAllPermissions() }
    if (activeTab === 'activity') loadAuditLogs(0)
  }, [activeTab])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await authApi.getUsers()
      setUsers(Array.isArray(res.data) ? res.data : (res.data as any)?.data || [])
    } catch (err: any) {
      notify.error(err.message || 'Failed to load users')
    }
    setLoading(false)
  }

  const loadRoles = async () => {
    try {
      const res = await authApi.getRoles()
      setRoles(Array.isArray(res.data) ? res.data : (res.data as any)?.data || [])
    } catch (err: any) {
      notify.error(err.message || 'Failed to load roles')
    }
  }

  const loadAllPermissions = async () => {
    try {
      const res = await authApi.getAllPermissions()
      setAllPermissions(Array.isArray(res.data) ? res.data : (res.data as any)?.data || [])
    } catch (err: any) {
      notify.error(err.message || 'Failed to load permissions')
    }
  }

  const loadRolePermissions = async (role: string) => {
    if (!role) return
    setRoleLoading(true)
    try {
      const res = await authApi.getRolePermissions(role)
      setRolePermIds(Array.isArray(res.data) ? res.data : (res.data as any)?.data || [])
    } catch (err: any) {
      notify.error(err.message || 'Failed to load role permissions')
    }
    setRoleLoading(false)
  }

  const loadOverrides = async (userId: string) => {
    if (!userId) { setOverrides([]); return }
    setOverrideLoading(true)
    try {
      const res = await authApi.getUserPermissionOverrides(userId)
      setOverrides(Array.isArray(res.data) ? res.data : (res.data as any)?.data || [])
    } catch (err: any) {
      notify.error(err.message || 'Failed to load overrides')
    }
    setOverrideLoading(false)
  }

  const loadAuditLogs = async (page: number, filters = auditFilters) => {
    setAuditLoading(true)
    try {
      const res = await auditApi.list({
        ...filters,
        limit: pageSize,
        offset: page * pageSize
      })
      const data = (res.data as any)?.data
      if (data) {
        setAuditLogs(data.items || [])
        setAuditTotal(data.total || 0)
        setAuditPage(page)
      } else {
        const errData = (res as any).error
        notify.error(errData?.message || 'Failed to load audit logs')
      }
    } catch (err: any) {
      notify.error(err.message || 'Failed to load audit logs')
    }
    setAuditLoading(false)
  }

  const applyAuditFilters = () => {
    setExpandedRow(null)
    loadAuditLogs(0, auditFilters)
  }

  const clearAuditFilters = () => {
    const cleared = { action: '', entityType: '', userId: '' }
    setAuditFilters(cleared)
    setExpandedRow(null)
    loadAuditLogs(0, cleared)
  }

  // ── User edit ────────────────────────────────────────────────

  const openEditModal = (u: UserListItem) => {
    setEditUser(u)
    setEditRole(u.role)
    setEditActive(u.isActive)
  }

  const saveUser = async () => {
    if (!editUser) return
    setSaving(true)
    try {
      await authApi.updateUser(editUser.id, { role: editRole, isActive: editActive })
      notify.success('User updated')
      setEditUser(null)
      loadUsers()
    } catch (err: any) {
      notify.error(err.message || 'Failed to update user')
    }
    setSaving(false)
  }

  // ── Role permissions ─────────────────────────────────────────

  const toggleRolePerm = (permId: string) => {
    setRolePermIds(prev =>
      prev.includes(permId) ? prev.filter(id => id !== permId) : [...prev, permId]
    )
  }

  const toggleModule = (module: string) => {
    const ids = (groupedPerms[module] || []).map(p => p.id)
    const allSelected = ids.every(id => rolePermIds.includes(id))
    setRolePermIds(prev => {
      const filtered = prev.filter(id => !ids.includes(id))
      return allSelected ? filtered : [...filtered, ...ids]
    })
  }

  const saveRolePermissions = async () => {
    if (!selectedRole) return
    setSaving(true)
    try {
      await authApi.setRolePermissions(selectedRole, rolePermIds)
      notify.success('Role permissions updated')
      loadRoles()
    } catch (err: any) {
      notify.error(err.message || 'Failed to save role permissions')
    }
    setSaving(false)
  }

  // ── User overrides ────────────────────────────────────────────

  const addOverride = async () => {
    if (!selectedUserId || !newOverridePermId) return
    try {
      const updated = [...overrides.filter(o => o.permissionId !== newOverridePermId), { permissionId: newOverridePermId, granted: newOverrideGranted }]
      await authApi.setUserPermissionOverrides(selectedUserId, updated.map(o => ({ permissionId: o.permissionId, granted: o.granted })))
      notify.success('Override added')
      setShowAddOverride(false)
      setNewOverridePermId('')
      setNewOverrideGranted(true)
      loadOverrides(selectedUserId)
    } catch (err: any) {
      notify.error(err.message || 'Failed to add override')
    }
  }

  const removeOverride = async (permId: string) => {
    if (!selectedUserId) return
    try {
      await authApi.deleteUserPermissionOverride(selectedUserId, permId)
      notify.success('Override removed')
      loadOverrides(selectedUserId)
    } catch (err: any) {
      notify.error(err.message || 'Failed to remove override')
    }
  }

  const groupedPerms = groupByModule(allPermissions)
  const tabLabels: Record<Tab, string> = { users: 'Users', roles: 'Roles', overrides: 'Overrides', activity: 'Activity Log' }

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>

        {/* Tabs */}
        <div className="flex space-x-6 border-b border-slate-200">
          {(Object.keys(tabLabels) as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {/* ── Users Tab ──────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200">
            {loading ? (
              <div className="p-8 text-center text-slate-500">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-slate-500">No users found</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Overrides</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900">{u.username}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{u.role}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{u.overrideCount}</td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => openEditModal(u)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}

        {/* ── Roles Tab ──────────────────────────────────────────── */}
        {activeTab === 'roles' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Role:</label>
              <select
                value={selectedRole}
                onChange={e => { setSelectedRole(e.target.value); loadRolePermissions(e.target.value) }}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="">Select a role...</option>
                {roles.map(r => (
                  <option key={r.role} value={r.role}>{r.role} ({r.permissionCount} perms)</option>
                ))}
              </select>
            </div>

            {selectedRole && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                {roleLoading ? (
                  <div className="py-8 text-center text-slate-500">Loading permissions...</div>
                ) : allPermissions.length === 0 ? (
                  <div className="py-8 text-center text-slate-500">No permissions loaded</div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedPerms).sort().map(([module, perms]) => {
                      const ids = perms.map(p => p.id)
                      const allSelected = ids.every(id => rolePermIds.includes(id))
                      const someSelected = ids.some(id => rolePermIds.includes(id))
                      return (
                        <div key={module} className="bg-slate-50 rounded-lg p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                              onChange={() => toggleModule(module)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <h3 className="text-sm font-bold text-slate-800">
                              {formatModuleName(module)}
                            </h3>
                            <span className="text-xs text-slate-400">
                              ({perms.filter(p => rolePermIds.includes(p.id)).length}/{perms.length})
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {perms.map(p => (
                              <label key={p.id} className="flex items-center gap-2 p-2 rounded hover:bg-white cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={rolePermIds.includes(p.id)}
                                  onChange={() => toggleRolePerm(p.id)}
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-700">{p.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    <div className="pt-4 border-t border-slate-200 flex justify-end">
                      <button
                        onClick={saveRolePermissions}
                        disabled={saving}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save Permissions'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Overrides Tab ──────────────────────────────────────── */}
        {activeTab === 'overrides' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">User:</label>
              <select
                value={selectedUserId}
                onChange={e => { setSelectedUserId(e.target.value); loadOverrides(e.target.value) }}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm min-w-[200px]"
              >
                <option value="">Select a user...</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                ))}
              </select>
            </div>

            {selectedUserId && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-slate-800">Permission Overrides</h3>
                  <button
                    onClick={() => setShowAddOverride(true)}
                    className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                  >
                    + Add Override
                  </button>
                </div>
                {overrideLoading ? (
                  <div className="p-8 text-center text-slate-500">Loading overrides...</div>
                ) : overrides.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">No overrides for this user</div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Permission</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrides.map(o => (
                        <tr key={o.id} className="border-b border-slate-100">
                          <td className="px-6 py-4 text-sm text-slate-900">{o.permissionName}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${o.granted ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {o.granted ? 'Granted' : 'Denied'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => removeOverride(o.permissionId)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Activity Log Tab ──────────────────────────────────── */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Action</label>
                  <input
                    type="text"
                    value={auditFilters.action}
                    onChange={e => setAuditFilters({ ...auditFilters, action: e.target.value })}
                    placeholder="e.g. sales_order.approve"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Entity Type</label>
                  <input
                    type="text"
                    value={auditFilters.entityType}
                    onChange={e => setAuditFilters({ ...auditFilters, entityType: e.target.value })}
                    placeholder="e.g. SalesOrder"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">User ID</label>
                  <input
                    type="text"
                    value={auditFilters.userId}
                    onChange={e => setAuditFilters({ ...auditFilters, userId: e.target.value })}
                    placeholder="exact user id"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={applyAuditFilters}
                    className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Apply
                  </button>
                  <button
                    onClick={clearAuditFilters}
                    className="px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
              {auditLoading ? (
                <div className="p-8 text-center text-slate-500">Loading audit logs...</div>
              ) : auditLogs.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No audit entries found</div>
              ) : (
                <>
                  <div className="p-4 border-b border-slate-200 text-sm text-slate-600">
                    Showing {auditLogs.length} of {auditTotal} entries
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Timestamp</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Action</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Entity</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map(log => {
                        const isExpanded = expandedRow === log.id
                        return (
                          <>
                            <tr
                              key={log.id}
                              className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${isExpanded ? 'bg-slate-50' : ''}`}
                              onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                            >
                              <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700">{log.username || '—'}</td>
                              <td className="px-4 py-3 text-xs font-mono text-slate-700">{log.action}</td>
                              <td className="px-4 py-3 text-sm text-slate-700 max-w-md truncate" title={log.description}>
                                {log.description}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                                {log.entityType}{log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-400">{log.ipAddress || '—'}</td>
                            </tr>
                            {isExpanded && log.metadata && (
                              <tr key={`${log.id}-meta`} className="bg-slate-50">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="text-xs text-slate-500 mb-1 font-medium">Metadata:</div>
                                  <pre className="text-xs bg-white border border-slate-200 rounded p-3 overflow-auto max-h-48">
                                    {JSON.stringify(log.metadata, null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                  {/* Pagination */}
                  <div className="p-4 border-t border-slate-200 flex items-center justify-between">
                    <button
                      onClick={() => loadAuditLogs(auditPage - 1)}
                      disabled={auditPage === 0}
                      className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-40"
                    >
                      ← Prev
                    </button>
                    <span className="text-sm text-slate-600">
                      Page {auditPage + 1} of {Math.max(1, Math.ceil(auditTotal / pageSize))}
                    </span>
                    <button
                      onClick={() => loadAuditLogs(auditPage + 1)}
                      disabled={(auditPage + 1) * pageSize >= auditTotal}
                      className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-40"
                    >
                      Next →
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Edit User Modal ────────────────────────────────────── */}
        {editUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit User — {editUser.username}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={e => setEditActive(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="text-sm text-slate-700">Active</label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setEditUser(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200">
                  Cancel
                </button>
                <button
                  onClick={saveUser}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Add Override Modal ─────────────────────────────────── */}
        {showAddOverride && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Permission Override</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Permission</label>
                  <select
                    value={newOverridePermId}
                    onChange={e => setNewOverridePermId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="">Select a permission...</option>
                    {allPermissions.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={newOverrideGranted}
                    onChange={e => setNewOverrideGranted(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="text-sm text-slate-700">Granted (uncheck = denied)</label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAddOverride(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200">
                  Cancel
                </button>
                <button
                  onClick={addOverride}
                  disabled={!newOverridePermId}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}