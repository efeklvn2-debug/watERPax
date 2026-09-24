import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { requireTenantId } from '../../middleware/tenant'
import { createChildLogger } from '../../logger'
import { CreateCustomerInput, UpdateCustomerInput, RecordJarReturnInput } from './validation'
import { CustomerBalance } from './types'

const logger = createChildLogger('customers:service')

async function generateCustomerCode(): Promise<string> {
  const tenantId = requireTenantId()
  const last = await prisma.customer.findFirst({
    where: { tenantId, code: { startsWith: 'CUST-' } },
    orderBy: { code: 'desc' },
    select: { code: true }
  })
  const lastNum = last ? parseInt(last.code.replace('CUST-', '') || '0', 10) : 0
  return `CUST-${String(lastNum + 1).padStart(4, '0')}`
}

function clean(input: CreateCustomerInput | UpdateCustomerInput) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (k === 'email' && v === '') {
      out[k] = null
      continue
    }
    out[k] = v
  }
  return out
}

export const customersService = {
  async list(includeInactive = false) {
    return prisma.customer.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' }
    })
  },

  async get(id: string) {
    const customer = await prisma.customer.findUnique({ where: { id } })
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
    return customer
  },

  async create(input: CreateCustomerInput) {
    const code = input.code?.trim() || await generateCustomerCode()
    try {
      return await prisma.customer.create({
        data: {
          name: input.name.trim(),
          code,
          email: input.email || null,
          phone: input.phone || null,
          address: input.address || null,
          paymentType: (input.paymentType || 'CASH') as any,
          creditLimit: input.creditLimit ?? 0,
          depositPercentDefault: input.depositPercentDefault ?? 0,
          paymentTermsDays: input.paymentTermsDays ?? 0,
          discountPercent: input.discountPercent ?? 0,
          notifyEmail: input.notifyEmail ?? true,
          notifyWhatsApp: input.notifyWhatsApp ?? true,
          isActive: true,
          tenantId: requireTenantId()
        }
      })
    } catch (err) {
      if ((err as any)?.code === 'P2002') throw new AppError(409, 'DUPLICATE', `Customer code '${code}' already exists`)
      throw err
    }
  },

  async update(id: string, input: UpdateCustomerInput) {
    await this.get(id)
    return prisma.customer.update({ where: { id }, data: clean(input) as any })
  },

  async deactivate(id: string) {
    await this.get(id)
    return prisma.customer.update({ where: { id }, data: { isActive: false } })
  },

  async balance(customerId: string): Promise<CustomerBalance> {
    const customer = await this.get(customerId)
    const invoices = await prisma.invoice.findMany({
      where: { customerId, status: { not: 'CANCELLED' } },
      select: { totalAmount: true, amountPaid: true, balanceDue: true, status: true }
    })
    let totalInvoiced = invoices.reduce((s, i) => s + Number(i.totalAmount), 0)
    let totalPaid = invoices.reduce((s, i) => s + Number(i.amountPaid), 0)
    let balanceDue = invoices.reduce((s, i) => s + Number(i.balanceDue), 0)
    let openInvoices = invoices.filter(i => Number(i.balanceDue) > 0).length

    // GuideAngel opening receivables settled FIFO by the payment waterfall.
    const openingReceivables = await prisma.guideAngelOpeningBalance.findMany({
      where: { customerId, type: 'CUSTOMER_RECEIVABLE' },
      select: { amount: true, settledAmount: true }
    })
    const recTotal = openingReceivables.reduce((s, r) => s + Number(r.amount), 0)
    const recSettled = openingReceivables.reduce((s, r) => s + Number(r.settledAmount), 0)
    const recOpen = recTotal - recSettled
    totalInvoiced += recTotal
    totalPaid += recSettled
    balanceDue += recOpen
    openInvoices += openingReceivables.filter(r => Number(r.amount) - Number(r.settledAmount) > 0.005).length

    // Deposit held: standalone deposits + GuideAngel opening deposits - applied on invoices
    const standaloneDeposits = await prisma.paymentTransaction.aggregate({
      where: { customerId, transactionType: 'DEPOSIT', saleId: null },
      _sum: { amount: true }
    })
    const openingDeposits = await prisma.guideAngelOpeningBalance.aggregate({
      where: { customerId, type: 'CUSTOMER_DEPOSIT' },
      _sum: { amount: true }
    })
    const appliedOnInvoices = await prisma.invoice.aggregate({
      where: { customerId },
      _sum: { depositApplied: true }
    })
    const depositHeld = Number(standaloneDeposits._sum.amount || 0)
      + Number(openingDeposits._sum.amount || 0)
      - Number(appliedOnInvoices._sum.depositApplied || 0)

    return {
      customerId,
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      balanceDue: Math.round(balanceDue * 100) / 100,
      openInvoices,
      depositHeld: Math.round(depositHeld * 100) / 100,
      jarBalance: (customer as any).jarBalance || 0
    }
  },

  async transactions(customerId: string, limit = 100) {
    await this.get(customerId)
    return prisma.paymentTransaction.findMany({
      where: { customerId },
      include: { receipts: true },
      orderBy: { receivedAt: 'desc' },
      take: Math.min(limit, 500)
    })
  },

  async allBalances(): Promise<CustomerBalance[]> {
    const customers = await prisma.customer.findMany({ where: { isActive: true }, select: { id: true, jarBalance: true } })

    const invoices = await prisma.invoice.groupBy({
      by: ['customerId'],
      where: { status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, amountPaid: true, balanceDue: true },
      _count: true
    })

    const deposits = await prisma.paymentTransaction.groupBy({
      by: ['customerId'],
      where: { transactionType: 'DEPOSIT', saleId: null },
      _sum: { amount: true }
    })

    const openingDeposits = await prisma.guideAngelOpeningBalance.groupBy({
      by: ['customerId'],
      where: { type: 'CUSTOMER_DEPOSIT' },
      _sum: { amount: true }
    })

    const appliedDeposits = await prisma.invoice.groupBy({
      by: ['customerId'],
      _sum: { depositApplied: true }
    })

    const openingReceivables = await prisma.guideAngelOpeningBalance.groupBy({
      by: ['customerId'],
      where: { type: 'CUSTOMER_RECEIVABLE' },
      _sum: { amount: true, settledAmount: true }
    })

    const invoiceMap = new Map(invoices.map(i => [i.customerId, i]))
    const depositMap = new Map(deposits.map(d => [d.customerId, d]))
    const openingMap = new Map(openingDeposits.map(d => [d.customerId, d]))
    const appliedMap = new Map(appliedDeposits.map(d => [d.customerId, d]))
    const receivableMap = new Map(openingReceivables.map(d => [d.customerId, d]))

    return customers.map(c => {
      const inv = invoiceMap.get(c.id)
      const dep = depositMap.get(c.id)
      const opn = openingMap.get(c.id)
      const app = appliedMap.get(c.id)
      const rec = receivableMap.get(c.id)

      const recTotal = Number(rec?._sum.amount || 0)
      const recSettled = Number(rec?._sum.settledAmount || 0)
      const recOpen = recTotal - recSettled

      const totalInvoiced = Number(inv?._sum.totalAmount || 0) + recTotal
      const totalPaid = Number(inv?._sum.amountPaid || 0) + recSettled
      const balanceDue = Number(inv?._sum.balanceDue || 0) + recOpen
      const depositHeld = Number(dep?._sum.amount || 0) + Number(opn?._sum.amount || 0) - Number(app?._sum.depositApplied || 0)

      return {
        customerId: c.id,
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        balanceDue: Math.round(balanceDue * 100) / 100,
        openInvoices: (inv?._count || 0) + (recOpen > 0.005 ? 1 : 0),
        depositHeld: Math.round(depositHeld * 100) / 100,
        jarBalance: c.jarBalance || 0
      }
    })
  },

  async recordJarReturn(customerId: string, input: RecordJarReturnInput) {
    const customer = await this.get(customerId)
    const tenantId = requireTenantId()

    const settings = await prisma.settings.findFirst({ where: { tenantId } })
    const jarCode = (settings as any)?.jarMaterialCode
    if (!jarCode) throw new AppError(400, 'CONFIGURATION', 'Jar material code not configured in Settings')

    const jarMaterial = await prisma.material.findFirst({ where: { code: jarCode, tenantId } })
    if (!jarMaterial) throw new AppError(404, 'NOT_FOUND', `Material '${jarCode}' not found`)

    const stock = await prisma.stock.findFirst({ where: { materialId: jarMaterial.id, location: 'MAIN', tenantId } })
    if (!stock) throw new AppError(404, 'NOT_FOUND', `'${jarCode}' MAIN stock not found`)

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { jarBalance: { decrement: input.quantity } } })

      await tx.stockMovement.create({
        data: {
          materialId: jarMaterial.id,
          stockId: stock.id,
          type: 'RETURN' as any,
          quantity: input.quantity,
          reference: `JAR-RETURN-${customer.code}`,
          notes: input.notes || `Empty jars returned by ${customer.name}`,
          tenantId
        }
      })
      await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: input.quantity } } })
    })

    logger.info({ customerId, quantity: input.quantity }, 'Jar return recorded')
    return { customerId, quantity: input.quantity }
  }
}
