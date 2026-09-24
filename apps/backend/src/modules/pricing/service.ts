import { z } from 'zod'
import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { dateFromInput } from '../../utils/dates'

export const priceListSchema = z.object({
  materialId: z.string().min(1, 'Material is required'),
  pricePerKg: z.number().optional(),
  pricePerPack: z.number().optional(),
  effectiveFrom: z.string().optional()
})

export type PriceListInput = z.infer<typeof priceListSchema>

export const pricingService = {
  async getPriceLists() {
    const priceLists = await prisma.priceList.findMany({
      include: { material: true },
      orderBy: { effectiveFrom: 'desc' }
    })
    
    // Group by material and get only the current effective one
    const currentPrices = new Map<string, typeof priceLists[0]>()
    for (const pl of priceLists) {
      if (!currentPrices.has(pl.materialId) || 
          new Date(pl.effectiveFrom) > new Date(currentPrices.get(pl.materialId)!.effectiveFrom)) {
        currentPrices.set(pl.materialId, pl)
      }
    }
    
    return Array.from(currentPrices.values())
  },

  async getPriceListByMaterial(materialId: string) {
    const priceList = await prisma.priceList.findFirst({
      where: { materialId },
      orderBy: { effectiveFrom: 'desc' }
    })
    return priceList
  },

  async createPriceList(input: PriceListInput) {
    const { materialId, pricePerKg, pricePerPack, effectiveFrom } = input
    
    // Check if material exists
    const material = await prisma.material.findUnique({ where: { id: materialId } })
    if (!material) {
      throw new AppError(404, 'NOT_FOUND', 'Material not found')
    }
    
    // Create new price list entry (this creates a new price effective from date)
    const priceList = await prisma.priceList.create({
      data: {
        materialId,
        pricePerKg: pricePerKg ?? null,
        pricePerPack: pricePerPack ?? null,
        effectiveFrom: dateFromInput(effectiveFrom)
      } as any,
      include: { material: true }
    })
    
    return priceList
  },

  async updatePriceList(id: string, input: Partial<PriceListInput>) {
    const existing = await prisma.priceList.findUnique({ where: { id } })
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Price list not found')
    }
    
    // If updating price, create a new entry with new effective date instead
    if (input.pricePerKg !== undefined || input.pricePerPack !== undefined) {
      // Archive old entry
      await prisma.priceList.update({
        where: { id },
        data: { effectiveTo: new Date() }
      })
      
      // Create new entry
      const newPriceList = await prisma.priceList.create({
        data: {
          materialId: existing.materialId,
          pricePerKg: input.pricePerKg ?? existing.pricePerKg,
          pricePerPack: input.pricePerPack ?? existing.pricePerPack,
          effectiveFrom: new Date()
        } as any,
        include: { material: true }
      })
      
      return newPriceList
    }
    
    return prisma.priceList.update({
      where: { id },
      data: input,
      include: { material: true }
    })
  },

  async deletePriceList(id: string) {
    const existing = await prisma.priceList.findUnique({ where: { id } })
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Price list not found')
    }
    
    return prisma.priceList.delete({ where: { id } })
  },

  async getMaterialsWithPrices(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true }
    const materials = await prisma.material.findMany({
      where,
      include: {
        priceLists: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        }
      }
    })
    
    return materials.map(m => ({
      id: m.id,
      code: m.code,
      name: m.name,
      category: m.category,
      subCategory: m.subCategory,
      minStock: m.minStock,
      isActive: m.isActive,
      costPrice: m.costPrice ? Number(m.costPrice) : null,
      pricePerKg: m.priceLists[0]?.pricePerKg ? Number(m.priceLists[0].pricePerKg) : null,
      pricePerPack: m.priceLists[0]?.pricePerPack ? Number(m.priceLists[0].pricePerPack) : null,
      priceListId: m.priceLists[0]?.id || null
    }))
  }
}
