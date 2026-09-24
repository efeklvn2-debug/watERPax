import { useState, useEffect, useRef } from 'react'
import { settingsApi, InvoiceSettings } from '../api/settings'
import { pricingApi, MaterialWithPrice } from '../api/pricing'
import { inventoryApi, MaterialCategory } from '../api/inventory'
import { Layout } from '../components/Layout'
import { useNotification } from '../contexts/NotificationContext'
import { useMutationGuard } from '../hooks/useMutationGuard'

type SettingsTab = 'products' | 'overhead' | 'vat' | 'invoice' | 'tax'

export function SettingsPage() {
  const notify = useNotification()
  const { run } = useMutationGuard()
  const [activeTab, setActiveTab] = useState<SettingsTab>('products')
  const [overheadRate, setOverheadRate] = useState(0)
  const [overheadHistory, setOverheadHistory] = useState<{month: string; ratePerKg: number; createdAt: Date}[]>([])
  const [vatRate, setVatRate] = useState(7.5)
  const [businessTin, setBusinessTin] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [citRate, setCitRate] = useState(30)
  const [vatFilingFrequency, setVatFilingFrequency] = useState<'monthly' | 'quarterly'>('monthly')
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Products & Pricing state
  const [materials, setMaterials] = useState<MaterialWithPrice[]>([])
  const [showMaterialModal, setShowMaterialModal] = useState(false)
  const [showPriceModal, setShowPriceModal] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialWithPrice | null>(null)

  const [showArchived, setShowArchived] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState<MaterialWithPrice | null>(null)

  const [materialForm, setMaterialForm] = useState({
    name: '',
    code: '',
    category: 'RAW_MATERIAL' as MaterialCategory,
    costPrice: 0,
    minStock: 0,
    unitOfMeasure: 'kg'
  })
  const codeManuallyEdited = useRef(false)

  const [priceForm, setPriceForm] = useState({
    costPrice: 0,
    minStock: 0
  })

  useEffect(() => {
    loadSettings()
    loadMaterials(false)
    loadOverheadRate()
  }, [])

  useEffect(() => {
    if (showMaterialModal) {
      codeManuallyEdited.current = false
    }
  }, [showMaterialModal])

  useEffect(() => {
    if (materialForm.name && !codeManuallyEdited.current) {
      const autoCode = materialForm.name
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 5)
      setMaterialForm(prev => ({ ...prev, code: autoCode }))
    }
  }, [materialForm.name])

  const loadOverheadRate = async () => {
    try {
      const [rateRes, historyRes, settingsRes] = await Promise.all([
        settingsApi.getOverheadRate(),
        settingsApi.getOverheadRateHistory(),
        settingsApi.getSettings()
      ])
      const rate = (rateRes.data as any)?.data ?? rateRes.data
      console.log('loadOverheadRate:', rate)
      setOverheadRate(typeof rate === 'number' ? rate : 0)
      const historyData = (historyRes.data as any)?.data ?? historyRes.data ?? []
      setOverheadHistory(historyData.map((h: any) => ({
        month: h.month,
        ratePerKg: Number(h.ratePerKg),
        createdAt: new Date(h.createdAt)
      })))
      const settingsData = (settingsRes.data as any)?.data ?? settingsRes.data
      if (settingsData) {
        setVatRate(Number(settingsData.vatRate) || 7.5)
        setBusinessTin(settingsData.businessTin || '')
        setBusinessAddress(settingsData.businessAddress || '')
        setCitRate(Number(settingsData.citRate) || 30)
        setVatFilingFrequency(settingsData.vatFilingFrequency || 'monthly')
        setInvoiceSettings({
          invoiceCompanyName: settingsData.invoiceCompanyName || '',
          invoiceLogoUrl: settingsData.invoiceLogoUrl || '',
          invoicePrimaryColor: settingsData.invoicePrimaryColor || '#1e3a5f',
          invoiceAccentColor: settingsData.invoiceAccentColor || '#dc2626',
          invoiceFooter: settingsData.invoiceFooter || 'Thank you for your business!',
          receiptCompanyName: settingsData.receiptCompanyName || settingsData.invoiceCompanyName || '',
          receiptLogoUrl: settingsData.receiptLogoUrl || '',
          receiptFooter: settingsData.receiptFooter || settingsData.invoiceFooter || 'Thank you for your business!'
        })
      }
    } catch (err) {
      notify.error('Failed to load overhead rate')
    }
  }

const loadSettings = async () => {
    setLoading(true)
    try {
      await settingsApi.getSettings()
    } catch (err: any) {
      notify.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const loadMaterials = async (includeArchived?: boolean) => {
    try {
      const include = includeArchived !== undefined ? includeArchived : showArchived
      const res = await pricingApi.getMaterialsWithPrices(include)
      const data = Array.isArray(res.data) ? res.data : (res.data as any)?.data || []
      setMaterials(data)
    } catch (err: any) {
      notify.error('Failed to load materials')
    }
  }

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault()
    await run(async () => {
      setShowMaterialModal(false)
      setMaterialForm({ name: '', code: '', category: 'RAW_MATERIAL' as MaterialCategory, costPrice: 0, minStock: 0, unitOfMeasure: 'pcs' })
      setSaving(true)

      try {
        const res = await inventoryApi.createMaterial({
          name: materialForm.name,
          code: materialForm.code,
          category: materialForm.category,
          costPrice: materialForm.costPrice || undefined,
          unitOfMeasure: materialForm.unitOfMeasure,
          minStock: materialForm.minStock || 0
        })
        
        if (res.error) {
          notify.error(res.error.message)
        } else {
          loadMaterials()
          notify.success('Material created successfully')
        }
      } catch (err: any) {
        notify.error(err.message)
      }
      setSaving(false)
    })
  }

  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault()
    await run(async () => {
      setShowPriceModal(false)
      setSaving(true)

      try {
        // Save cost price + minStock using inventoryApi
        await inventoryApi.updateMaterial(selectedMaterial!.id, {
          costPrice: priceForm.costPrice || undefined,
          minStock: priceForm.minStock || 0
        })

        loadMaterials()
        notify.success('Prices updated successfully')
      } catch (err: any) {
        notify.error(err.message)
      }
      setSaving(false)
    })
  }

  const openPriceModal = (material: MaterialWithPrice) => {
    setSelectedMaterial(material)
    setPriceForm({
      costPrice: material.costPrice || 0,
      minStock: material.minStock || 0
    })
    setShowPriceModal(true)
  }

  const handleArchive = async (material: MaterialWithPrice) => {
    await run(async () => {
      setArchiveConfirm(null)
      setSaving(true)
      try {
        await inventoryApi.archiveMaterial(material.id)
        loadMaterials()
        notify.success(`${material.name} archived`)
      } catch (err: any) {
        notify.error(err.message)
      }
      setSaving(false)
    })
  }

  const handleRestore = async (material: MaterialWithPrice) => {
    await run(async () => {
      setSaving(true)
      try {
        await inventoryApi.restoreMaterial(material.id)
        loadMaterials()
        notify.success(`${material.name} restored`)
      } catch (err: any) {
        notify.error(err.message)
      }
      setSaving(false)
    })
  }

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12">Loading...</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Configure system settings, products and pricing</p>
        </div>

        <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'products' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Products & Pricing
          </button>
          <button
            onClick={() => setActiveTab('overhead')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'overhead' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Overhead
          </button>
          <button
            onClick={() => setActiveTab('vat')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'vat' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            VAT
          </button>
          <button
            onClick={() => setActiveTab('invoice')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'invoice' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Invoices/Receipts
          </button>
          <button
            onClick={() => setActiveTab('tax')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'tax' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tax
          </button>
        </div>

        {activeTab === 'products' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Materials & Prices</h2>
              <button
                onClick={() => setShowMaterialModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Add Material
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={() => {
                      const next = !showArchived
                      setShowArchived(next)
                      loadMaterials(next)
                    }}
                    className="rounded border-slate-300"
                  />
                  Show archived
                </label>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
              <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Cost Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {materials.map(m => (
                    <tr key={m.id} className={`hover:bg-slate-50 ${m.isActive === false ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {m.name}
                        {m.isActive === false && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-slate-200 text-slate-500">archived</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          m.category === 'RAW_MATERIAL' ? 'bg-blue-100 text-blue-800' :
                          m.category === 'PACKAGING' ? 'bg-purple-100 text-purple-800' :
                          'bg-orange-100 text-orange-800'
                        }`}>
                          {m.category.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">
                        {m.costPrice ? `₦${m.costPrice.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openPriceModal(m)}
                            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                          >
                            Edit
                          </button>
                          {m.isActive === false ? (
                            <button
                              onClick={() => handleRestore(m)}
                              className="text-green-600 hover:text-green-700 text-sm font-medium"
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              onClick={() => setArchiveConfirm(m)}
                              className="text-red-600 hover:text-red-700 text-sm font-medium"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {materials.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No materials found. Click "Add Material" to create one.
                      </td>
                    </tr>
                  )}
                  </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vat' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">VAT Settings</h2>
            <p className="text-sm text-slate-500 mb-6">
              Configure VAT rate and business details. Prices are VAT-inclusive — the system will automatically decompose amounts for accounting.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                await run(async () => {
                  setSaving(true)
                  try {
                    const res = await settingsApi.updateVatSettings({ vatRate, businessTin, businessAddress })
                    if (res.error) { notify.error(res.error.message || 'Failed to update'); return }
                    notify.success('VAT settings updated successfully')
                  } catch (err: any) {
                    notify.error(err.message || 'Failed to update')
                  } finally {
                    setSaving(false)
                  }
                })
              }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT Rate (%)</label>
                  <input
                    type="number"
                    value={vatRate}
                    onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Business TIN <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={businessTin}
                    onChange={e => setBusinessTin(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    placeholder="Enter Tax Identification Number"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Business Address <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={businessAddress}
                  onChange={e => setBusinessAddress(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="Enter business address for invoices"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save VAT Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'tax' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Tax Settings</h2>
            <p className="text-sm text-slate-500 mb-6">
              Configure Nigerian tax rates and filing frequency. These settings power the Tax Filing tab in Finance.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                await run(async () => {
                  setSaving(true)
                  try {
                    const res = await settingsApi.updateSettings({ citRate, vatFilingFrequency })
                    if (res.error) { notify.error(res.error.message || 'Failed to update'); return }
                    notify.success('Tax settings updated successfully')
                  } catch (err: any) {
                    notify.error(err.message || 'Failed to update')
                  } finally {
                    setSaving(false)
                  }
                })
              }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">CIT Rate (%)</label>
                  <input
                    type="number"
                    value={citRate}
                    onChange={e => setCitRate(parseFloat(e.target.value) || 0)}
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">Companies Income Tax rate (default: 30%)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT Filing Frequency</label>
                  <select
                    value={vatFilingFrequency}
                    onChange={e => setVatFilingFrequency(e.target.value as 'monthly' | 'quarterly')}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Tax Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'invoice' && (
          <div className="space-y-6">
            {/* ---------- Invoice Settings ---------- */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Invoice Customization</h2>
              <p className="text-sm text-slate-500 mb-6">
                Customize the look and feel of your invoice PDFs.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                  <input
                    type="text"
                    value={invoiceSettings.invoiceCompanyName || ''}
                    onChange={e => setInvoiceSettings({ ...invoiceSettings, invoiceCompanyName: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    placeholder="Your Company Name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Logo <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        setInvoiceSettings({ ...invoiceSettings, invoiceLogoUrl: reader.result as string })
                      }
                      reader.readAsDataURL(file)
                    }}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
                  />
                  {invoiceSettings.invoiceLogoUrl ? (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={invoiceSettings.invoiceLogoUrl} alt="Logo preview" className="h-12 object-contain" />
                      <button
                        type="button"
                        onClick={() => setInvoiceSettings({ ...invoiceSettings, invoiceLogoUrl: '' })}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 mt-1">Upload a logo image from your computer</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Primary Color</label>
                  <div className="flex space-x-2">
                    <input
                      type="color"
                      value={invoiceSettings.invoicePrimaryColor || '#1e3a5f'}
                      onChange={e => setInvoiceSettings({ ...invoiceSettings, invoicePrimaryColor: e.target.value })}
                      className="w-10 h-10 p-0.5 border border-slate-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={invoiceSettings.invoicePrimaryColor || ''}
                      onChange={e => setInvoiceSettings({ ...invoiceSettings, invoicePrimaryColor: e.target.value })}
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg font-mono"
                      placeholder="#1e3a5f"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Accent Color</label>
                  <div className="flex space-x-2">
                    <input
                      type="color"
                      value={invoiceSettings.invoiceAccentColor || '#dc2626'}
                      onChange={e => setInvoiceSettings({ ...invoiceSettings, invoiceAccentColor: e.target.value })}
                      className="w-10 h-10 p-0.5 border border-slate-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={invoiceSettings.invoiceAccentColor || ''}
                      onChange={e => setInvoiceSettings({ ...invoiceSettings, invoiceAccentColor: e.target.value })}
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg font-mono"
                      placeholder="#dc2626"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Footer Text <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={invoiceSettings.invoiceFooter || ''}
                  onChange={e => setInvoiceSettings({ ...invoiceSettings, invoiceFooter: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="Thank you for your business!"
                />
              </div>
            </div>

            {/* ---------- Receipt Settings ---------- */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Receipt Customization</h2>
              <p className="text-sm text-slate-500 mb-6">
                Customize the look and feel of receipt printouts and PDFs. Falls back to invoice settings if left empty.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                  <input
                    type="text"
                    value={invoiceSettings.receiptCompanyName || ''}
                    onChange={e => setInvoiceSettings({ ...invoiceSettings, receiptCompanyName: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    placeholder={invoiceSettings.invoiceCompanyName || 'Your Company Name'}
                  />
                  <p className="text-xs text-slate-400 mt-1">Leave empty to use invoice company name</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Logo <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        setInvoiceSettings({ ...invoiceSettings, receiptLogoUrl: reader.result as string })
                      }
                      reader.readAsDataURL(file)
                    }}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
                  />
                  {invoiceSettings.receiptLogoUrl ? (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={invoiceSettings.receiptLogoUrl} alt="Receipt logo preview" className="h-12 object-contain" />
                      <button
                        type="button"
                        onClick={() => setInvoiceSettings({ ...invoiceSettings, receiptLogoUrl: '' })}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 mt-1">Upload a logo image from your computer</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Footer Text <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={invoiceSettings.receiptFooter || ''}
                    onChange={e => setInvoiceSettings({ ...invoiceSettings, receiptFooter: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    placeholder={invoiceSettings.invoiceFooter || 'Thank you for your business!'}
                  />
                  <p className="text-xs text-slate-400 mt-1">Leave empty to use invoice footer</p>
                </div>
              </div>
            </div>

            {/* ---------- Save Button ---------- */}
            <div className="flex justify-end">
              <button
                onClick={async () => {
                  await run(async () => {
                    setSaving(true)
                    try {
                      const res = await settingsApi.updateInvoiceSettings(invoiceSettings)
                      if (res.error) { notify.error(res.error.message || 'Failed to update'); return }
                      localStorage.setItem('appSettings', JSON.stringify(invoiceSettings))
                      notify.success('Invoice & receipt settings updated successfully')
                    } catch (err: any) {
                      notify.error(err.message || 'Failed to update')
                    } finally {
                      setSaving(false)
                    }
                  })
                }}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'overhead' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Overhead Rate</h2>
            <p className="text-sm text-slate-500 mb-6">
              Factory overhead is a <strong>period expense</strong> (monthly salaries, diesel, utilities) — <strong>not absorbed into FG pack cost</strong>. FG is costed at material + packaging only. Record overhead via Finance → Expenses/Journals each month. Rate stored here is informational.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                await run(async () => {
                  setSaving(true)
                  try {
                    const res = await settingsApi.updateOverheadRate(overheadRate)
                    if (res.error) {
                      notify.error(res.error.message)
                    } else {
                      notify.success(`Overhead rate updated. Applied: ${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)
                      await loadOverheadRate()
                    }
                  } catch (err: any) {
                    notify.error(err.message)
                  }
                  setSaving(false)
                })
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Overhead Rate (₦)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={overheadRate}
                  onChange={e => setOverheadRate(parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                />
                <p className="text-xs text-slate-500 mt-1">Informational — not used in run costing (see note above)</p>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>

            {overheadHistory.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Rate History</h3>
                <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Period</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Rate (₦/kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {overheadHistory.map((h) => (
                      <tr key={h.month}>
                        <td className="px-3 py-2 text-sm text-slate-600">{h.month}</td>
                        <td className="px-3 py-2 text-sm text-slate-600 text-right">₦{h.ratePerKg.toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Add Material Modal */}
        {showMaterialModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">Add Material</h2>
              <form onSubmit={handleSaveMaterial} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={materialForm.name}
                    onChange={e => setMaterialForm({...materialForm, name: e.target.value})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Code <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={materialForm.code}
                    onChange={e => {
                      codeManuallyEdited.current = true
                      setMaterialForm({...materialForm, code: e.target.value.toUpperCase()})
                    }}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category <span className="text-red-500">*</span></label>
                  <select
                    value={materialForm.category}
                    onChange={e => {
                      const cat = e.target.value as MaterialCategory
                      const uom = cat === 'PACKAGING' ? 'packs' : 'pcs'
                      setMaterialForm({...materialForm, category: cat, unitOfMeasure: uom})
                    }}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    required
                  >
                    <option value="RAW_MATERIAL">Raw Material</option>
                    <option value="PACKAGING">Packaging</option>
                    <option value="FINISHED_GOOD">Finished Good</option>
                    <option value="CONSUMABLE">Consumable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cost Price (₦)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={materialForm.costPrice}
                    onChange={e => setMaterialForm({...materialForm, costPrice: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Minimum Stock</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={materialForm.minStock}
                    onChange={e => setMaterialForm({...materialForm, minStock: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">Items below this level appear on the Low Stock dashboard</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit of Measure <span className="text-red-500">*</span></label>
                  <select
                    value={materialForm.unitOfMeasure}
                    onChange={e => setMaterialForm({...materialForm, unitOfMeasure: e.target.value})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                    required
                  >
                    <option value="kg">kg</option>
                    <option value="liter">Liter</option>
                    <option value="packs">Packs</option>
                    <option value="pcs">Pieces (pcs)</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button type="button" onClick={() => setShowMaterialModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg">{saving ? 'Saving...' : 'Add'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Price Modal */}
        {showPriceModal && selectedMaterial && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">Edit Material — {selectedMaterial.name}</h2>
              <form onSubmit={handleSavePrice} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cost Price (₦)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={priceForm.costPrice}
                    onChange={e => setPriceForm({...priceForm, costPrice: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">Your purchase cost for this material</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Minimum Stock</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={priceForm.minStock}
                    onChange={e => setPriceForm({...priceForm, minStock: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">Items below this level appear on the Low Stock dashboard</p>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button type="button" onClick={() => setShowPriceModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg">{saving ? 'Saving...' : 'Save'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {archiveConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">Archive Material</h2>
              <p className="text-slate-600 mb-6">
                Are you sure you want to archive <strong>{archiveConfirm.name}</strong>? It will be hidden from all dropdowns in inventory, procurement, and sales.
              </p>
              <div className="flex justify-end space-x-3">
                <button onClick={() => setArchiveConfirm(null)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button onClick={() => handleArchive(archiveConfirm)} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-lg">{saving ? 'Archiving...' : 'Archive'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
