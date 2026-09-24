import { Prisma } from '@prisma/client'
import { prisma } from '../../database'
import { UserEntity } from './types'
import { Role } from '@waterpax/types'
import { createChildLogger } from '../../logger'

const logger = createChildLogger('auth:repository')

export const authRepository = {
  async findUserByUsername(username: string): Promise<UserEntity | null> {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { tenant: { select: { id: true, name: true, slug: true, isActive: true } } }
    })
    return user as UserEntity | null
  },

  async findUserById(id: string): Promise<UserEntity | null> {
    const user = await prisma.user.findUnique({
      where: { id }
    })
    return user as UserEntity | null
  },

  async listUsers(): Promise<UserEntity[]> {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    })
    return users as UserEntity[]
  },

  async createUser(data: {
    username: string
    passwordHash: string
    role?: Role
    tenantId: string
  }): Promise<UserEntity> {
    const user = await prisma.user.create({
      data: {
        username: data.username,
        passwordHash: data.passwordHash,
        role: data.role || Role.OPERATOR,
        tenantId: data.tenantId,
      }
    })
    logger.info({ userId: user.id }, 'User created')
    return user as UserEntity
  },

  async updateUser(id: string, data: Partial<Prisma.UserUpdateInput>): Promise<UserEntity> {
    const user = await prisma.user.update({
      where: { id },
      data
    })
    return user as UserEntity
  },

  async deleteUser(id: string): Promise<void> {
    await prisma.user.delete({
      where: { id }
    })
    logger.info({ userId: id }, 'User deleted')
  },

  async createRefreshToken(data: {
    token: string
    userId: string
    tenantId?: string
    expiresAt: Date
  }): Promise<void> {
    const createData: any = {
      token: data.token,
      userId: data.userId,
      expiresAt: data.expiresAt,
    }
    if (data.tenantId) {
      createData.tenantId = data.tenantId
    }
    await prisma.refreshToken.upsert({
      where: { token: data.token },
      create: createData,
      update: { expiresAt: data.expiresAt }
    })
    logger.info({ userId: data.userId }, 'Refresh token created')
  },

  async findRefreshToken(token: string): Promise<{ userId: string } | null> {
    const refreshToken = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true }
    })

    if (!refreshToken || refreshToken.expiresAt < new Date() || !refreshToken.user.isActive) {
      return null
    }

    return { userId: refreshToken.userId }
  },

  async findRecentRefreshToken(userId: string, afterIssuedAt: Date, withinMs: number): Promise<boolean> {
    const row = await prisma.refreshToken.findFirst({
      where: {
        userId,
        createdAt: { gt: afterIssuedAt, gte: new Date(Date.now() - withinMs) },
      },
      select: { id: true },
    })
    return !!row
  },

  async deleteExpiredRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    })
  },

  async deleteRefreshToken(token: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token }
    })
  },

  async deleteUserRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { userId }
    })
  },

  // â”€â”€ Permission management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listPermissions() {
    return prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { name: 'asc' }]
    })
  },

  async getRolePermissionIds(role: Role): Promise<string[]> {
    const rps = await prisma.rolePermission.findMany({
      where: { role },
      select: { permissionId: true }
    })
    return rps.map(rp => rp.permissionId)
  },

  async setRolePermissions(role: Role, permissionIds: string[]): Promise<number> {
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role } })
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map(permissionId => ({ role, permissionId }))
        })
      }
    })
    return permissionIds.length
  },

  async getUserPermissionOverrides(userId: string) {
    return prisma.userPermission.findMany({
      where: { userId },
      include: { permission: { select: { name: true, module: true } } }
    })
  },

  async setUserPermissionOverrides(userId: string, overrides: { permissionId: string; granted: boolean }[]): Promise<number> {
    await prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } })
      if (overrides.length > 0) {
        await tx.userPermission.createMany({
          data: overrides.map(o => ({ userId, permissionId: o.permissionId, granted: o.granted }))
        })
      }
    })
    return overrides.length
  },

  async deleteUserPermissionOverride(userId: string, permissionId: string): Promise<void> {
    await prisma.userPermission.deleteMany({
      where: { userId, permissionId }
    })
  }
}
