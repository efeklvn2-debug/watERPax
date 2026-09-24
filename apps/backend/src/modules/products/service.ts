import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { requireTenantId } from '../../middleware/tenant'
import { createChildLogger } from '../../logger'
import {
  CreateProductInput, UpdateProductInput,
  CreateVariantInput, UpdateVariantInput, ReplaceBomInput
} from './validation'

const logger = createChildLogger('products:service')

const variantInclude = {
  boms: {
    include: {
      material: {
        select: { id: true, code: true, name: true, category: true, unitOfMeasure: true, costPrice: true, isActive: true }
      }
    },
    orderBy: { id: 'asc' as const }
  }
}

function toConflict(err: unknown, message: string): never {
  if ((err as any)?.code === 'P2002') throw new AppError(409, 'DUPLICATE', message)
  throw err
}

export const productsService = {
  async listProducts(includeInactive = false) {
    const products = await prisma.product.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        variants: {
          where: includeInactive ? {} : { isActive: true },
          include: variantInclude,
          orderBy: { label: 'asc' }
        }
      },
      orderBy: { code: 'asc' }
    })

    const variantIds = products.flatMap(p => p.variants.map(v => v.id))
    const available = new Map<string, number>()
    if (variantIds.length > 0) {
      const stocks = await prisma.finishedGoodStock.findMany({
        where: { variantId: { in: variantIds }, location: 'FG_STORE', quantity: { gt: 0 } },
        select: { variantId: true, quantity: true }
      })
      for (const s of stocks) {
        available.set(s.variantId, (available.get(s.variantId) || 0) + s.quantity)
      }
    }

    return products.map(p => ({
      ...p,
      variants: p.variants.map(v => ({ ...v, availableFgQty: available.get(v.id) || 0 }))
    }))
  },

  async getProduct(id: string) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { variants: { include: variantInclude, orderBy: { label: 'asc' } } }
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')
    return product
  },

  async createProduct(input: CreateProductInput) {
    try {
      return await prisma.product.create({ data: { ...input, tenantId: requireTenantId() } })
    } catch (err) {
      toConflict(err, `Product code '${input.code}' already exists`)
    }
  },

  async updateProduct(id: string, input: UpdateProductInput) {
    await this.getProduct(id)
    return prisma.product.update({ where: { id }, data: { ...input } })
  },

  async createVariant(productId: string, input: CreateVariantInput) {
    await this.getProduct(productId)
    try {
      return await prisma.productVariant.create({
        data: { productId, ...input, tenantId: requireTenantId() },
        include: variantInclude
      })
    } catch (err) {
      toConflict(err, `Variant '${input.label}' already exists for this product`)
    }
  },

  async updateVariant(variantId: string, input: UpdateVariantInput) {
    const existing = await prisma.productVariant.findUnique({ where: { id: variantId } })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Product variant not found')
    try {
      return await prisma.productVariant.update({
        where: { id: variantId },
        data: { ...input },
        include: variantInclude
      })
    } catch (err) {
      toConflict(err, 'Variant label already exists for this product')
    }
  },

  async getBom(variantId: string) {
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } })
    if (!variant) throw new AppError(404, 'NOT_FOUND', 'Product variant not found')
    return prisma.bOM.findMany({
      where: { variantId },
      include: {
        material: {
          select: { id: true, code: true, name: true, category: true, unitOfMeasure: true, costPrice: true, isActive: true }
        }
      },
      orderBy: { id: 'asc' }
    })
  },

  async replaceBom(variantId: string, input: ReplaceBomInput) {
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } })
    if (!variant) throw new AppError(404, 'NOT_FOUND', 'Product variant not found')

    if (input.lines.length > 0) {
      const materialIds = [...new Set(input.lines.map(l => l.materialId))]
      const materials = await prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: { id: true, isActive: true, code: true }
      })
      if (materials.length !== materialIds.length) {
        throw new AppError(404, 'NOT_FOUND', 'One or more materials were not found')
      }
      const inactive = materials.filter(m => !m.isActive)
      if (inactive.length > 0) {
        throw new AppError(400, 'INACTIVE_MATERIAL', `Materials are archived: ${inactive.map(m => m.code).join(', ')}`)
      }
    }

    const tenantId = requireTenantId()
    await prisma.$transaction(async (tx) => {
      await tx.bOM.deleteMany({ where: { variantId } })
      if (input.lines.length > 0) {
        await tx.bOM.createMany({
          data: input.lines.map(l => ({
            variantId,
            componentMaterialId: l.materialId,
            qtyPerPack: l.qtyPerPack,
            grammage: l.grammage ?? null,
            wastagePct: l.wastagePct,
            tenantId
          }))
        })
      }
    })
    logger.info({ variantId, lines: input.lines.length }, 'BOM replaced')
    return this.getBom(variantId)
  }
}
