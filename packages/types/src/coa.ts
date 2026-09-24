// Canonical Chart of Accounts — single source of truth
// Imported by prisma/seed.ts and finance/service.ts:seedDefaultAccounts()

export interface DefaultAccount {
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COGS' | 'EXPENSE'
  isVatEnabled?: boolean
  isCashAccount?: boolean
  description: string
}

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { code: '1000', name: 'Cash', type: 'ASSET', isCashAccount: true, description: 'Cash on hand' },
  { code: '1100', name: 'Bank', type: 'ASSET', isCashAccount: true, description: 'Bank accounts' },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET', description: 'Money owed by customers' },
  { code: '1300', name: 'Raw Material Inventory', type: 'ASSET', description: 'Raw mats (preforms, caps, wrap)' },
  { code: '1310', name: 'Raw — Preforms', type: 'ASSET', description: 'Preforms by size' },
  { code: '1311', name: 'Raw — Packaging', type: 'ASSET', description: 'Shrink wrap, bags' },
  { code: '1325', name: 'Finished Goods — Bottled', type: 'ASSET', description: 'Bottled packs FG' },
  { code: '1326', name: 'Finished Goods — Sachet', type: 'ASSET', description: 'Sachet bags FG' },
  { code: '1327', name: 'Finished Goods — Jars', type: 'ASSET', description: 'Jar FG' },
  { code: '1330', name: 'Deferred COGS', type: 'ASSET', description: 'Deferred COGS (WIP optional)' },
  { code: '1400', name: 'VAT Input', type: 'ASSET', isVatEnabled: true, description: 'VAT paid on purchases' },
  { code: '1410', name: 'Prepayments', type: 'ASSET', description: 'Prepaid expenses' },
  { code: '1510', name: 'Packing Bag Inventory', type: 'ASSET', description: 'Packing bags held for resale' },
  { code: '1600', name: 'Plant & Machinery', type: 'ASSET', description: 'Fixed assets' },
  { code: '1650', name: 'Accumulated Depreciation', type: 'ASSET', description: 'Contra-asset' },

  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', description: 'Money owed to suppliers' },
  { code: '2100', name: 'VAT Output', type: 'LIABILITY', isVatEnabled: true, description: 'VAT collected on sales' },
  { code: '2200', name: 'Customer Deposits', type: 'LIABILITY', description: 'Core deposits held' },
  { code: '2250', name: 'Advance Customer Payments', type: 'LIABILITY', description: 'Prepayments against future invoices' },
  { code: '2251', name: 'Jar Deposit Liability', type: 'LIABILITY', description: 'Returnable jar deposits' },
  { code: '2300', name: 'PAYE Payable', type: 'LIABILITY', description: 'PAYE' },
  { code: '2310', name: 'Pension Payable', type: 'LIABILITY', description: 'Pension' },
  { code: '2320', name: 'WHT Payable', type: 'LIABILITY', description: 'WHT' },
  { code: '2330', name: 'CIT Payable', type: 'LIABILITY', description: 'CIT' },
  { code: '2400', name: 'Accrued Expenses', type: 'LIABILITY', description: 'Accrued' },
  { code: '2500', name: 'Loans Payable', type: 'LIABILITY', description: 'Loans' },
  { code: '2510', name: 'CIT Provision', type: 'EXPENSE', description: 'CIT provision' },

  { code: '3000', name: 'Opening Balance Equity', type: 'EQUITY', description: 'Opening balances' },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY', description: 'Retained' },
  { code: '3200', name: 'Share Capital', type: 'EQUITY', description: 'Share capital' },

  { code: '4000', name: 'Sales Revenue', type: 'REVENUE', description: 'Legacy sales' },
  { code: '4001', name: 'Revenue — Bottled', type: 'REVENUE', description: 'Bottled water revenue' },
  { code: '4002', name: 'Revenue — Sachet', type: 'REVENUE', description: 'Sachet water revenue' },
  { code: '4003', name: 'Revenue — Jars', type: 'REVENUE', description: 'Jar revenue' },
  { code: '4100', name: 'Packing Bags Revenue', type: 'REVENUE', description: 'Packing bags' },
  { code: '4200', name: 'Other Income', type: 'REVENUE', description: 'Other income' },

  { code: '5000', name: 'Cost of Goods Sold', type: 'COGS', description: 'COGS' },
  { code: '5100', name: 'Material Costs', type: 'COGS', description: 'Material costs' },
  { code: '5200', name: 'Production Costs', type: 'COGS', description: 'Production costs' },
  { code: '5300', name: 'Scrap/Waste Expense', type: 'COGS', description: 'Scrap' },
  { code: '5310', name: 'Production Waste', type: 'COGS', description: 'Production waste expense' },
  { code: '5320', name: 'Damaged Goods', type: 'EXPENSE', description: 'Damaged goods write-off' },
  { code: '5330', name: 'Theft & Unexplained Loss', type: 'EXPENSE', description: 'Theft and unexplained loss' },
  { code: '5340', name: 'Internal Use', type: 'EXPENSE', description: 'Internal consumption expense' },
  { code: '5400', name: 'Inventory Adjustment', type: 'EXPENSE', description: 'Inventory adjustment contra' },

  { code: '6000', name: 'Fuel & Transport', type: 'EXPENSE', description: 'Fuel' },
  { code: '6100', name: 'Maintenance', type: 'EXPENSE', description: 'Maintenance' },
  { code: '6200', name: 'Diesel', type: 'EXPENSE', description: 'Diesel' },
  { code: '6300', name: 'Salaries', type: 'EXPENSE', description: 'Salaries' },
  { code: '6400', name: 'Administrative', type: 'EXPENSE', description: 'Admin' },
  { code: '6500', name: 'Utilities', type: 'EXPENSE', description: 'Utilities' },
  { code: '6600', name: 'Miscellaneous', type: 'EXPENSE', description: 'Misc' },
  { code: '6700', name: 'Depreciation Expense', type: 'EXPENSE', description: 'Depreciation' },
]
