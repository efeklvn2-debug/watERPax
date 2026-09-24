import { prisma } from '../../database'
import { Supplier } from './types'

export const supplierRepository = {
  async findAll(): Promise<Supplier[]> {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        invoices: { select: { amount: true, amountPaid: true } },
        guideAngelOpeningBalances: {
          where: { type: 'SUPPLIER_PAYABLE' },
          select: { amount: true, settledAmount: true }
        }
      }
    })
    return suppliers.map(s => ({
      ...s,
      invoices: undefined,
       outstandingBalance: Number(s.invoices.reduce((sum, inv) => sum + Number(inv.amount) - Number(inv.amountPaid), 0))
         + Number(s.guideAngelOpeningBalances.reduce((sum, entry) => sum + Number(entry.amount) - Number(entry.settledAmount), 0)),
      totalBilled: Number(s.invoices.reduce((sum, inv) => sum + Number(inv.amount), 0))
    })) as unknown as Supplier[]
  },

  async findById(id: string): Promise<Supplier | null> {
    return prisma.supplier.findUnique({ where: { id } })
  },

  async findByCode(code: string): Promise<Supplier | null> {
    return prisma.supplier.findFirst({ where: { code } })
  },

  async findByName(name: string): Promise<Supplier | null> {
    return prisma.supplier.findFirst({ where: { name } })
  },

  async create(data: { name: string; code: string; email?: string; phone?: string; address?: string; notes?: string }): Promise<Supplier> {
    return prisma.supplier.create({ data: data as any })
  },

  async update(id: string, data: { name?: string; email?: string; phone?: string; address?: string; notes?: string; isActive?: boolean }): Promise<Supplier> {
    return prisma.supplier.update({ where: { id }, data })
  },

  async deactivate(id: string): Promise<Supplier> {
    return prisma.supplier.update({ where: { id }, data: { isActive: false } })
  }
}
