import { useState, useEffect } from 'react'
import { useNotification } from '../contexts/NotificationContext'
import { useMutationGuard } from '../hooks/useMutationGuard'
import { Layout } from '../components/Layout'
import { DateInput } from '../components/DateInput'
import { financeApi, Account, JournalEntry, AccountBalance, FinanceDashboard, VatSummary, ProfitSummary, DeferredCogsSummary, GeneralLedger } from '../api/finance'
import { settingsApi } from '../api/settings'
import { taxApi, TaxSummary, CitProvisionResult, PayeEntry } from '../api/tax'
import { hasPermission } from '../stores/authStore'
import { dateInputLocal, todayLocal } from '../utils/dates'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

type TabType = 'dashboard' | 'accounts' | 'journal' | 'balances' | 'vat' | 'profit' | 'deferred-cogs' | 'expenses' | 'income' | 'tax-filing'

type ExpensePeriod = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'last-3-months' | ''

export function FinancePage() {
  const notify = useNotification()
  const { run } = useMutationGuard()
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [balances, setBalances] = useState<AccountBalance[]>([])
  const [vatSummary, setVatSummary] = useState<VatSummary | null>(null)
  const [profitSummary, setProfitSummary] = useState<ProfitSummary | null>(null)
  const [deferredCogs, setDeferredCogs] = useState<DeferredCogsSummary | null>(null)
  const [dashboardPeriod, setDashboardPeriod] = useState('')
  const [obeBalance, setObeBalance] = useState<number | null>(null)
  const [accountTypeFilter, setAccountTypeFilter] = useState('')
  const [reversing, setReversing] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null)
  const [ledgerModal, setLedgerModal] = useState<{ accountId: string; code: string; name: string } | null>(null)
  const [ledgerData, setLedgerData] = useState<GeneralLedger | null>(null)
  const [loadingLedger, setLoadingLedger] = useState(false)
  const [ledgerDateFrom, setLedgerDateFrom] = useState('')
  const [ledgerDateTo, setLedgerDateTo] = useState('')
  const [booksLockedUntil, setBooksLockedUntil] = useState<string | null>(null)
  const [lockDate, setLockDate] = useState('')
  const initDateFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return dateInputLocal(d) }
  const initDateTo = () => todayLocal()
  const [journalDateFrom, setJournalDateFrom] = useState(initDateFrom)
  const [journalDateTo, setJournalDateTo] = useState(initDateTo)
  const [journalSourceModule, setJournalSourceModule] = useState('')

  const [expenses, setExpenses] = useState<JournalEntry[]>([])
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [expensePeriod, setExpensePeriod] = useState<ExpensePeriod>('')
  const [expenseDateFrom, setExpenseDateFrom] = useState('')
  const [expenseDateTo, setExpenseDateTo] = useState('')
  const [savingExpense, setSavingExpense] = useState(false)
  const [expenseForm, setExpenseForm] = useState({
    accountId: '',
    amount: 0,
    description: '',
    paymentMethod: 'Cash' as 'Cash' | 'Bank Transfer',
    date: todayLocal(),
    referenceNumber: '',
    notes: '',
    bankAccountId: ''
  })

  const [bankAccounts, setBankAccounts] = useState<Account[]>([])

  const [incomes, setIncomes] = useState<JournalEntry[]>([])
  const [showIncomeModal, setShowIncomeModal] = useState(false)
  const [incomePeriod, setIncomePeriod] = useState<ExpensePeriod>('')
  const [incomeDateFrom, setIncomeDateFrom] = useState('')
  const [incomeDateTo, setIncomeDateTo] = useState('')
  const [savingIncome, setSavingIncome] = useState(false)
  const [incomeForm, setIncomeForm] = useState({
    accountId: '',
    amount: 0,
    description: '',
    paymentMethod: 'Cash' as 'Cash' | 'Bank Transfer',
    date: todayLocal(),
    referenceNumber: '',
    notes: '',
    bankAccountId: ''
  })

  const [showJournalModal, setShowJournalModal] = useState(false)
  const [savingJournal, setSavingJournal] = useState(false)
  const [journalForm, setJournalForm] = useState({
    description: '',
    date: todayLocal(),
    reference: ''
  })

  const [taxYear, setTaxYear] = useState(new Date().getFullYear())
  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null)
  const [citProvision, setCitProvision] = useState<CitProvisionResult | null>(null)
  const [payeEntries, setPayeEntries] = useState<PayeEntry[]>([])
  const [showPayeModal, setShowPayeModal] = useState(false)
  const [payeForm, setPayeForm] = useState({
    period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    amount: 0,
    pension: 0,
    description: '',
  })
  const [postingProvision, setPostingProvision] = useState(false)
  const [savingPaye, setSavingPaye] = useState(false)
  const [journalLines, setJournalLines] = useState<{ accountId: string; debit: number; credit: number; memo: string }[]>([
    { accountId: '', debit: 0, credit: 0, memo: '' },
    { accountId: '', debit: 0, credit: 0, memo: '' }
  ])

  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountForm, setAccountForm] = useState<{ code: string; name: string; type: Account['type'] | ''; description: string; parentId: string }>({
    code: '', name: '', type: '', description: '', parentId: ''
  })
  const [selectedParentId, setSelectedParentId] = useState('')

  const selectedParentAccount = accounts.find((a: Account) => a.id === selectedParentId)
  const isBankParent = selectedParentAccount?.code === '1100'

  const autoCode = isBankParent && accountForm.name
    ? `1100-${accountForm.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12) || 'BANK'}`
    : ''

  const canReverse = hasPermission('finance:write')

  const drillToJournal = (day?: Date) => {
    const d = day || new Date()
    setJournalDateFrom(dateInputLocal(d))
    setJournalDateTo(dateInputLocal(d))
    setJournalSourceModule('')
    setActiveTab('journal')
  }

  const formatMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  const prevMonth = () => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return formatMonth(d)
  }

  const loadDashboard = async (month?: string) => {
    try {
      const [dashboardRes, deferredRes, vatRes, accountsRes] = await Promise.all([
        financeApi.getDashboard(month),
        financeApi.getDeferredCogsSummary(),
        financeApi.getVatSummary(),
        financeApi.getAccounts()
      ])
      if ((dashboardRes.data as any)?.data) setDashboard((dashboardRes.data as any).data)
      else notify.error(dashboardRes.error?.message || 'Failed to load dashboard')
      if ((deferredRes.data as any)?.data) setDeferredCogs((deferredRes.data as any).data)
      if ((vatRes.data as any)?.data) setVatSummary((vatRes.data as any).data)
      if ((accountsRes.data as any)?.data) {
        const accs = (accountsRes.data as any).data
        setAccounts(accs)
        const obeAcct = accs.find((a: Account) => a.code === '3000')
        if (obeAcct) {
          const balRes = await financeApi.getAccountBalance(obeAcct.id)
          if ((balRes.data as any)?.data) setObeBalance(Number((balRes.data as any).data.balance))
        }
      }
    } catch (err: any) {
      notify.error(err?.message || 'Failed to load dashboard')
    }
  }

  const loadAccounts = async () => {
    const res = await financeApi.getAccounts()
    if (res.data) setAccounts((res.data as any).data || [])
    else notify.error(res.error?.message || 'Failed to load accounts')
  }

  const loadJournal = async (dateFrom?: string, dateTo?: string, sourceModule?: string) => {
    const res = await financeApi.getJournalEntries({
      dateFrom: dateFrom || journalDateFrom || undefined,
      dateTo: dateTo || journalDateTo || undefined,
      sourceModule: sourceModule !== undefined ? (sourceModule || undefined) : journalSourceModule || undefined,
      limit: 1000
    })
    if (res.data) setJournalEntries((res.data as any).data || [])
    else notify.error(res.error?.message || 'Failed to load journal')
  }

  const loadBalances = async () => {
    const res = await financeApi.getAllBalances()
    if (res.data) setBalances((res.data as any).data || [])
    else notify.error(res.error?.message || 'Failed to load balances')
  }

  const handleViewLedger = async (accountId: string, code: string, name: string, dateFrom?: string, dateTo?: string) => {
    setLedgerModal({ accountId, code, name })
    setLedgerDateFrom(dateFrom || '')
    setLedgerDateTo(dateTo || '')
    setLedgerData(null)
    setLoadingLedger(true)
    const res = await financeApi.getGeneralLedger(accountId, dateFrom, dateTo)
    if ((res.data as any)?.data) {
      const data = (res.data as any).data
      data.transactions = [...data.transactions].reverse()
      setLedgerData(data)
    } else notify.error(res.error?.message || 'Failed to load ledger')
    setLoadingLedger(false)
  }

  const loadVat = async () => {
    const res = await financeApi.getVatSummary()
    if ((res.data as any)?.data) setVatSummary((res.data as any).data)
    else notify.error(res.error?.message || 'Failed to load VAT')
  }

  const loadProfit = async () => {
    const res = await financeApi.getProfitSummary()
    if ((res.data as any)?.data) setProfitSummary((res.data as any).data as any)
    else notify.error(res.error?.message || 'Failed to load profit')
  }

  const loadDeferredCogs = async () => {
    const res = await financeApi.getDeferredCogsSummary()
    if ((res.data as any)?.data) setDeferredCogs((res.data as any).data)
    else notify.error(res.error?.message || 'Failed to load Deferred COGS')
  }

  const loadTaxData = async () => {
    try {
      const [summaryRes, citRes, payeRes] = await Promise.all([
        taxApi.getTaxSummary(taxYear),
        taxApi.getCitProvision(taxYear),
        taxApi.getPayeEntries(taxYear),
      ])
      if ((summaryRes.data as any)?.data) setTaxSummary((summaryRes.data as any).data)
      if ((citRes.data as any)?.data) setCitProvision((citRes.data as any).data)
      if ((payeRes.data as any)?.data) setPayeEntries((payeRes.data as any).data)
    } catch (err) {
      notify.error('Failed to load tax data')
    }
  }

  const applyExpensePeriod = (period: ExpensePeriod) => {
    setExpensePeriod(period)
    const now = new Date()
    let from: Date, to: Date
    switch (period) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        to = new Date(from)
        to.setDate(to.getDate() + 1)
        break
      case 'yesterday':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'this-week':
        from = new Date(now)
        from.setDate(now.getDate() - now.getDay())
        from.setHours(0, 0, 0, 0)
        to = new Date()
        break
      case 'last-week':
        from = new Date(now)
        from.setDate(now.getDate() - now.getDay() - 7)
        to = new Date(from)
        to.setDate(to.getDate() + 7)
        break
      case 'this-month':
        from = new Date(now.getFullYear(), now.getMonth(), 1)
        to = new Date()
        break
      case 'last-month':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        break
      case 'last-3-months':
        from = new Date(now.getFullYear(), now.getMonth() - 3, 1)
        to = new Date()
        break
      default:
        return
    }
    setExpenseDateFrom(dateInputLocal(from))
    setExpenseDateTo(dateInputLocal(to))
    loadExpenses(dateInputLocal(from), dateInputLocal(to))
  }

  const clearExpenseFilters = () => {
    setExpensePeriod('')
    setExpenseDateFrom('')
    setExpenseDateTo('')
    loadExpenses()
  }

  const loadExpenses = async (dateFrom?: string, dateTo?: string) => {
    const res = await financeApi.getJournalEntries({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sourceModule: 'EXPENSE'
    })
    if (res.data) setExpenses((res.data as any).data || [])
    else notify.error(res.error?.message || 'Failed to load expenses')
  }

  const loadIncomes = async (dateFrom?: string, dateTo?: string) => {
    const res = await financeApi.getJournalEntries({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sourceModule: 'INCOME'
    })
    if (res.data) setIncomes((res.data as any).data || [])
    else notify.error(res.error?.message || 'Failed to load incomes')
  }

  const applyIncomePeriod = (period: ExpensePeriod) => {
    setIncomePeriod(period)
    const now = new Date()
    let from: Date, to: Date
    switch (period) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        to = new Date(from)
        to.setDate(to.getDate() + 1)
        break
      case 'yesterday':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'this-week':
        from = new Date(now)
        from.setDate(now.getDate() - now.getDay())
        from.setHours(0, 0, 0, 0)
        to = new Date()
        break
      case 'last-week':
        from = new Date(now)
        from.setDate(now.getDate() - now.getDay() - 7)
        to = new Date(from)
        to.setDate(to.getDate() + 7)
        break
      case 'this-month':
        from = new Date(now.getFullYear(), now.getMonth(), 1)
        to = new Date()
        break
      case 'last-month':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        break
      case 'last-3-months':
        from = new Date(now.getFullYear(), now.getMonth() - 3, 1)
        to = new Date()
        break
      default:
        return
    }
    setIncomeDateFrom(dateInputLocal(from))
    setIncomeDateTo(dateInputLocal(to))
    loadIncomes(dateInputLocal(from), dateInputLocal(to))
  }

  const clearIncomeFilters = () => {
    setIncomePeriod('')
    setIncomeDateFrom('')
    setIncomeDateTo('')
    loadIncomes()
  }

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!expenseForm.accountId || expenseForm.amount <= 0 || !expenseForm.description) {
      notify.error('Account, amount, and description are required')
      return
    }
    await run(async () => {
      setShowExpenseModal(false)
      setExpenseForm({
        accountId: '',
        amount: 0,
        description: '',
        paymentMethod: 'Cash',
        date: todayLocal(),
        referenceNumber: '',
        notes: '',
        bankAccountId: ''
      })
      setSavingExpense(true)

      try {
        const allAccountsRes = await financeApi.getAccounts()
        const allAccounts = (allAccountsRes.data as any)?.data || []
        let cashAccount
        if (expenseForm.bankAccountId) {
          cashAccount = allAccounts.find((a: Account) => a.id === expenseForm.bankAccountId)
        } else {
          const cashAccountCode = expenseForm.paymentMethod === 'Bank Transfer' ? '1100' : '1000'
          cashAccount = allAccounts.find((a: Account) => a.code === cashAccountCode)
        }

        if (!cashAccount) {
          notify.error('Cash/Bank account not found')
          setSavingExpense(false)
          return
        }

        const ref = expenseForm.referenceNumber || (() => {
          const now = new Date()
          const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
          const suffix = Math.random().toString(36).substring(2, 6).toUpperCase()
          return `EXP-${ymd}-${suffix}`
        })()

        const res = await financeApi.postJournalEntry({
          description: expenseForm.description,
          sourceModule: 'EXPENSE',
          reference: ref,
          date: expenseForm.date,
          lines: [
            { accountId: expenseForm.accountId, debit: expenseForm.amount, credit: 0, memo: expenseForm.notes || expenseForm.description },
            { accountId: cashAccount.id, debit: 0, credit: expenseForm.amount, memo: `Paid via ${expenseForm.paymentMethod}` }
          ]
        })

        if (res.data) {
          notify.success('Journal entry posted')
          loadExpenses(expenseDateFrom || undefined, expenseDateTo || undefined)
        } else {
          notify.error(res.error?.message || 'Failed to record expense')
        }
      } catch (err: any) {
        notify.error(err.message || 'Failed to record expense')
      }
      setSavingExpense(false)
    })
  }

  const handleRecordIncome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!incomeForm.accountId || incomeForm.amount <= 0 || !incomeForm.description) {
      notify.error('Account, amount, and description are required')
      return
    }
    await run(async () => {
      setShowIncomeModal(false)
      setIncomeForm({
        accountId: '',
        amount: 0,
        description: '',
        paymentMethod: 'Cash',
        date: todayLocal(),
        referenceNumber: '',
        notes: '',
        bankAccountId: ''
      })
      setSavingIncome(true)

      try {
        const allAccountsRes = await financeApi.getAccounts()
        const allAccounts = (allAccountsRes.data as any)?.data || []
        let cashAccount
        if (incomeForm.bankAccountId) {
          cashAccount = allAccounts.find((a: Account) => a.id === incomeForm.bankAccountId)
        } else {
          const cashAccountCode = incomeForm.paymentMethod === 'Bank Transfer' ? '1100' : '1000'
          cashAccount = allAccounts.find((a: Account) => a.code === cashAccountCode)
        }

        if (!cashAccount) {
          notify.error('Cash/Bank account not found')
          setSavingIncome(false)
          return
        }

        const ref = incomeForm.referenceNumber || (() => {
          const now = new Date()
          const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
          const suffix = Math.random().toString(36).substring(2, 6).toUpperCase()
          return `INC-${ymd}-${suffix}`
        })()

        const res = await financeApi.postJournalEntry({
          description: incomeForm.description,
          sourceModule: 'INCOME',
          reference: ref,
          date: incomeForm.date,
          lines: [
            { accountId: cashAccount.id, debit: incomeForm.amount, credit: 0, memo: `Received via ${incomeForm.paymentMethod}` },
            { accountId: incomeForm.accountId, debit: 0, credit: incomeForm.amount, memo: incomeForm.notes || incomeForm.description }
          ]
        })

        if (res.data) {
          notify.success('Journal entry posted')
          loadIncomes(incomeDateFrom || undefined, incomeDateTo || undefined)
        } else {
          notify.error(res.error?.message || 'Failed to record income')
        }
      } catch (err: any) {
        notify.error(err.message || 'Failed to record income')
      }
      setSavingIncome(false)
    })
  }

  const handlePostJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!journalForm.description) {
      notify.error('Description is required')
      return
    }
    if (journalLines.length < 2) {
      notify.error('At least 2 lines are required')
      return
    }
    for (const [i, line] of journalLines.entries()) {
      if (!line.accountId) {
        notify.error(`Account is required on line ${i + 1}`)
        return
      }
      if (line.debit < 0 || line.credit < 0) {
        notify.error(`Negative amounts not allowed on line ${i + 1}`)
        return
      }
    }
    const totalDebit = journalLines.reduce((s, l) => s + l.debit, 0)
    const totalCredit = journalLines.reduce((s, l) => s + l.credit, 0)
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      notify.error(`Total debits (${totalDebit.toFixed(2)}) must equal total credits (${totalCredit.toFixed(2)})`)
      return
    }

    await run(async () => {
      setShowJournalModal(false)
      setJournalForm({ description: '', date: todayLocal(), reference: '' })
      setJournalLines([
        { accountId: '', debit: 0, credit: 0, memo: '' },
        { accountId: '', debit: 0, credit: 0, memo: '' }
      ])
      setSavingJournal(true)
      try {
        const ref = journalForm.reference || (() => {
          const now = new Date()
          const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
          const suffix = Math.random().toString(36).substring(2, 6).toUpperCase()
          return `ADJ-${ymd}-${suffix}`
        })()

        const res = await financeApi.postJournalEntry({
          description: journalForm.description,
          sourceModule: 'ADJUSTMENT',
          reference: ref,
          date: journalForm.date,
          lines: journalLines.map(l => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo || journalForm.description
          }))
        })

        if (res.data) {
          notify.success('Journal entry posted')
          await loadJournal(journalDateFrom || undefined, journalDateTo || undefined, journalSourceModule || undefined)
        } else {
          notify.error(res.error?.message || 'Failed to post journal entry')
        }
      } catch (err: any) {
        notify.error(err.message || 'Failed to post journal entry')
      }
      setSavingJournal(false)
    })
  }

  const handleReverse = async (entryId: string, entryNumber: string) => {
    if (!window.confirm(`Reverse ${entryNumber}? This will create a new entry that nullifies the original.`)) return
    await run(async () => {
      setReversing(entryId)
      const res = await financeApi.reverseJournalEntry(entryId)
      if (res.data) {
        notify.success('Journal entry reversed')
        await loadJournal(journalDateFrom || undefined, journalDateTo || undefined, journalSourceModule || undefined)
      } else {
        notify.error(res.error?.message || 'Failed to reverse journal entry')
      }
      setReversing(null)
    })
  }

  async function handleUpdateBooksLocked() {
    await run(async () => {
      const date = lockDate || null
      const res = await settingsApi.updateBooksLocked(date)
      if ((res.data as any)?.data || res.data) {
        setBooksLockedUntil(date)
        notify.success(date ? `Books locked through ${date}` : 'Books unlocked')
      } else {
        notify.error('Failed to update book lock')
      }
    })
  }

  useEffect(() => {
    setLoading(true)

    financeApi.getAccounts().then(res => {
      const allAccounts = (res.data as any)?.data || []
      const bankAccount = allAccounts.find((a: Account) => a.code === '1100')
      if (bankAccount) {
        setBankAccounts(allAccounts.filter((a: Account) => a.parentId === bankAccount.id))
      }
    }).catch(() => {})

    const loaders: Record<TabType, () => Promise<void>> = {
      dashboard: () => loadDashboard(dashboardPeriod || undefined),
      expenses: async () => {
        await Promise.all([
          loadExpenses(expenseDateFrom || undefined, expenseDateTo || undefined),
          loadAccounts()
        ])
      },
      income: async () => {
        await Promise.all([
          loadIncomes(incomeDateFrom || undefined, incomeDateTo || undefined),
          loadAccounts()
        ])
      },
      accounts: loadAccounts,
      journal: async () => {
        const [_, __, settingsRes] = await Promise.all([loadJournal(), loadAccounts(), settingsApi.getSettings()])
        const s = (settingsRes.data as any)?.data
        if (s?.booksLockedUntil) {
          setBooksLockedUntil(s.booksLockedUntil)
          setLockDate(s.booksLockedUntil)
        } else {
          setBooksLockedUntil(null)
          setLockDate('')
        }
      },
      balances: loadBalances,
      vat: loadVat,
      profit: loadProfit,
      'deferred-cogs': loadDeferredCogs,
      'tax-filing': loadTaxData
    }
    
    loaders[activeTab]().finally(() => setLoading(false))
  }, [activeTab])

  const accountTypeColors: Record<string, string> = {
    ASSET: 'bg-blue-100 text-blue-800',
    LIABILITY: 'bg-red-100 text-red-800',
    EQUITY: 'bg-purple-100 text-purple-800',
    REVENUE: 'bg-green-100 text-green-800',
    EXPENSE: 'bg-orange-100 text-orange-800',
    COGS: 'bg-yellow-100 text-yellow-800'
  }

  const tabs: { id: TabType; label: string; permission?: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'income', label: 'Income' },
    { id: 'accounts', label: 'Chart of Accounts' },
    { id: 'journal', label: 'Journal' },
    { id: 'balances', label: 'Balances' },
    { id: 'vat', label: 'VAT' },
    { id: 'profit', label: 'Profit & Loss' },
    { id: 'deferred-cogs', label: 'Deferred COGS' },
    { id: 'tax-filing', label: 'Tax Filing', permission: 'tax:manage' },
  ]

  const visibleTabs = tabs.filter(t => !t.permission || hasPermission(t.permission))

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Finance</h1>
            <p className="text-slate-500 mt-1">Financial management and accounting</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="flex space-x-8">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && dashboard && (
              <div className="space-y-6">
                {/* OBE Warning Banner */}
                {obeBalance !== null && Math.abs(obeBalance) > 0.01 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-800">Opening Balance Equity (3000) has a balance</p>
                      <p className="text-xs text-amber-700 mt-1">
                        Account 3000 has a balance of {formatCurrency(obeBalance)}.
                        This should be zeroed out via retained earnings once all opening balances are verified.
                      </p>
                    </div>
                  </div>
                )}

                {/* Period Selector */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">
                    As of {new Date().toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  <div className="flex gap-2">
                    {[
                      { key: '', label: 'This Month' },
                      { key: prevMonth(), label: 'Last Month' },
                    ].map(p => (
                      <button key={p.key}
                        onClick={() => { setDashboardPeriod(p.key); loadDashboard(p.key || undefined) }}
                        className={`px-3 py-1.5 text-sm rounded-lg border ${
                          dashboardPeriod === p.key
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cash Position */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setActiveTab('balances')}>
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">Cash Position</h2>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-slate-50 rounded-lg p-4">
                      <p className="text-sm text-slate-500">Cash at Start of Day</p>
                      <p className="text-xl font-bold text-slate-900">{formatCurrency(dashboard?.cashPosition?.openingBalance ?? 0)}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4 cursor-pointer hover:bg-green-100"
                      onClick={(e) => { e.stopPropagation(); drillToJournal() }}>
                      <p className="text-sm text-green-600">Money In Today</p>
                      <p className="text-xl font-bold text-green-700">+{formatCurrency(dashboard?.cashPosition?.moneyInToday ?? 0)}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 cursor-pointer hover:bg-red-100"
                      onClick={(e) => { e.stopPropagation(); drillToJournal() }}>
                      <p className="text-sm text-red-600">Money Out Today</p>
                      <p className="text-xl font-bold text-red-700">-{formatCurrency(dashboard?.cashPosition?.moneyOutToday ?? 0)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-sm text-blue-600">Cash at End of Day</p>
                      <p className="text-xl font-bold text-blue-700">{formatCurrency(dashboard?.cashPosition?.closingBalance ?? 0)}</p>
                    </div>
                  </div>
                  {(() => {
                    const netToday = Number(dashboard?.cashPosition?.moneyInToday ?? 0) - Number(dashboard?.cashPosition?.moneyOutToday ?? 0)
                    return (
                      <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
                        <span>Net today: {netToday >= 0 ? (
                          <span className="text-green-600 font-medium">+{formatCurrency(netToday)}</span>
                        ) : (
                          <span className="text-red-600 font-medium">{formatCurrency(netToday)}</span>
                        )}</span>
                      </div>
                    )
                  })()}
                </div>

                {/* Receivables & Payables */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setActiveTab('balances')}>
                    <h2 className="text-lg font-semibold text-slate-900 mb-1">Receivables</h2>
                    <p className="text-xs text-slate-400 mb-3">
                      As of {new Date().toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600">Total Owed</span>
                        <span className="text-xl font-bold text-slate-900">{formatCurrency(dashboard?.receivables?.totalOwed ?? 0)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600">Overdue</span>
                        {dashboard?.receivables?.overdueAmount != null ? (
                          <span className="text-lg font-semibold text-red-600">{formatCurrency(dashboard.receivables.overdueAmount)}</span>
                        ) : (
                          <span className="text-sm text-slate-400 italic">—</span>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600">Customers</span>
                        {dashboard?.receivables?.customerCount != null && dashboard.receivables.customerCount > 0 ? (
                          <span className="text-lg font-medium text-slate-700">{dashboard.receivables.customerCount}</span>
                        ) : (
                          <span className="text-sm text-slate-400 italic">—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setActiveTab('balances')}>
                    <h2 className="text-lg font-semibold text-slate-900 mb-1">Payables</h2>
                    <p className="text-xs text-slate-400 mb-3">
                      As of {new Date().toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600">Total Payable</span>
                        <span className="text-xl font-bold text-slate-900">{formatCurrency(dashboard?.payables?.totalPayable ?? 0)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600">Suppliers</span>
                        {dashboard?.payables?.supplierCount != null && dashboard.payables.supplierCount > 0 ? (
                          <span className="text-lg font-medium text-slate-700">{dashboard.payables.supplierCount}</span>
                        ) : (
                          <span className="text-sm text-slate-400 italic">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Profit Snapshot */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">
                    Profit Snapshot {dashboardPeriod ? `(${dashboardPeriod})` : '(This Month)'}
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-green-50 rounded-lg p-4 cursor-pointer hover:bg-green-100"
                      onClick={() => setActiveTab('profit')}>
                      <p className="text-sm text-green-600">Revenue</p>
                      <p className="text-lg font-bold text-green-700">{formatCurrency(dashboard?.profitSnapshot?.revenueThisMonth ?? 0)}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-4 cursor-pointer hover:bg-orange-100"
                      onClick={() => setActiveTab('deferred-cogs')}>
                      <p className="text-sm text-orange-600">Material Cost</p>
                      <p className="text-lg font-bold text-orange-700">{formatCurrency(dashboard?.profitSnapshot?.materialCostThisMonth ?? 0)}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 cursor-pointer hover:bg-red-100"
                      onClick={() => setActiveTab('expenses')}>
                      <p className="text-sm text-red-600">Expenses</p>
                      <p className="text-lg font-bold text-red-700">{formatCurrency(dashboard?.profitSnapshot?.expensesThisMonth ?? 0)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 cursor-pointer hover:bg-blue-100"
                      onClick={() => setActiveTab('profit')}>
                      <p className="text-sm text-blue-600">Net Profit</p>
                      <p className={`text-lg font-bold ${(dashboard?.profitSnapshot?.netProfit ?? 0) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {formatCurrency(dashboard?.profitSnapshot?.netProfit ?? 0)}
                      </p>
                    </div>
                  </div>

                  {/* Revenue Breakdown */}
                  <details className="mt-3 text-xs text-slate-500">
                    <summary className="cursor-pointer hover:text-slate-700">Revenue breakdown</summary>
                    <div className="mt-2 space-y-1 pl-2 border-l-2 border-green-200">
                      <div className="flex justify-between">
                        <span>Roll Sales</span>
                        <span className="font-medium text-green-700">{formatCurrency(dashboard?.profitSnapshot?.revenueBreakdown?.salesRevenue ?? 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Packing Bags</span>
                        <span className="font-medium text-green-700">{formatCurrency(dashboard?.profitSnapshot?.revenueBreakdown?.packingRevenue ?? 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Other Income</span>
                        <span className="font-medium text-green-700">{formatCurrency(dashboard?.profitSnapshot?.revenueBreakdown?.otherIncome ?? 0)}</span>
                      </div>
                    </div>
                  </details>

                  {/* Waterfall bar */}
                  {(() => {
                    const rev = Number(dashboard?.profitSnapshot?.revenueThisMonth ?? 0)
                    const cogs = Number(dashboard?.profitSnapshot?.materialCostThisMonth ?? 0)
                    const exp = Number(dashboard?.profitSnapshot?.expensesThisMonth ?? 0)
                    const profit = Number(dashboard?.profitSnapshot?.netProfit ?? 0)
                    if (rev === 0) return <div className="mt-3 h-2 w-full bg-slate-200 rounded-full" />
                    return (
                      <div className="mt-3 h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                        <div className="bg-green-400 transition-all" style={{ width: '100%' }} />
                        <div className="bg-red-400 transition-all" style={{ width: `${Math.min(100, (cogs / rev) * 100)}%` }} />
                        <div className="bg-orange-400 transition-all" style={{ width: `${Math.min(100, (exp / rev) * 100)}%` }} />
                        <div className={`${profit >= 0 ? 'bg-blue-400' : 'bg-red-600'} transition-all`}
                          style={{ width: `${Math.min(100, Math.max(0, (profit / rev) * 100))}%` }} />
                      </div>
                    )
                  })()}
                </div>

                {/* Deferred COGS Card */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setActiveTab('deferred-cogs')}>
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">Deferred COGS</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-yellow-50 rounded-lg p-4">
                      <p className="text-sm text-yellow-600">Total Deferred</p>
                      <p className="text-xl font-bold text-yellow-700">{formatCurrency(deferredCogs?.totalDeferred ?? 0)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-sm text-blue-600">Pending Deliveries</p>
                      <p className="text-xl font-bold text-blue-700">{deferredCogs?.pendingCount ?? 0}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4">
                      <p className="text-sm text-red-600">Overdue (&gt;7 days)</p>
                      <p className="text-xl font-bold text-red-700">{deferredCogs?.overdueCount ?? 0}</p>
                    </div>
                  </div>
                </div>

                {/* VAT Mini-Card */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setActiveTab('vat')}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-500">VAT Payable (YTD)</h2>
                      <p className="text-2xl font-bold text-slate-900 mt-1">
                        {formatCurrency(vatSummary?.vatPayable ?? 0)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500 space-y-0.5">
                      <div>Output: <span className="font-medium text-purple-700">{formatCurrency(vatSummary?.outputVat ?? 0)}</span></div>
                      <div>Input: <span className="font-medium text-blue-700">{formatCurrency(vatSummary?.inputVat ?? 0)}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Expenses Tab */}
            {activeTab === 'expenses' && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <div className="p-4 border-b border-slate-200 space-y-3">
                  <div className="flex justify-between items-center">
                    <h2 className="font-semibold">Expenses</h2>
                    <button onClick={() => setShowExpenseModal(true)} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700">
                      + Record Expense
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: 'today', label: 'Today' },
                        { key: 'yesterday', label: 'Yesterday' },
                        { key: 'this-week', label: 'This Week' },
                        { key: 'last-week', label: 'Last Week' },
                        { key: 'this-month', label: 'This Month' },
                        { key: 'last-month', label: 'Last Month' },
                        { key: 'last-3-months', label: 'Last 3 Months' },
                      ].map(p => (
                        <button key={p.key}
                          onClick={() => applyExpensePeriod(p.key as ExpensePeriod)}
                          className={`px-3 py-1.5 text-sm rounded-lg border ${
                            expensePeriod === p.key
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-4 items-center flex-wrap">
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600">From:</label>
                        <DateInput value={expenseDateFrom}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setExpensePeriod(''); setExpenseDateFrom(e.target.value); loadExpenses(e.target.value || undefined, expenseDateTo || undefined) }}
                          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600">To:</label>
                        <DateInput value={expenseDateTo}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setExpensePeriod(''); setExpenseDateTo(e.target.value); loadExpenses(expenseDateFrom || undefined, e.target.value || undefined) }}
                          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      {(expensePeriod || expenseDateFrom || expenseDateTo) && (
                        <button onClick={clearExpenseFilters}
                          className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Account</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {expenses.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No expenses found</td></tr>
                    ) : (
                      expenses.map(entry => {
                        const expenseLine = entry.lines?.find(l => Number(l.debit) > 0)
                        const accountInfo = expenseLine ? `${expenseLine.account.code} ${expenseLine.account.name}` : '-'
                        const amount = expenseLine ? Number(expenseLine.debit) : 0
                        return (
                          <tr key={entry.id} className="hover:bg-slate-50">
                            <td className="px-6 py-4 text-sm text-slate-600">{formatDate(entry.date)}</td>
                            <td className="px-6 py-4 text-sm text-slate-900">{entry.description}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{accountInfo}</td>
                            <td className="px-6 py-4 text-sm font-medium text-red-600 text-right">-{formatCurrency(amount)}</td>
                            <td className="px-6 py-4 text-sm text-slate-500">{entry.reference || '-'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Income Tab */}
            {activeTab === 'income' && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <div className="p-4 border-b border-slate-200 space-y-3">
                  <div className="flex justify-between items-center">
                    <h2 className="font-semibold">Income</h2>
                    <button onClick={() => setShowIncomeModal(true)} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      + Record Income
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: 'today', label: 'Today' },
                        { key: 'yesterday', label: 'Yesterday' },
                        { key: 'this-week', label: 'This Week' },
                        { key: 'last-week', label: 'Last Week' },
                        { key: 'this-month', label: 'This Month' },
                        { key: 'last-month', label: 'Last Month' },
                        { key: 'last-3-months', label: 'Last 3 Months' },
                      ].map(p => (
                        <button key={p.key}
                          onClick={() => applyIncomePeriod(p.key as ExpensePeriod)}
                          className={`px-3 py-1.5 text-sm rounded-lg border ${
                            incomePeriod === p.key
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-4 items-center flex-wrap">
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600">From:</label>
                        <DateInput value={incomeDateFrom}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setIncomePeriod(''); setIncomeDateFrom(e.target.value); loadIncomes(e.target.value || undefined, incomeDateTo || undefined) }}
                          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600">To:</label>
                        <DateInput value={incomeDateTo}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setIncomePeriod(''); setIncomeDateTo(e.target.value); loadIncomes(incomeDateFrom || undefined, e.target.value || undefined) }}
                          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      {(incomePeriod || incomeDateFrom || incomeDateTo) && (
                        <button onClick={clearIncomeFilters}
                          className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Account</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {incomes.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No income entries found</td></tr>
                    ) : (
                      incomes.map(entry => {
                        const incomeLine = entry.lines?.find(l => Number(l.credit) > 0)
                        const accountInfo = incomeLine ? `${incomeLine.account.code} ${incomeLine.account.name}` : '-'
                        const amount = incomeLine ? Number(incomeLine.credit) : 0
                        return (
                          <tr key={entry.id} className="hover:bg-slate-50">
                            <td className="px-6 py-4 text-sm text-slate-600">{formatDate(entry.date)}</td>
                            <td className="px-6 py-4 text-sm text-slate-900">{entry.description}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{accountInfo}</td>
                            <td className="px-6 py-4 text-sm font-medium text-green-600 text-right">{formatCurrency(amount)}</td>
                            <td className="px-6 py-4 text-sm text-slate-500">{entry.reference || '-'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Accounts Tab */}
            {activeTab === 'accounts' && accounts && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-slate-700">Filter by type:</label>
                      <select value={accountTypeFilter} onChange={e => setAccountTypeFilter(e.target.value)}
                        className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm">
                        <option value="">All</option>
                        <option value="ASSET">ASSET</option>
                        <option value="LIABILITY">LIABILITY</option>
                        <option value="EQUITY">EQUITY</option>
                        <option value="REVENUE">REVENUE</option>
                        <option value="EXPENSE">EXPENSE</option>
                        <option value="COGS">COGS</option>
                      </select>
                      <span className="text-sm text-slate-500">
                        {accountTypeFilter
                          ? `${accounts.filter(a => a.type === accountTypeFilter).length} accounts`
                          : `${accounts.length} accounts`
                        }
                      </span>
                    </div>
                    <button onClick={async () => {
                      if (accounts.length === 0) {
                        const res = await financeApi.getAccounts()
                        setAccounts((res.data as any)?.data || [])
                      }
                      setAccountForm({ code: '', name: '', type: '', description: '', parentId: '' })
                      setSelectedParentId('')
                      setShowAddAccountModal(true)
                    }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors">
                      + Add Account
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                       <tr>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Code</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Account</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Type</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">VAT</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Actions</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                       {(accounts.filter(a => !accountTypeFilter || a.type === accountTypeFilter)).length === 0 ? (
                         <tr>
                           <td colSpan={6} className="px-6 py-8 text-center text-slate-500">No accounts found</td>
                         </tr>
                       ) : accounts.filter(a => !accountTypeFilter || a.type === accountTypeFilter).map(account => (
                         <tr key={account.id} className="hover:bg-slate-50">
                           <td className="px-6 py-4 text-sm font-mono font-medium text-slate-900">{account.code}</td>
                           <td className="px-6 py-4 text-sm text-slate-900">{account.name}</td>
                           <td className="px-6 py-4">
                             <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${accountTypeColors[account.type] || 'bg-gray-100 text-gray-800'}`}>
                               {account.type}
                             </span>
                           </td>
                           <td className="px-6 py-4 text-sm text-slate-500">
                             {account.isVatEnabled ? 'Yes' : '-'}
                           </td>
                           <td className="px-6 py-4 text-sm text-slate-500">{account.description || '-'}</td>
                           <td className="px-6 py-4 text-sm">
                             <button
                               onClick={() => handleViewLedger(account.id, account.code, account.name)}
                               className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                               title="View Ledger"
                             >
                               View Ledger
                             </button>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
             )}

            {/* Journal Tab */}
            {activeTab === 'journal' && journalEntries && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                  <div className="flex gap-4 items-center flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-600">From:</label>
                      <DateInput value={journalDateFrom}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setJournalDateFrom(e.target.value); loadJournal(e.target.value || undefined, journalDateTo || undefined, journalSourceModule || undefined) }}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-600">To:</label>
                      <DateInput value={journalDateTo}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setJournalDateTo(e.target.value); loadJournal(journalDateFrom || undefined, e.target.value || undefined, journalSourceModule || undefined) }}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-600">Module:</label>
                      <select value={journalSourceModule}
                        onChange={(e) => { setJournalSourceModule(e.target.value); loadJournal(journalDateFrom || undefined, journalDateTo || undefined, e.target.value || undefined) }}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                      >
                        <option value="">All</option>
                        <option value="SALES">Sales</option>
                        <option value="PROCUREMENT">Procurement</option>
                        <option value="PRODUCTION">Production</option>
                        <option value="EXPENSE">Expense</option>
                        <option value="INCOME">Income</option>
                        <option value="PAYMENT">Payment</option>
                        <option value="ADJUSTMENT">Adjustment</option>
                        <option value="OPENING">Opening</option>
                      </select>
                    </div>
                    {(journalDateFrom !== initDateFrom() || journalDateTo !== initDateTo() || journalSourceModule) && (
                      <button onClick={() => { setJournalDateFrom(initDateFrom()); setJournalDateTo(initDateTo()); setJournalSourceModule(''); loadJournal(initDateFrom(), initDateTo(), '') }}
                        className="px-3 py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg border border-slate-300">
                        Reset
                      </button>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                      {hasPermission('finance:manage_accounts') && (
                        <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-1.5 bg-white">
                          <span className="text-xs text-slate-500 font-medium">Period Lock</span>
                          <DateInput value={lockDate}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLockDate(e.target.value)}
                            className="px-2 py-1 border border-slate-200 rounded text-sm w-36"
                            title="Blocks all journal entries dated before this date"
                          />
                          <button onClick={handleUpdateBooksLocked}
                            title={booksLockedUntil ? `Entries before ${booksLockedUntil} are locked. Click to update.` : 'Set a cutoff date to lock past periods'}
                            className={`px-3 py-1 text-sm font-medium rounded transition-colors ${booksLockedUntil ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                            {booksLockedUntil ? 'Update Lock' : 'Apply Lock'}
                          </button>
                          {booksLockedUntil && (
                            <button onClick={() => { setLockDate(''); handleUpdateBooksLocked() }}
                              title="Remove the period lock — all dates become available"
                              className="px-2 py-1 text-sm text-red-600 hover:text-red-800 font-medium">
                              Unlock
                            </button>
                          )}
                        </div>
                      )}
                      <button onClick={() => setShowJournalModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors">
                        + Post Journal Entry
                      </button>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Entry #</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Source</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Debit</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Credit</th>
                        {canReverse && <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {journalEntries.length === 0 ? (
                        <tr>
                          <td colSpan={canReverse ? 7 : 6} className="px-6 py-8 text-center text-slate-500">No journal entries yet</td>
                        </tr>
                      ) : journalEntries.map(entry => (
                        <tr key={entry.id} className="hover:bg-slate-50">
                          <td className="px-6 py-4 text-sm text-slate-900">{formatDate(entry.date)}</td>
                          <td className="px-6 py-4 text-sm font-mono">
                            <button onClick={() => setSelectedEntry(entry)} className="text-blue-600 hover:text-blue-800 hover:underline">
                              {entry.entryNumber}
                            </button>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-900">{entry.description}</td>
                          <td className="px-6 py-4 text-sm text-slate-500">{entry.sourceModule}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-900">
                            {formatCurrency(entry.lines?.reduce((sum, l) => sum + Number(l.debit), 0) ?? 0)}
                          </td>
                          <td className="px-6 py-4 text-sm text-right text-slate-900">
                            {formatCurrency(entry.lines?.reduce((sum, l) => sum + Number(l.credit), 0) ?? 0)}
                          </td>
                          {canReverse && (
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => handleReverse(entry.id, entry.entryNumber)}
                                disabled={reversing === entry.id}
                                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {reversing === entry.id ? (
                                  <span className="flex items-center gap-1">
                                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Reversing...
                                  </span>
                                ) : (
                                  'Reverse'
                                )}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Balances Tab */}
            {activeTab === 'balances' && balances && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Code</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Account</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Type</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Debit</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Credit</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {balances.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-slate-500">No balances found</td>
                        </tr>
                      ) : balances.map(balance => (
                        <tr key={balance.accountId} className="hover:bg-slate-50">
                          <td className="px-6 py-4 text-sm font-mono font-medium text-slate-900 cursor-pointer hover:text-blue-600" onClick={() => handleViewLedger(balance.accountId, balance.accountCode, balance.accountName)}>{balance.accountCode}</td>
                          <td className="px-6 py-4 text-sm text-slate-900">{balance.accountName}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${accountTypeColors[balance.accountType] || 'bg-gray-100 text-gray-800'}`}>
                              {balance.accountType}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-right text-slate-900">{formatCurrency(balance.totalDebit)}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-900">{formatCurrency(balance.totalCredit)}</td>
                          <td className={`px-6 py-4 text-sm text-right font-medium ${
                            (balance.balance ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'
                          }`}>
                            {formatCurrency(balance.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50">
                        <tr>
                          <td colSpan={3} className="px-6 py-3 text-sm font-bold text-slate-900">TOTAL</td>
                          <td className="px-6 py-3 text-sm text-right font-bold text-slate-900">
                            {formatCurrency(balances.filter(b => !b.parentId).reduce((sum, b) => sum + (b.totalDebit ?? 0), 0))}
                          </td>
                          <td className="px-6 py-3 text-sm text-right font-bold text-slate-900">
                            {formatCurrency(balances.filter(b => !b.parentId).reduce((sum, b) => sum + (b.totalCredit ?? 0), 0))}
                          </td>
                          <td className="px-6 py-3 text-sm text-right font-bold text-slate-900">
                            {formatCurrency(balances.filter(b => !b.parentId).reduce((sum, b) => sum + (b.balance ?? 0), 0))}
                          </td>
                        </tr>
                      </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* VAT Tab */}
            {activeTab === 'vat' && vatSummary && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 mb-4">VAT Summary (YTD)</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-purple-50 rounded-lg p-6">
                      <p className="text-sm text-purple-600">Output VAT (Collected)</p>
                      <p className="text-2xl font-bold text-purple-700">{formatCurrency(vatSummary?.outputVat ?? 0)}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-6">
                      <p className="text-sm text-blue-600">Input VAT (Paid)</p>
                      <p className="text-2xl font-bold text-blue-700">{formatCurrency(vatSummary?.inputVat ?? 0)}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-6">
                      <p className="text-sm text-green-600">VAT Payable</p>
                      <p className={`text-2xl font-bold ${(vatSummary?.vatPayable ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatCurrency(vatSummary?.vatPayable ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>

                {vatSummary.periods && vatSummary.periods.length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200">
                      <h2 className="text-lg font-semibold text-slate-900">Monthly VAT Breakdown</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Period</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Output VAT</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Input VAT</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">VAT Payable</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {vatSummary.periods.map(p => (
                            <tr key={p.month} className="hover:bg-slate-50">
                              <td className="px-6 py-4 text-sm font-medium text-slate-900">{p.month}</td>
                              <td className="px-6 py-4 text-sm text-right text-purple-700">{formatCurrency(p.outputVat)}</td>
                              <td className="px-6 py-4 text-sm text-right text-blue-700">{formatCurrency(p.inputVat)}</td>
                              <td className={`px-6 py-4 text-sm text-right font-medium ${p.vatPayable >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                {formatCurrency(p.vatPayable)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Profit Tab */}
            {activeTab === 'profit' && profitSummary && (
              <div className="space-y-6">
                {/* Key Metric Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 rounded-xl border border-green-200 p-4">
                    <p className="text-sm text-green-600 font-medium">Total Revenue</p>
                    <p className="text-2xl font-bold text-green-700 mt-1">{formatCurrency(profitSummary?.revenue ?? 0)}</p>
                  </div>
                  <div className="bg-red-50 rounded-xl border border-red-200 p-4">
                    <p className="text-sm text-red-600 font-medium">Cost of Goods Sold</p>
                    <p className="text-2xl font-bold text-red-700 mt-1">-{formatCurrency(profitSummary?.costOfGoodsSold ?? 0)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
                    <p className="text-sm text-orange-600 font-medium">Total Expenses</p>
                    <p className="text-2xl font-bold text-orange-700 mt-1">-{formatCurrency(profitSummary?.expenses ?? 0)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
                    <p className="text-sm text-blue-600 font-medium">Net Profit</p>
                    <p className={`text-2xl font-bold mt-1 ${(profitSummary?.netProfit ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(profitSummary?.netProfit ?? 0)}
                    </p>
                  </div>
                </div>

                {/* Detailed Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Revenue Detail */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase mb-3">Revenue</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between py-2 border-b border-slate-100">
                        <span className="text-slate-700">Sales Revenue</span>
                        <span className="font-medium text-green-700">{formatCurrency(profitSummary?.breakdown?.salesRevenue ?? 0)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-100">
                        <span className="text-slate-700">Packing Bags Revenue</span>
                        <span className="font-medium text-green-700">{formatCurrency(profitSummary?.breakdown?.packingRevenue ?? 0)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-100">
                        <span className="text-slate-700">Other Income</span>
                        <span className="font-medium text-green-700">{formatCurrency(profitSummary?.breakdown?.otherIncome ?? 0)}</span>
                      </div>
                    </div>
                  </div>

                  {/* COGS & Margin */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase mb-3">Cost of Goods Sold</h3>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-700">Total COGS</span>
                      <span className="font-medium text-red-700">-{formatCurrency(profitSummary?.costOfGoodsSold ?? 0)}</span>
                    </div>
                    <div className="flex justify-between py-2 font-bold">
                      <span className="text-slate-900">Gross Profit</span>
                      <span className={`font-medium ${((profitSummary?.revenue ?? 0) - (profitSummary?.costOfGoodsSold ?? 0)) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatCurrency((profitSummary?.revenue ?? 0) - (profitSummary?.costOfGoodsSold ?? 0))}
                      </span>
                    </div>
                  </div>

                  {/* Expenses Detail */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase mb-3">Expenses</h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {Object.entries(profitSummary?.expenseBreakdown ?? {}).map(([code, amount]) => (
                        <div key={code} className="flex justify-between py-1 border-b border-slate-100 text-sm">
                          <span className="text-slate-700">{code}</span>
                          <span className="font-medium text-red-700">{formatCurrency(amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between py-2 font-bold mt-2 border-t border-slate-200">
                      <span className="text-slate-900">Total Expenses</span>
                      <span className="text-red-700">-{formatCurrency(profitSummary?.expenses ?? 0)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Deferred COGS Tab */}
            {activeTab === 'deferred-cogs' && (
              <DeferredCogsTab deferredCogs={deferredCogs} />
            )}

            {/* Tax Filing Tab */}
            {activeTab === 'tax-filing' && (
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tax Filing</h1>
        <p className="text-slate-600 mt-1">Companies Income Tax (CIT) provision and VAT filing pack for Nigerian tax compliance.</p>
      </div>
      <div className="flex items-center gap-3">
        <select
          value={taxYear}
          onChange={e => setTaxYear(parseInt(e.target.value))}
          className="px-4 py-2 border border-slate-300 rounded-lg"
        >
          {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2, new Date().getFullYear() - 3].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const pack = {
              company: taxSummary ? { tin: '', name: '' } : null,
              cit: citProvision ? {
                netProfit: citProvision.netProfit,
                rate: citProvision.citRate,
                provision: citProvision.citAmount,
                posted: citProvision.posted,
              } : null,
              vat: taxSummary ? {
                output: taxSummary.vat.outputVat,
                input: taxSummary.vat.inputVat,
                payable: taxSummary.vat.vatPayable,
              } : null,
              paye: taxSummary ? {
                total: taxSummary.paye.total,
                entries: taxSummary.paye.entries,
              } : null,
            }
            const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `tax_filing_pack_${taxYear}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          Generate Filing Pack
        </button>
      </div>
    </div>

    {/* CIT Provision Card */}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Net Profit (YTD)</p>
        <p className="text-2xl font-bold text-slate-900">{formatCurrency(citProvision?.netProfit ?? 0)}</p>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <p className="text-sm text-slate-500">CIT Rate</p>
        <p className="text-2xl font-bold text-slate-900">{((citProvision?.citRate ?? 0.30) * 100).toFixed(1)}%</p>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <p className="text-sm text-slate-500">CIT Provision</p>
        <p className="text-2xl font-bold text-slate-900">{formatCurrency(citProvision?.citAmount ?? 0)}</p>
        <p className={`text-xs ${citProvision?.posted ? 'text-green-600' : 'text-amber-600'}`}>
          {citProvision?.posted ? 'Posted to GL' : 'Not yet posted'}
        </p>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col justify-end">
        <button
          onClick={async () => {
            if (!confirm(`Post CIT provision for ${taxYear}?`)) return
            await run(async () => {
              setPostingProvision(true)
              try {
                const res = await taxApi.postCitProvision(taxYear)
                if (res.error) { notify.error(res.error.message || 'Failed to post CIT provision'); return }
                notify.success('CIT provision posted successfully')
                loadTaxData()
              } finally { setPostingProvision(false) }
            })
          }}
          disabled={postingProvision || citProvision?.posted}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {postingProvision ? 'Posting...' : citProvision?.posted ? 'Already Posted' : 'Post CIT Provision'}
        </button>
      </div>
    </div>

    {/* VAT Summary Card */}
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">VAT Summary (YTD)</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <p className="text-sm text-slate-500">Output VAT</p>
          <p className="text-2xl font-bold text-red-700">{formatCurrency(taxSummary?.vat.outputVat ?? 0)}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Input VAT</p>
          <p className="text-2xl font-bold text-blue-700">{formatCurrency(taxSummary?.vat.inputVat ?? 0)}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">VAT Payable</p>
          <p className={`text-2xl font-bold ${(taxSummary?.vat.vatPayable ?? 0) >= 0 ? 'text-red-700' : 'text-green-700'}`}>
            {formatCurrency(taxSummary?.vat.vatPayable ?? 0)}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-4">Note: Accountant should manually verify VAT adjustments (exports, bad debts, capital goods) before FIRS submission.</p>
    </div>

    {/* PAYE Entries */}
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">PAYE Entries ({taxYear})</h3>
        <button
          onClick={() => setShowPayeModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Add Entry
        </button>
      </div>
      {payeEntries.length === 0 ? (
        <p className="text-slate-500 text-center py-4">No PAYE entries recorded for this year</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Period</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">PAYE (₦)</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Pension (₦)</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payeEntries.map(e => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 text-sm">{e.period}</td>
                  <td className="px-4 py-2 text-sm text-right">{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-2 text-sm text-right">{formatCurrency(e.pension)}</td>
                  <td className="px-4 py-2 text-sm text-slate-600">{e.description || '-'}</td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={async () => {
                        if (!confirm('Delete this PAYE entry?')) return
                        await run(async () => {
                          const res = await taxApi.deletePayeEntry(e.id)
                          if (res.error) { notify.error(res.error.message || 'Failed to delete'); return }
                          notify.success('PAYE entry deleted')
                          loadTaxData()
                        })
                      }}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-between py-2 font-bold mt-2 border-t border-slate-200">
        <span>Total PAYE ({taxYear})</span>
        <span>{formatCurrency(taxSummary?.paye.total ?? 0)}</span>
      </div>
    </div>
  </div>
)}

            {/* PAYE Modal */}
            {showPayeModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl p-6 w-full max-w-md">
      <h2 className="text-xl font-bold mb-4">Add PAYE Entry</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await run(async () => {
            setSavingPaye(true)
            try {
              const res = await taxApi.addPayeEntry({
                period: payeForm.period,
                year: payeForm.year,
                month: payeForm.month,
                amount: payeForm.amount,
                pension: payeForm.pension,
                description: payeForm.description,
              })
              if (res.error) { notify.error(res.error.message || 'Failed to add'); return }
              notify.success('PAYE entry added')
              setShowPayeModal(false)
              setPayeForm({
                period: `${taxYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
                year: taxYear,
                month: new Date().getMonth() + 1,
                amount: 0,
                pension: 0,
                description: '',
              })
              loadTaxData()
            } finally { setSavingPaye(false) }
          })
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
            <input
              type="number"
              value={payeForm.year}
              onChange={e => setPayeForm({ ...payeForm, year: parseInt(e.target.value) || taxYear })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              min={taxYear - 3}
              max={taxYear}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Month</label>
            <select
              value={payeForm.month}
              onChange={e => {
                const m = parseInt(e.target.value)
                setPayeForm({ ...payeForm, month: m, period: `${payeForm.year}-${String(m).padStart(2, '0')}` })
              }}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">PAYE Amount (₦) <span className="text-red-500">*</span></label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={payeForm.amount || ''}
            onChange={e => setPayeForm({ ...payeForm, amount: parseFloat(e.target.value) || 0 })}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Pension Contribution (₦)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={payeForm.pension || ''}
            onChange={e => setPayeForm({ ...payeForm, pension: parseFloat(e.target.value) || 0 })}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <input
            type="text"
            value={payeForm.description}
            onChange={e => setPayeForm({ ...payeForm, description: e.target.value })}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
            placeholder="e.g. PAYE for July 2026"
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setShowPayeModal(false)}
            className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={savingPaye}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {savingPaye ? 'Saving...' : 'Add Entry'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
            </>
          )}
       </div>

      {/* Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Record Expense</h2>
            <form onSubmit={handleRecordExpense} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expense Account <span className="text-red-500">*</span></label>
                <select value={expenseForm.accountId} onChange={e => setExpenseForm({...expenseForm, accountId: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required>
                  <option value="">Select expense account</option>
                  {accounts.filter(a => a.type === 'EXPENSE').map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₦) <span className="text-red-500">*</span></label>
                <input type="number" min="1" step="0.01" value={expenseForm.amount || ''} onChange={e => setExpenseForm({...expenseForm, amount: parseFloat(e.target.value) || 0})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description <span className="text-red-500">*</span></label>
                <input type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required placeholder="e.g. Diesel for generator 25L" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Paid Via</label>
                <select value={expenseForm.paymentMethod} onChange={e => setExpenseForm({...expenseForm, paymentMethod: e.target.value as 'Cash' | 'Bank Transfer'})} className="w-full px-4 py-2 border border-slate-300 rounded-lg">
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              {expenseForm.paymentMethod === 'Bank Transfer' && bankAccounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bank Account</label>
                  <select value={expenseForm.bankAccountId} onChange={e => setExpenseForm({...expenseForm, bankAccountId: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg">
                    <option value="">Default (Bank)</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <DateInput value={expenseForm.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpenseForm({...expenseForm, date: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference Number</label>
                <input type="text" value={expenseForm.referenceNumber} onChange={e => setExpenseForm({...expenseForm, referenceNumber: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" placeholder="Optional - receipt/invoice number" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={expenseForm.notes} onChange={e => setExpenseForm({...expenseForm, notes: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" rows={2} />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingExpense} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                  {savingExpense ? 'Saving...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Income Modal */}
      {showIncomeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Record Income</h2>
            <form onSubmit={handleRecordIncome} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Income Account <span className="text-red-500">*</span></label>
                <select value={incomeForm.accountId} onChange={e => setIncomeForm({...incomeForm, accountId: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required>
                  <option value="">Select income account</option>
                  {accounts.filter(a => a.type === 'REVENUE' && a.code !== '4000' && a.code !== '4100').map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₦) <span className="text-red-500">*</span></label>
                <input type="number" min="1" step="0.01" value={incomeForm.amount || ''} onChange={e => setIncomeForm({...incomeForm, amount: parseFloat(e.target.value) || 0})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description <span className="text-red-500">*</span></label>
                <input type="text" value={incomeForm.description} onChange={e => setIncomeForm({...incomeForm, description: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required placeholder="e.g. Sale of scrap materials" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Received Via</label>
                <select value={incomeForm.paymentMethod} onChange={e => setIncomeForm({...incomeForm, paymentMethod: e.target.value as 'Cash' | 'Bank Transfer'})} className="w-full px-4 py-2 border border-slate-300 rounded-lg">
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              {incomeForm.paymentMethod === 'Bank Transfer' && bankAccounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bank Account</label>
                  <select value={incomeForm.bankAccountId} onChange={e => setIncomeForm({...incomeForm, bankAccountId: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg">
                    <option value="">Default (Bank)</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <DateInput value={incomeForm.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIncomeForm({...incomeForm, date: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference Number</label>
                <input type="text" value={incomeForm.referenceNumber} onChange={e => setIncomeForm({...incomeForm, referenceNumber: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" placeholder="Optional - receipt/invoice number" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={incomeForm.notes} onChange={e => setIncomeForm({...incomeForm, notes: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" rows={2} />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowIncomeModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingIncome} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  {savingIncome ? 'Saving...' : 'Record Income'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Post Journal Entry</h2>
            <form onSubmit={handlePostJournalEntry} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description <span className="text-red-500">*</span></label>
                <input type="text" value={journalForm.description} onChange={e => setJournalForm({...journalForm, description: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required placeholder="e.g. Closing OBE to Retained Earnings" />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <DateInput value={journalForm.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJournalForm({...journalForm, date: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
                  <input type="text" value={journalForm.reference} onChange={e => setJournalForm({...journalForm, reference: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" placeholder="Auto-generated if empty" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Journal Lines</label>
                  <button type="button" onClick={() => setJournalLines([...journalLines, { accountId: '', debit: 0, credit: 0, memo: '' }])} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                    + Add Line
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-2/5">Account</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-1/6">Debit</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-1/6">Credit</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-1/5">Memo</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {journalLines.map((line, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <select value={line.accountId} onChange={e => { const lines = [...journalLines]; lines[i].accountId = e.target.value; setJournalLines(lines) }} className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white" required>
                              <option value="">Select account</option>
                              {accounts.map(a => (
                                <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={line.debit || ''} onChange={e => { const lines = [...journalLines]; lines[i].debit = parseFloat(e.target.value) || 0; if (lines[i].debit > 0) lines[i].credit = 0; setJournalLines(lines) }} className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm text-right" placeholder="0" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={line.credit || ''} onChange={e => { const lines = [...journalLines]; lines[i].credit = parseFloat(e.target.value) || 0; if (lines[i].credit > 0) lines[i].debit = 0; setJournalLines(lines) }} className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm text-right" placeholder="0" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={line.memo} onChange={e => { const lines = [...journalLines]; lines[i].memo = e.target.value; setJournalLines(lines) }} className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm" placeholder="Memo (optional)" />
                          </td>
                          <td className="px-3 py-2">
                            {journalLines.length > 2 && (
                              <button type="button" onClick={() => setJournalLines(journalLines.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 p-1" title="Remove line">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50">
                      <tr>
                        <td className="px-3 py-2 text-sm font-medium text-slate-700">Totals</td>
                        <td className="px-3 py-2 text-sm font-bold text-right text-slate-900">{journalLines.reduce((s, l) => s + l.debit, 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-sm font-bold text-right text-slate-900">{journalLines.reduce((s, l) => s + l.credit, 0).toFixed(2)}</td>
                        <td colSpan={2} />
                      </tr>
                      {Math.abs(journalLines.reduce((s, l) => s + l.debit, 0) - journalLines.reduce((s, l) => s + l.credit, 0)) > 0.01 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-1.5 text-xs text-red-600 font-medium">
                            Debits and credits must balance
                          </td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowJournalModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingJournal} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {savingJournal ? 'Posting...' : 'Post Journal Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Add Account</h2>
            <form onSubmit={async (e) => {
              e.preventDefault()
              const effectiveCode = isBankParent ? autoCode : accountForm.code
              const effectiveType = isBankParent ? 'ASSET' : accountForm.type
              if (!effectiveCode || !accountForm.name || !effectiveType) {
                notify.error('Code, name, and type are required')
                return
              }
              await run(async () => {
                setShowAddAccountModal(false)
                setSavingAccount(true)
                try {
                  const payload: any = { ...accountForm, code: effectiveCode, type: effectiveType, parentId: selectedParentId || undefined }
                  if (isBankParent) payload.isCashAccount = true
                  const res = await financeApi.createAccount(payload)
                  if (res.data) {
                    notify.success(`Account ${accountForm.code} created`)
                    const accsRes = await financeApi.getAccounts()
                    if (accsRes.data) setAccounts((accsRes.data as any).data || [])
                  } else {
                    notify.error(res.error?.message || 'Failed to create account')
                  }
                } catch (err: any) {
                  notify.error(err.message || 'Failed to create account')
                }
                setSavingAccount(false)
              })
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Code <span className="text-red-500">*</span></label>
                <input type="text" value={isBankParent ? autoCode : accountForm.code}
                  onChange={e => !isBankParent && setAccountForm({...accountForm, code: e.target.value})}
                  disabled={isBankParent}
                  className={`w-full px-4 py-2 border rounded-lg ${isBankParent ? 'bg-slate-50 text-slate-500 border-slate-200' : 'border-slate-300'}`}
                  required placeholder={isBankParent ? 'Auto-generated from name' : 'e.g. 5200'} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input type="text" value={accountForm.name} onChange={e => setAccountForm({...accountForm, name: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" required placeholder="e.g. Inventory Adjustments" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type <span className="text-red-500">*</span></label>
                <select value={isBankParent ? 'ASSET' : accountForm.type}
                  onChange={e => !isBankParent && setAccountForm({...accountForm, type: e.target.value as Account['type'] | ''})}
                  disabled={isBankParent}
                  className={`w-full px-4 py-2 border rounded-lg ${isBankParent ? 'bg-slate-50 text-slate-500 border-slate-200' : 'border-slate-300'}`} required>
                  <option value="">Select type</option>
                  <option value="ASSET">ASSET</option>
                  <option value="LIABILITY">LIABILITY</option>
                  <option value="EQUITY">EQUITY</option>
                  <option value="REVENUE">REVENUE</option>
                  <option value="EXPENSE">EXPENSE</option>
                  <option value="COGS">COGS</option>
                </select>
                {isBankParent && <p className="text-xs text-slate-400 mt-1">Locked to ASSET — bank sub-accounts are always assets</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Parent Account</label>
                <select value={selectedParentId} onChange={e => setSelectedParentId(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg">
                  <option value="">None (top-level)</option>
                  {accounts.filter(a => a.type === 'ASSET' && a.id !== accountForm.parentId).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">For bank sub-accounts, select "Bank" (1100) as parent — code and type auto-fill</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea value={accountForm.description} onChange={e => setAccountForm({...accountForm, description: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg" rows={2} placeholder="Optional description" />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowAddAccountModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingAccount} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {savingAccount ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Journal Entry Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedEntry(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{selectedEntry.entryNumber}</h2>
                <p className="text-sm text-slate-500">{selectedEntry.description}</p>
              </div>
              <button onClick={() => setSelectedEntry(null)} className="p-1 hover:bg-slate-100 rounded shrink-0">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                <div><span className="text-slate-500">Date:</span> <span className="font-medium">{formatDate(selectedEntry.date)}</span></div>
                <div><span className="text-slate-500">Source:</span> <span className="font-medium">{selectedEntry.sourceModule}</span></div>
                {selectedEntry.reference && (
                  <div><span className="text-slate-500">Reference:</span> <span className="font-medium">{selectedEntry.reference}</span></div>
                )}
                {selectedEntry.sourceId && (
                  <div><span className="text-slate-500">Source ID:</span> <span className="font-mono text-xs" title={selectedEntry.sourceId}>{selectedEntry.sourceId.slice(0, 8)}…</span></div>
                )}
                <div><span className="text-slate-500">Posted:</span> <span className="font-medium">{formatDate(selectedEntry.postedAt)}</span></div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-1/2">Account</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-1/6">Debit</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-1/6">Credit</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-1/6">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selectedEntry.lines.map(line => (
                    <tr key={line.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-slate-500">{line.account.code}</span>
                        <span className="ml-2">{line.account.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">
                        {Number(line.debit) > 0 ? formatCurrency(Number(line.debit)) : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-red-700">
                        {Number(line.credit) > 0 ? formatCurrency(Number(line.credit)) : ''}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs truncate max-w-[120px]" title={line.memo || ''}>{line.memo || ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-medium">
                  <tr>
                    <td className="px-3 py-2 text-slate-700">Total</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">
                      {formatCurrency(selectedEntry.lines.reduce((s, l) => s + Number(l.debit), 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-700">
                      {formatCurrency(selectedEntry.lines.reduce((s, l) => s + Number(l.credit), 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Ledger Modal */}
      {ledgerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setLedgerModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{ledgerModal.code} - {ledgerModal.name}</h2>
                <p className="text-sm text-slate-500">General Ledger</p>
              </div>
              <button onClick={() => setLedgerModal(null)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>

            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
                <input type="date" value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                <input type="date" value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
              </div>
              <button
                onClick={() => handleViewLedger(ledgerModal.accountId, ledgerModal.code, ledgerModal.name, ledgerDateFrom || undefined, ledgerDateTo || undefined)}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                Filter
              </button>
            </div>

            {loadingLedger ? (
              <div className="text-center py-12 text-slate-500">Loading...</div>
            ) : ledgerData ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <span className="text-slate-500">Opening Balance</span>
                    <p className="text-lg font-bold text-slate-900">{formatCurrency(ledgerData.openingBalance)}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <span className="text-slate-500">Closing Balance</span>
                    <p className={`text-lg font-bold ${ledgerData.closingBalance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(ledgerData.closingBalance)}
                    </p>
                  </div>
                </div>

                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Entry #</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Reference</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Debit</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Credit</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {ledgerData.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No transactions found</td>
                      </tr>
                    ) : ledgerData.transactions.map((tx, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-sm text-slate-600">{formatDate(tx.date)}</td>
                        <td className="px-4 py-2 text-sm font-mono text-slate-900">{tx.entryNumber}</td>
                        <td className="px-4 py-2 text-sm text-slate-900">{tx.description}</td>
                        <td className="px-4 py-2 text-sm text-slate-500">{tx.reference || '-'}</td>
                        <td className="px-4 py-2 text-sm text-right text-slate-900">{tx.debit > 0 ? formatCurrency(tx.debit) : '-'}</td>
                        <td className="px-4 py-2 text-sm text-right text-slate-900">{tx.credit > 0 ? formatCurrency(tx.credit) : '-'}</td>
                        <td className={`px-4 py-2 text-sm text-right font-medium ${tx.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatCurrency(tx.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="text-center py-12 text-slate-500">Failed to load ledger data</div>
            )}
          </div>
        </div>
      )}

    </Layout>
  )
}

function DeferredCogsTab({ deferredCogs }: { deferredCogs: DeferredCogsSummary | null }) {
  if (!deferredCogs) {
    return (
      <div className="space-y-6">
        <div className="p-8 text-center text-slate-500">
          Loading...
        </div>
      </div>
    )
  }

  const orders = deferredCogs.orders || []

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-6">
          <p className="text-sm text-yellow-600 font-medium">Total Deferred COGS</p>
          <p className="text-2xl font-bold text-yellow-700 mt-1">
            {formatCurrency(deferredCogs.totalDeferred || 0)}
          </p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
          <p className="text-sm text-blue-600 font-medium">Pending Deliveries</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">
            {deferredCogs.pendingCount || 0}
          </p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-6">
          <p className="text-sm text-red-600 font-medium">Overdue (&gt;7 days)</p>
          <p className="text-2xl font-bold text-red-700 mt-1">
            {deferredCogs.overdueCount || 0}
          </p>
        </div>
      </div>

      {/* Pending Orders Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Pending Orders with Deferred COGS</h2>
          <p className="text-sm text-slate-500 mt-1">
            These orders have completed production but are awaiting pickup/delivery
          </p>
        </div>
        
        {orders.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No pending orders with deferred COGS
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Order #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Deferred Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Completed</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Days Pending</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {orders.map(order => {
                  const completedDate = order.completedAt ? new Date(order.completedAt).toLocaleDateString('en-NG') : 'N/A'
                  const daysPending = order.daysPending || 0
                  const isOverdue = daysPending > 7
                  
                  return (
                    <tr key={order.id} className={isOverdue ? 'bg-red-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                        {order.orderNumber || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {order.customerName || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-yellow-700">
                        {formatCurrency(order.deferredAmount || 0)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {completedDate}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                        isOverdue ? 'text-red-600' : 'text-slate-600'
                      }`}>
                        {daysPending} days
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {isOverdue ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Overdue
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm text-blue-800">
          <strong>How it works:</strong> When a production job is completed, material costs + overhead are posted to Deferred COGS (1330). 
          When the customer picks up or the shipment is delivered, COGS is recognized by moving from Deferred COGS (1330) to COGS (5000).
        </p>
      </div>
    </div>
  )
}
