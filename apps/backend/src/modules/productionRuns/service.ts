import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { requireTenantId } from '../../middleware/tenant'
import { createChildLogger } from '../../logger'
import { inventoryService } from '../inventory/service'
import { financeService } from '../finance/service'
import { auditService } from '../audit'
import { dateFromInput } from '../../utils/dates'
import { CreateRunInput, CompleteRunInput } from './validation'
import { BomSnapshotLine } from './types'

const logger = createChildLogger('productionRuns:service')

const FG_ACCOUNT_BY_CATEGORY: Record<string, string> = {
  BOTTLED: '1325',
  SACHET: '1326',
  JAR: '1327'
}
const RAW_ACCOUNT = '1300'
const PACKAGING_ACCOUNT = '1311'
const FG_LOCATION = 'FG_STORE'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const DISCRETE_UNITS = ['pcs', 'piece', 'pieces', 'unit', 'units', 'pack', 'packs', 'bag', 'bags', 'jar', 'jars', 'cap', 'caps', 'label', 'labels', 'bottle', 'bottles', 'preform', 'preforms', 'roll', 'rolls', 'sheet', 'sheets', 'box', 'boxes', 'can', 'cans', 'drum', 'drums']
const isDiscreteUnit = (unit: string): boolean => DISCRETE_UNITS.some(u => unit.toLowerCase().includes(u))
const roundQty = (qty: number, unitOfMeasure: string): number => isDiscreteUnit(unitOfMeasure) ? Math.ceil(qty) : round2(qty)

const runDetailInclude = {
  variant: { include: { product: true } },
  usages: {
    include: {
      material: { select: { id: true, code: true, name: true, unitOfMeasure: true, category: true } }
    },
    orderBy: { id: 'asc' as const }
  }
}

async function generateRunNumber(db: any): Promise<string> {
  const year = new Date().getFullYear()
  const last = await db.productionRun.findFirst({
    where: { runNumber: { startsWith: `PRD-${year}` } },
    orderBy: { runNumber: 'desc' },
    select: { runNumber: true }
  })
  const lastNum = last ? parseInt(String(last.runNumber).split('-')[2] || '0', 10) : 0
  return `PRD-${year}-${String(lastNum + 1).padStart(4, '0')}`
}

async function getAccountId(db: any, code: string): Promise<string> {
  const account = await db.account.findFirst({ where: { code, isActive: true }, select: { id: true } })
  if (!account) {
    throw new AppError(400, 'SETUP_ACCOUNT_MISSING', `Required account ${code} is missing. Contact an administrator.`)
  }
  return account.id
}

async function assertStockAvailable(
  db: any,
  needs: { materialId: string; code: string; name: string; unitOfMeasure: string; needed: number }[]
) {
  const short: { code: string; needed: number; available: number; unit: string }[] = []
  for (const need of needs) {
    if (need.needed <= 0) continue
    const stock = await db.stock.findFirst({
      where: { materialId: need.materialId, location: 'MAIN' },
      select: { quantity: true }
    })
    const available = Number(stock?.quantity || 0)
    if (available + 1e-9 < need.needed) {
      short.push({ code: need.code, needed: round2(need.needed), available: round2(available), unit: need.unitOfMeasure })
    }
  }
  if (short.length > 0) {
    throw new AppError(
      409,
      'INSUFFICIENT_STOCK',
      `Insufficient raw stock: ${short.map(s => `${s.code} needs ${s.needed} ${s.unit}, has ${s.available}`).join('; ')}`
    )
  }
}

export const productionRunsService = {
  async list(status?: string) {
    return prisma.productionRun.findMany({
      where: status ? { status } : {},
      include: runDetailInclude,
      orderBy: [{ createdAt: 'desc' as const }, { runNumber: 'desc' as const }],
      take: 500
    })
  },

  async get(id: string) {
    const run = await prisma.productionRun.findUnique({
      where: { id },
      include: runDetailInclude
    })
    if (!run) throw new AppError(404, 'NOT_FOUND', 'Production run not found')
    return run
  },

  async create(input: CreateRunInput, userId?: string) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: input.variantId },
      include: { product: true }
    })
    if (!variant) throw new AppError(404, 'NOT_FOUND', 'Product variant not found')
    if (!variant.isActive) throw new AppError(400, 'INACTIVE_VARIANT', 'Product variant is archived')

    const batchNumber = input.batchNumber?.trim() || null
    const tenantId = requireTenantId()
    const payload = (runNumber: string) => ({
      runNumber,
      variantId: variant.id,
      batchNumber: batchNumber || runNumber,
      status: 'PLANNED',
      plannedPacks: input.plannedPacks,
      notes: input.notes || null,
      tenantId
    })
    try {
      return await prisma.productionRun.create({ data: payload(await generateRunNumber(prisma)), include: runDetailInclude })
    } catch (err) {
      if ((err as any)?.code !== 'P2002') throw err
      // Run-number race: regenerate once and retry
      const runNumber = await generateRunNumber(prisma)
      logger.warn({ runNumber }, 'Run number collision, regenerated')
      return prisma.productionRun.create({ data: payload(runNumber), include: runDetailInclude })
    }
  },

  async start(id: string, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const run = await tx.productionRun.findUnique({
        where: { id },
        include: {
          variant: {
            include: {
              product: true,
              boms: {
                include: {
                  material: {
                    select: { id: true, code: true, name: true, category: true, unitOfMeasure: true, costPrice: true, isActive: true }
                  }
                }
              }
            }
          },
          usages: true
        }
      })
      if (!run) throw new AppError(404, 'NOT_FOUND', 'Production run not found')
      if (run.status !== 'PLANNED') {
        throw new AppError(400, 'RUN_STATUS', `Only PLANNED runs can start (current: ${run.status})`)
      }
      if (!run.variant.isActive) throw new AppError(400, 'INACTIVE_VARIANT', 'Product variant is archived')

      const bomLines = run.variant.boms
      if (bomLines.length === 0) {
        throw new AppError(400, 'NO_BOM', 'Variant has no BOM. Define the bill of materials before starting.')
      }
      const archived = bomLines.filter(l => !l.material.isActive)
      if (archived.length > 0) {
        throw new AppError(400, 'INACTIVE_MATERIAL', `BOM uses archived materials: ${archived.map(l => l.material.code).join(', ')}`)
      }

      // Freeze BOM snapshot + planned quantities (wastage allowance folded in).
      const snapshot: BomSnapshotLine[] = bomLines.map(l => ({
        materialId: l.material.id,
        code: l.material.code,
        name: l.material.name,
        unitOfMeasure: l.material.unitOfMeasure,
        category: l.material.category,
        qtyPerPack: Number(l.qtyPerPack),
        grammage: l.grammage ? Number(l.grammage) : null,
        wastagePct: Number(l.wastagePct),
        costPrice: Number(l.material.costPrice || 0)
      }))

      // Fail fast if raw stock cannot cover the plan.
      await assertStockAvailable(
        tx,
        snapshot.map(s => ({
          materialId: s.materialId,
          code: s.code,
          name: s.name,
          unitOfMeasure: s.unitOfMeasure,
          needed: roundQty(s.qtyPerPack * (1 + s.wastagePct / 100) * run.plannedPacks, s.unitOfMeasure)
        }))
      )

      // Replace any stale usage rows (re-start after data fix) then plan fresh.
      // (ALS tenant context flows into $transaction; explicit id keeps tsc honest.)
      const usageTenantId = requireTenantId()
      await tx.productionRunComponentUsage.deleteMany({ where: { runId: run.id } })
      await tx.productionRunComponentUsage.createMany({
        data: snapshot.map(s => ({
          runId: run.id,
          materialId: s.materialId,
          plannedQty: roundQty(s.qtyPerPack * (1 + s.wastagePct / 100) * run.plannedPacks, s.unitOfMeasure),
          actualQty: 0,
          wasteQty: 0,
          tenantId: usageTenantId
        }))
      })

      const updated = await tx.productionRun.update({
        where: { id: run.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), bomSnapshot: snapshot as any },
        include: runDetailInclude
      })

      await auditService.record({
        userId,
        action: 'production_run.start',
        entityType: 'ProductionRun',
        entityId: run.id,
        description: `Started run ${run.runNumber} (${run.plannedPacks} packs, batch ${run.batchNumber})`,
        metadata: { runNumber: run.runNumber }
      })
      return updated
    })
  },

  async complete(id: string, input: CompleteRunInput, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const run = await tx.productionRun.findUnique({
        where: { id },
        include: {
          variant: { include: { product: true } },
          usages: {
            include: {
              material: {
                select: { id: true, code: true, name: true, category: true, unitOfMeasure: true, costPrice: true }
              }
            }
          }
        }
      })
      if (!run) throw new AppError(404, 'NOT_FOUND', 'Production run not found')
      if (run.status === 'COMPLETED') {
        const full = await tx.productionRun.findUnique({ where: { id }, include: runDetailInclude })
        return { alreadyCompleted: true, run: full }
      }
      if (run.status !== 'IN_PROGRESS') {
        throw new AppError(400, 'RUN_STATUS', `Only IN_PROGRESS runs can complete (current: ${run.status})`)
      }
      if (run.usages.length === 0) {
        throw new AppError(400, 'RUN_NOT_STARTED', 'Run has no planned usages. Start the run first.')
      }

      // Resolve actuals: explicit overrides win, otherwise pro-rata by packs.
      const overrides = new Map((input.usages || []).map(u => [u.materialId, u]))
      const actuals = run.usages.map(u => {
        const o = overrides.get(u.materialId)
        const actualQty = o ? o.actualQty : roundQty((Number(u.plannedQty) * input.actualPacks) / run.plannedPacks, u.material.unitOfMeasure)
        const wasteQty = o ? o.wasteQty : 0
        if (wasteQty - actualQty > 1e-9) {
          throw new AppError(400, 'INVALID_WASTE', `Waste exceeds consumption for ${u.material.code}`)
        }
        return { usageId: u.id, materialId: u.materialId, actualQty, wasteQty, material: u.material }
      })

      // Re-check availability at completion time (stock may have moved since start).
      await assertStockAvailable(
        tx,
        actuals.map(a => ({
          materialId: a.materialId,
          code: a.material.code,
          name: a.material.name,
          unitOfMeasure: a.material.unitOfMeasure,
          needed: a.actualQty
        }))
      )

      // Consume raw stock (OUT movements at MAIN).
      for (const a of actuals) {
        if (a.actualQty <= 0) continue
        await inventoryService.addStock(
          a.materialId,
          -a.actualQty,
          `Run ${run.runNumber} consumption`,
          run.runNumber,
          userId,
          tx
        )
      }

      // Cost the run at current material cost prices; waste cost is absorbed
      // into FG unit cost (variance reporting reconciles it in P3).
      let materialCost = 0
      let packagingCost = 0
      for (const a of actuals) {
        const lineCost = a.actualQty * Number(a.material.costPrice || 0)
        if (a.material.category === 'PACKAGING') packagingCost += lineCost
        else materialCost += lineCost
      }
      materialCost = round2(materialCost)
      packagingCost = round2(packagingCost)
      const totalCost = round2(materialCost + packagingCost)
      const unitCost = input.actualPacks > 0 ? round2(totalCost / input.actualPacks) : 0

      // FG store IN (weighted-average unit cost on repeat batches).
      const fgCode = FG_ACCOUNT_BY_CATEGORY[run.variant.product.category] || '1325'
      const existingFg = await tx.finishedGoodStock.findFirst({
        where: { variantId: run.variantId, batchNumber: run.batchNumber, location: FG_LOCATION }
      })
      if (existingFg) {
        const newQty = existingFg.quantity + input.actualPacks
        const newUnitCost = newQty > 0
          ? round2((existingFg.quantity * Number(existingFg.unitCost) + totalCost) / newQty)
          : unitCost
        await tx.finishedGoodStock.update({
          where: { id: existingFg.id },
          data: { quantity: newQty, unitCost: newUnitCost }
        })
      } else {
        await tx.finishedGoodStock.create({
          data: {
            variantId: run.variantId,
            batchNumber: run.batchNumber,
            location: FG_LOCATION,
            quantity: input.actualPacks,
            unitCost,
            tenantId: requireTenantId()
          }
        })
      }

      // Double-entry: Dr FG (per product line) / Cr Raw 1300 + Packaging 1311.
      const lines: { accountId: string; debit: number; credit: number; memo: string }[] = []
      lines.push({
        accountId: await getAccountId(tx, fgCode),
        debit: totalCost,
        credit: 0,
        memo: `FG from run ${run.runNumber} (${input.actualPacks} packs, batch ${run.batchNumber})`
      })
      if (materialCost > 0) {
        lines.push({
          accountId: await getAccountId(tx, RAW_ACCOUNT),
          debit: 0,
          credit: materialCost,
          memo: `Raw consumed by run ${run.runNumber}`
        })
      }
      if (packagingCost > 0) {
        lines.push({
          accountId: await getAccountId(tx, PACKAGING_ACCOUNT),
          debit: 0,
          credit: packagingCost,
          memo: `Packaging consumed by run ${run.runNumber}`
        })
      }

      const journal = await financeService.postJournalEntry(
        {
          description: `Production run ${run.runNumber} completed`,
          sourceModule: 'PRODUCTION',
          sourceId: run.id,
          reference: run.runNumber,
          postedById: userId,
          date: input.date,
          lines
        },
        tx
      )

      for (const a of actuals) {
        await tx.productionRunComponentUsage.update({
          where: { id: a.usageId },
          data: { actualQty: a.actualQty, wasteQty: a.wasteQty }
        })
      }

      const completed = await tx.productionRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          actualPacks: input.actualPacks,
          totalMaterialCost: materialCost,
          totalPackagingCost: packagingCost,
          completedAt: dateFromInput(input.date) ?? new Date(),
          notes: input.notes ?? run.notes
        },
        include: runDetailInclude
      })

      await auditService.record({
        userId,
        action: 'production_run.complete',
        entityType: 'ProductionRun',
        entityId: run.id,
        description: `Completed run ${run.runNumber}: ${input.actualPacks} packs to FG (batch ${run.batchNumber})`,
        metadata: { runNumber: run.runNumber, journalEntryId: journal.id, unitCost }
      })

      return { alreadyCompleted: false, journalEntryId: journal.id, run: completed }
    })
  },

  async cancel(id: string, reason: string | undefined, userId?: string) {
    const run = await prisma.productionRun.findUnique({ where: { id } })
    if (!run) throw new AppError(404, 'NOT_FOUND', 'Production run not found')
    if (run.status === 'COMPLETED') {
      throw new AppError(400, 'RUN_STATUS', 'Completed runs cannot be cancelled')
    }
    if (run.status === 'CANCELLED') return this.get(id)

    const updated = await prisma.productionRun.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: reason ? `${run.notes ? run.notes + ' | ' : ''}Cancelled: ${reason}` : run.notes
      },
      include: runDetailInclude
    })

    await auditService.record({
      userId,
      action: 'production_run.cancel',
      entityType: 'ProductionRun',
      entityId: run.id,
      description: `Cancelled run ${run.runNumber}${reason ? `: ${reason}` : ''}`,
      metadata: { runNumber: run.runNumber }
    })
    return updated
  }
}
