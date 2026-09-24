import { supplierRepository } from './repository'
import { Supplier } from './types'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { prisma } from '../../database'

const logger = createChildLogger('suppliers:service')

function generateCode(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 15)
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `SUP-${base}-${suffix}`
}

export const supplierService = {
  async getAll(): Promise<Supplier[]> {
    return supplierRepository.findAll()
  },

  async getById(id: string): Promise<Supplier> {
    const supplier = await supplierRepository.findById(id)
    if (!supplier) throw new AppError(404, 'NOT_FOUND', 'Supplier not found')
    return supplier
  },

  async findOrCreateByName(name: string): Promise<Supplier> {
    return prisma.$transaction(async (tx) => {
      let supplier = await tx.supplier.findFirst({ where: { name } })
      if (!supplier) {
        const code = generateCode(name)
        supplier = await tx.supplier.create({ data: { name, code } as any })
        logger.info({ name, code }, 'Auto-created supplier')
      }
      return { ...supplier, isActive: supplier.isActive } as any as Supplier
    })
  },

  async create(input: { name: string; email?: string; phone?: string; address?: string; notes?: string }): Promise<Supplier> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { name: input.name } })
      if (existing) throw new AppError(400, 'DUPLICATE', 'Supplier with this name already exists')

      const code = generateCode(input.name)
      logger.info({ ...input, code }, 'Creating supplier')

      try {
        return await tx.supplier.create({ data: { ...input, code } as any }) as unknown as Supplier
      } catch (error: any) {
        if (error?.code === 'P2002') {
          const fields: string[] = error?.meta?.target || error?.meta?.fields || []
          if (fields.includes('name')) {
            throw new AppError(400, 'DUPLICATE', 'Supplier with this name already exists')
          }
          // Code collision (extremely rare with random suffix) — retry once
          const retryCode = generateCode(input.name)
          return await tx.supplier.create({ data: { ...input, code: retryCode } as any }) as unknown as Supplier
        }
        throw error
      }
    })
  },

  async update(id: string, input: { name?: string; email?: string; phone?: string; address?: string; notes?: string; isActive?: boolean }): Promise<Supplier> {
    const updated = await prisma.supplier.updateMany({
      where: { id },
      data: input as any
    })
    if (updated.count === 0) throw new AppError(404, 'NOT_FOUND', 'Supplier not found')
    return supplierRepository.findById(id) as unknown as Promise<Supplier>
  },

  async deactivate(id: string): Promise<Supplier> {
    const updated = await prisma.supplier.updateMany({
      where: { id, isActive: true },
      data: { isActive: false }
    })
    if (updated.count === 0) throw new AppError(404, 'NOT_FOUND', 'Supplier not found or already inactive')
    return supplierRepository.findById(id) as unknown as Promise<Supplier>
  }
}
