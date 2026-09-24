import bcrypt from 'bcryptjs'
import { prisma } from '../../database'
import { runWithTenant } from '../../context'
import { AppError } from '../../middleware/errorHandler'
import { createChildLogger } from '../../logger'
import { CreateTenantInput, CreateTenantUserInput, UpdateTenantInput } from './validation'

const logger = createChildLogger('platform:service')

import { DEFAULT_ACCOUNTS } from '@waterpax/types'

async function seedTenantDefaults(tenantId: string) {
  await runWithTenant(tenantId, async () => {
    const existingAccounts = await prisma.account.findMany()
    if (existingAccounts.length === 0) {
      await prisma.account.createMany({ data: DEFAULT_ACCOUNTS as any })
      logger.info({ tenantId }, 'Seeded default chart of accounts')
    }

    const existingSettings = await prisma.settings.findFirst()
    if (!existingSettings) {
      await prisma.settings.create({ data: {} as any })
      logger.info({ tenantId }, 'Seeded default settings')
    }
  })
}

export const platformService = {
  async listTenants() {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: true,
            salesOrders: true,
            customers: true,
          },
        },
      },
    })
    return tenants.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      userCount: t._count.users,
      salesOrderCount: t._count.salesOrders,
      customerCount: t._count.customers,
    }))
  },

  async getTenant(id: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, username: true, role: true, isActive: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            salesOrders: true,
            customers: true,
            materials: true,
            productionRuns: true,
          },
        },
      },
    })
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant not found')
    return tenant
  },

  async createTenant(input: CreateTenantInput) {
    const existing = await prisma.tenant.findUnique({ where: { slug: input.slug } })
    if (existing) {
      throw new AppError(409, 'TENANT_EXISTS', `Tenant with slug '${input.slug}' already exists`)
    }

    const tenant = await prisma.tenant.create({
      data: { name: input.name, slug: input.slug },
    })
    logger.info({ tenantId: tenant.id, name: tenant.name }, 'Tenant created')

    await seedTenantDefaults(tenant.id)

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
    }
  },

  async updateTenant(id: string, input: UpdateTenantInput) {
    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant not found')

    const updated = await prisma.tenant.update({
      where: { id },
      data: input,
    })
    logger.info({ tenantId: id, updates: input }, 'Tenant updated')
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    }
  },

  async deleteTenant(id: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant not found')

    // Clear self-referencing FKs before deletion
    await prisma.account.updateMany({ where: { tenantId: id, parentId: { not: null } }, data: { parentId: null } })

    // No $transaction wrappers — each deleteMany is atomic and idempotent.
    // PgBouncer in transaction mode kills idle transactions, so we avoid them entirely.
    await prisma.auditLog.deleteMany({ where: { tenantId: id } })
    await prisma.settings.deleteMany({ where: { tenantId: id } })
    await prisma.idempotencyKey.deleteMany({ where: { tenantId: id } })
    await prisma.refreshToken.deleteMany({ where: { tenantId: id } })

    await prisma.stockMovement.deleteMany({ where: { tenantId: id } })
    await prisma.pOLineItem.deleteMany({ where: { tenantId: id } })
    await prisma.journalLine.deleteMany({ where: { tenantId: id } })
    await prisma.priceList.deleteMany({ where: { tenantId: id } })
    await prisma.paymentMade.deleteMany({ where: { tenantId: id } })
    await prisma.paymentReceived.deleteMany({ where: { tenantId: id } })
    await prisma.receipt.deleteMany({ where: { tenantId: id } })
    await prisma.supplierInvoice.deleteMany({ where: { tenantId: id } })
    await prisma.orderItem.deleteMany({ where: { tenantId: id } })
    await prisma.coreBuyback.deleteMany({ where: { tenantId: id } })

    await prisma.stock.deleteMany({ where: { tenantId: id } })
    await prisma.invoice.deleteMany({ where: { tenantId: id } })

    await prisma.purchaseOrder.deleteMany({ where: { tenantId: id } })
    await prisma.paymentTransaction.deleteMany({ where: { tenantId: id } })
    await prisma.transaction.deleteMany({ where: { tenantId: id } })
    await prisma.salesOrder.deleteMany({ where: { tenantId: id } })
    await prisma.order.deleteMany({ where: { tenantId: id } })
    await prisma.journalEntry.deleteMany({ where: { tenantId: id } })

    await prisma.customer.deleteMany({ where: { tenantId: id } })
    await prisma.supplier.deleteMany({ where: { tenantId: id } })
    await prisma.material.deleteMany({ where: { tenantId: id } })
    await prisma.account.deleteMany({ where: { tenantId: id } })

    await prisma.user.deleteMany({ where: { tenantId: id } })

    await prisma.tenant.delete({ where: { id } })

    logger.info({ tenantId: id, name: tenant.name }, 'Tenant deleted')
    return { id, name: tenant.name }
  },

  async createTenantUser(tenantId: string, input: CreateTenantUserInput) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant not found')
    if (!tenant.isActive) throw new AppError(400, 'TENANT_INACTIVE', 'Cannot create users for inactive tenant')

    const existingUser = await prisma.user.findUnique({ where: { username: input.username } })
    if (existingUser) {
      throw new AppError(409, 'USER_EXISTS', `Username '${input.username}' is already taken`)
    }

    const passwordHash = await bcrypt.hash(input.password, 12)

    const user = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash,
        role: input.role,
        tenantId,
      } as any,
    })
    logger.info({ userId: user.id, username: user.username, tenantId }, 'Tenant user created')

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      tenantId,
    }
  },

  async deleteTenantUser(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found in this tenant')
    if (user.role === 'SUPER_ADMIN') throw new AppError(400, 'CANNOT_DELETE', 'Cannot delete SUPER_ADMIN users')

    await prisma.user.delete({ where: { id: userId } })

    logger.info({ userId, username: user.username, tenantId }, 'Tenant user deleted')
    return { id: userId, username: user.username }
  },
}
