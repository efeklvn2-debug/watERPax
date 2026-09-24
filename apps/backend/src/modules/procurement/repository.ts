import { Prisma } from '@prisma/client'
import { prisma } from '../../database'
import { PurchaseOrder } from './types'
import { createChildLogger } from '../../logger'
import { requireTenantId } from '../../middleware/tenant'

const logger = createChildLogger('procurement:repository')

export const convertPO = (po: any): PurchaseOrder => ({
  ...po,
  totalAmount: po.totalAmount ? Number(po.totalAmount) : undefined,
  items: po.items?.map((item: any) => ({
    ...item,
    quantity: Number(item.quantity),
    totalWeight: item.totalWeight != null ? Number(item.totalWeight) : null,
    unitPrice: Number(item.unitPrice),
    receivedQty: Number(item.receivedQty || 0)
  }))
})

const poInclude = {
  items: { include: { material: true } }
}

export const procurementRepository = {
  async findPOById(id: string): Promise<PurchaseOrder | null> {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: poInclude
    })
    return po ? convertPO(po) : null
  },

  async findAllPOs(filters?: { status?: string; excludeInvoiced?: boolean }): Promise<PurchaseOrder[]> {
    const where: Prisma.PurchaseOrderWhereInput = {}
    if (filters?.status) where.status = filters.status as any
    if (filters?.excludeInvoiced) {
      where.supplierInvoices = { none: {} }
    }

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: poInclude,
      orderBy: [{ createdAt: 'desc' }, { poNumber: 'desc' }]
    })
    return pos.map(convertPO)
  },

  async generatePONumber(): Promise<string> {
    const today = new Date()
    const prefix = `PO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}-`

    const lastPO = await prisma.purchaseOrder.findFirst({
      where: { poNumber: { startsWith: prefix } },
      orderBy: { poNumber: 'desc' }
    })

    if (lastPO) {
      const lastNumber = parseInt(lastPO.poNumber.replace(prefix, ''))
      return `${prefix}${String(lastNumber + 1).padStart(4, '0')}`
    }

    return `${prefix}0001`
  },

  async createPOWithItems(data: {
    poNumber: string
    supplier: string
    expectedDate?: Date
    issuedDate?: Date
    notes?: string
    createdById?: string
    totalAmount: number
    items: {
      materialId: string
      quantity: number
      totalWeight?: number
      unitPrice: number
    }[]
  }): Promise<PurchaseOrder> {
    const tenantId = requireTenantId()
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: data.poNumber,
        supplier: data.supplier,
        expectedDate: data.expectedDate,
        issuedDate: data.issuedDate,
        notes: data.notes,
        createdById: data.createdById,
        totalAmount: data.totalAmount,
        tenantId,
        items: {
          create: data.items.map(item => ({
            material: { connect: { id: item.materialId } },
            quantity: item.quantity,
            totalWeight: item.totalWeight ?? undefined,
            unitPrice: item.unitPrice,
            tenant: { connect: { id: tenantId } }
          }))
        }
      },
      include: poInclude
    })
    logger.info({ poId: po.id, poNumber: po.poNumber, itemCount: data.items.length }, 'Purchase order with line items created')
    return convertPO(po)
  },

  async updatePO(id: string, data: Partial<Prisma.PurchaseOrderUpdateInput>): Promise<PurchaseOrder> {
    const po = await prisma.purchaseOrder.update({
      where: { id },
      data,
      include: poInclude
    })
    return convertPO(po)
  }
}
