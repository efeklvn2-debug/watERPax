// @ts-nocheck
import { Prisma } from '@prisma/client'
import { prisma } from '../../database'
import { Material, Stock, StockMovement, MaterialWithStock, MaterialCategory } from './types'
import { createChildLogger } from '../../logger'

const logger = createChildLogger('inventory:repository')

export const inventoryRepository = {
  async findMaterialById(id: string): Promise<Material | null> {
    const material = await prisma.material.findUnique({ where: { id } })
    return material as Material | null
  },

  async findMaterialByCode(code: string): Promise<Material | null> {
    const material = await prisma.material.findFirst({ where: { code } })
    return material as Material | null
  },

  async findAllMaterials(includeInactive = false): Promise<Material[]> {
    const where = includeInactive ? {} : { isActive: true }
    const materials = await prisma.material.findMany({
      where,
      orderBy: { name: 'asc' }
    })
    return materials.map(m => ({
      ...m,
      costPrice: m.costPrice ? Number(m.costPrice) : null
    })) as Material[]
  },

  async findMaterialsWithStock(): Promise<MaterialWithStock[]> {
    const materials = await prisma.material.findMany({
      where: { isActive: true },
      include: {
        stocks: true
      },
      orderBy: { name: 'asc' }
    })

    return materials.map(m => {
      const totalStock = m.stocks.reduce((sum, s) => sum + s.quantity, 0)
      return {
        ...m,
        costPrice: m.costPrice ? Number(m.costPrice) : null,
        totalStock,
        locations: m.stocks.map(s => ({ location: s.location || '', quantity: s.quantity }))
      }
    }) as MaterialWithStock[]
  },

  async createMaterial(data: {
    code: string
    name: string
    category: MaterialCategory
    subCategory?: string
    unitOfMeasure?: string
    minStock?: number
    costPrice?: number
  }): Promise<Material> {
    const material = await prisma.material.create({
      data: {
        code: data.code,
        name: data.name,
        category: data.category,
        subCategory: data.subCategory,
        unitOfMeasure: data.unitOfMeasure,
        minStock: data.minStock,
        costPrice: data.costPrice
      } as any
    })
    logger.info({ materialId: material.id, code: material.code }, 'Material created')
    return { ...material, costPrice: material.costPrice ? Number(material.costPrice) : null } as Material
  },

  async updateMaterial(id: string, data: Partial<Prisma.MaterialUpdateInput>): Promise<Material> {
    const material = await prisma.material.update({ where: { id }, data })
    return { ...material, costPrice: material.costPrice ? Number(material.costPrice) : null } as Material
  },

  async deleteMaterial(id: string): Promise<void> {
    await prisma.material.update({ where: { id }, data: { isActive: false } })
    logger.info({ materialId: id }, 'Material deactivated')
  },

  async getStock(materialId: string): Promise<Stock[]> {
    return prisma.stock.findMany({ where: { materialId } }) as Promise<Stock[]>
  },

  async getOrCreateStock(materialId: string, location?: string, tx?: any): Promise<Stock> {
    const client = tx || prisma
    const stock = await client.stock.upsert({
      where: { materialId_location: { materialId, location: location || '' } },
      create: { materialId, quantity: 0, location: location || '' } as any,
      update: {},
      include: { material: true }
    })
    return stock as Stock
  },

  async createStockMovement(data: {
    materialId: string
    stockId?: string
    type: string
    quantity: number
    reference?: string
    notes?: string
    createdById?: string
  }, tx?: any): Promise<StockMovement> {
    const execute = async (client: any) => {
      const movement = await client.stockMovement.create({
        data: {
          materialId: data.materialId,
          stockId: data.stockId,
          type: data.type as any,
          quantity: data.quantity,
          reference: data.reference,
          notes: data.notes,
          createdById: data.createdById
        } as any
      })

      if (data.stockId) {
        const increment = (data.type === 'IN' || data.type === 'ADJUSTMENT' || data.type === 'RETURN') ? data.quantity : -data.quantity
        await client.stock.update({
          where: { id: data.stockId },
          data: { quantity: { increment } }
        })
      }

      logger.info({ movementId: movement.id, type: data.type, materialId: data.materialId }, 'Stock movement created')
      return movement as StockMovement
    }

    if (tx) return execute(tx)
    return prisma.$transaction(execute)
  },

  async getStockMovements(materialId?: string, limit = 50): Promise<StockMovement[]> {
    const where = materialId ? { materialId } : {}
    return prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { material: true }
    }) as Promise<StockMovement[]>
  },

  async updateStockQuantity(stockId: string, quantityToAdd: number): Promise<Stock> {
    const stock = await prisma.stock.update({
      where: { id: stockId },
      data: { quantity: { increment: quantityToAdd } }
    })
    return stock as Stock
  }
}
