// @ts-nocheck
import { inventoryRepository } from './repository'
import { Prisma } from '@prisma/client'
import { MaterialInput, MaterialUpdateInput, StockMovementInput } from './validation'
import { Material, MaterialWithStock, StockMovement } from './types'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { prisma } from '../../database'
import { financeService } from '../finance/service'
import { getCurrentTenantId } from '../../context'

const logger = createChildLogger('inventory:service')

export const inventoryService = {
  getExpenseAccountCode(reason: string): string {
    switch (reason) {
      case 'Opening Balance': return '3000'
      case 'Damaged Goods': return '5320'
      case 'Theft/Loss': return '5330'
      case 'Internal Use': return '5340'
      case 'Physical Count Variance':
      case 'Audit Adjustment':
      case 'Other':
      default: return '5310'
    }
  },

  async getSubCategories(): Promise<Record<string, string[]>> {
    const materials = await prisma.material.findMany({
      where: { subCategory: { not: null }, isActive: true },
      select: { category: true, subCategory: true },
      distinct: ['category', 'subCategory']
    })

    const grouped: Record<string, string[]> = {}
    for (const m of materials) {
      const cat = m.category
      const sub = m.subCategory!
      if (!grouped[cat]) grouped[cat] = []
      if (!grouped[cat].includes(sub)) grouped[cat].push(sub)
    }

    return grouped
  },

  async getAllMaterials(): Promise<Material[]> {
    return inventoryRepository.findAllMaterials()
  },

  async getMaterialsWithStock(): Promise<MaterialWithStock[]> {
    return inventoryRepository.findMaterialsWithStock()
  },

  async getMaterialById(id: string): Promise<Material> {
    const material = await inventoryRepository.findMaterialById(id)
    if (!material) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }
    return material
  },

  async createMaterial(input: MaterialInput, userId?: string): Promise<Material> {
    const existing = await inventoryRepository.findMaterialByCode(input.code)
    if (existing) {
      throw new AppError(409, 'CONFLICT', 'Material code already exists')
    }

    const subCategory = input.subCategory || input.name.replace(/[^a-zA-Z0-9]/g, '')

    logger.info({ code: input.code, name: input.name, userId }, 'Creating material')
    return inventoryRepository.createMaterial({
      ...input,
      subCategory,
      unitOfMeasure: input.unitOfMeasure || 'pcs',
      minStock: input.minStock || 0
    })
  },

  async updateMaterial(id: string, input: MaterialUpdateInput, userId?: string): Promise<Material> {
    const existing = await inventoryRepository.findMaterialById(id)
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }

    if (input.code && input.code !== existing.code) {
      const codeExists = await inventoryRepository.findMaterialByCode(input.code)
      if (codeExists) {
        throw new AppError(409, 'CONFLICT', 'Material code already exists')
      }
    }

    logger.info({ materialId: id, updates: input, userId }, 'Updating material')
    return inventoryRepository.updateMaterial(id, input)
  },

  async adjustStock(id: string, newQuantity: number, reason: string, date?: string): Promise<Material> {
    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      throw new AppError(400, 'INVALID', 'Stock quantity cannot be negative')
    }
    if (!reason?.trim()) {
      throw new AppError(400, 'INVALID', 'A reason is required for stock adjustment')
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.material.findUnique({ where: { id } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Material not found')

      logger.info({ materialId: id, newQuantity, reason }, 'Adjusting material stock')

      const stock = await inventoryRepository.getOrCreateStock(id, 'MAIN', tx)
      const currentQty = Number(stock.quantity || 0)

      const difference = newQuantity - currentQty
      if (Math.abs(difference) > 0.000001) {
        if (!existing.costPrice || Number(existing.costPrice) <= 0) {
          throw new AppError(400, 'STOCK_COST_MISSING', `Set a cost price for ${existing.name} before adjusting its stock`)
        }

        const isIncrease = difference > 0
        const quantity = Math.abs(difference)
        const reference = `STOCK-ADJ-${id.slice(0, 8).toUpperCase()}-${Date.now()}`
        const notes = `Stock adjusted: ${currentQty} → ${newQuantity}. Reason: ${reason}`

        await inventoryRepository.createStockMovement({
          materialId: id,
          stockId: stock.id,
          type: isIncrease ? 'ADJUSTMENT' : 'OUT',
          quantity,
          reference,
          notes
        }, tx)

        const amount = quantity * Number(existing.costPrice)
        const inventoryAccountId = await financeService.getAccountIdByCode(existing.category === 'PACKAGING' ? '1510' : '1300')
        const adjustmentAccountId = await financeService.getAccountIdByCode('5400')
        const isReturnToSupplier = reason === 'Return to Supplier'
        const isOpeningBalance = reason === 'Opening Balance'
        const debitAccountId = isReturnToSupplier
          ? await financeService.getAccountIdByCode('2000')
          : isIncrease
            ? adjustmentAccountId
            : await financeService.getAccountIdByCode(inventoryService.getExpenseAccountCode(reason))
        const creditAccountId = isOpeningBalance
          ? await financeService.getAccountIdByCode('3000')
          : adjustmentAccountId
        await financeService.postJournalEntry({
          description: `Stock ${isIncrease ? 'increase' : 'decrease'} — ${existing.name} (${existing.code}): ${currentQty} → ${newQuantity}. ${reason}`,
          sourceModule: 'ADJUSTMENT',
          sourceId: id,
          date: date || new Date().toISOString().split('T')[0],
          lines: isIncrease
            ? [
                { accountId: inventoryAccountId, debit: amount, credit: 0, memo: `${existing.code} +${quantity} ${existing.unitOfMeasure}` },
                { accountId: creditAccountId, debit: 0, credit: amount, memo: `Stock increase contra — ${reason}` }
              ]
            : [
                { accountId: debitAccountId, debit: amount, credit: 0, memo: isReturnToSupplier ? `Supplier credit — ${reason}` : `Stock decrease expense — ${reason}` },
                { accountId: inventoryAccountId, debit: 0, credit: amount, memo: `${existing.code} -${quantity} ${existing.unitOfMeasure}` }
              ]
        }, tx)

        const existingNotes = existing.notes || ''
        const newNotes = existingNotes + `\n[${new Date().toISOString()}] ${notes}`
        await tx.$executeRaw`
          UPDATE "Material"
          SET "notes" = ${newNotes}, "updatedAt" = NOW()
          WHERE "id" = ${id} AND "tenantId" = ${getCurrentTenantId()}
        `
      }

      const updated = await tx.material.findUnique({ where: { id } })
      if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update material')
      return { ...updated, costPrice: updated.costPrice ? Number(updated.costPrice) : null } as Material
    })
  },

  async archiveMaterial(id: string): Promise<Material> {
    const existing = await inventoryRepository.findMaterialById(id)
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }

    logger.info({ materialId: id }, 'Archiving material')
    return inventoryRepository.updateMaterial(id, { isActive: false })
  },

  async restoreMaterial(id: string): Promise<Material> {
    const existing = await inventoryRepository.findMaterialById(id)
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }

    logger.info({ materialId: id }, 'Restoring material')
    return inventoryRepository.updateMaterial(id, { isActive: true })
  },

  async deleteMaterial(id: string, userId?: string): Promise<void> {
    const existing = await inventoryRepository.findMaterialById(id)
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }

    logger.info({ materialId: id, userId }, 'Deactivating material')
    await inventoryRepository.deleteMaterial(id)
  },

  async recordStockMovement(input: StockMovementInput, userId?: string): Promise<StockMovement> {
    const material = await inventoryRepository.findMaterialById(input.materialId)
    if (!material) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }

    let stockId = input.stockId

    if (!stockId && input.type !== 'ADJUSTMENT') {
      const stock = await inventoryRepository.getOrCreateStock(input.materialId, input.reference || undefined)
      stockId = stock.id
    }

    logger.info({ materialId: input.materialId, type: input.type, quantity: input.quantity, userId }, 'Recording stock movement')
    return inventoryRepository.createStockMovement({
      materialId: input.materialId,
      stockId,
      type: input.type,
      quantity: input.quantity,
      reference: input.reference,
      notes: input.notes,
      createdById: userId
    })
  },

  async getStockMovements(materialId?: string, limit = 50): Promise<StockMovement[]> {
    return inventoryRepository.getStockMovements(materialId, limit)
  },

  async addStock(materialId: string, quantity: number, notes?: string, reference?: string, userId?: string, tx?: any): Promise<StockMovement> {
    const db = tx || prisma
    const material = await inventoryRepository.findMaterialById(materialId)
    if (!material) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }

    logger.info({ materialId, quantity, reference }, 'Adding stock')

    const stock = await inventoryRepository.getOrCreateStock(materialId, 'MAIN', tx)

    return inventoryRepository.createStockMovement({
      materialId,
      stockId: stock.id,
      type: quantity >= 0 ? 'IN' : 'OUT',
      quantity: Math.abs(quantity),
      reference,
      notes,
      createdById: userId
    }, tx)
  },

  async recordPackingBagChange(materialId: string, quantity: number, type: 'PURCHASE' | 'SALE', reference?: string, userId?: string, tx?: any): Promise<StockMovement | null> {
    const execute = async (client: any) => {
      const material = await inventoryRepository.findMaterialById(materialId)
      if (!material) {
        throw new AppError(404, 'NOT_FOUND', 'Packing bag material not found')
      }

      const stock = await inventoryRepository.getOrCreateStock(materialId, 'MAIN', client)

      return inventoryRepository.createStockMovement({
        materialId,
        stockId: stock.id,
        type: type === 'PURCHASE' ? 'IN' : 'OUT',
        quantity: Math.abs(quantity),
        reference,
        notes: `${type === 'PURCHASE' ? 'Purchase' : 'Sale'}: ${Math.abs(quantity)} ${material.unitOfMeasure}`,
        createdById: userId
      }, client)
    }

    if (tx) return execute(tx)
    return prisma.$transaction(execute)
  },

  async getPackingBagStock(days = 60): Promise<{ materials: any[]; movements: any[] }> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const materials = await prisma.material.findMany({
      where: { category: 'PACKAGING' },
      include: { stocks: true }
    })

    const materialsWithStock = materials.map(m => ({
      id: m.id,
      name: m.name,
      code: m.code,
      unit: m.unitOfMeasure,
      stock: m.stocks?.[0]?.quantity || 0
    }))

    const movements = await prisma.stockMovement.findMany({
      where: {
        material: { category: 'PACKAGING' },
        createdAt: { gte: cutoffDate }
      },
      include: { material: true },
      orderBy: { createdAt: 'desc' }
    })

    return { materials: materialsWithStock, movements }
  },
}
