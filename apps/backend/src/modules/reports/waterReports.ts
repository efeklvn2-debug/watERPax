import { prisma } from '../../database'
import { createChildLogger } from '../../logger'
import { dateStartOfDay, dateEndOfDay } from '../../utils/dates'
import { BomSnapshotLine } from '../productionRuns/types'

const logger = createChildLogger('reports:water')

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function parseRange(from?: string, to?: string): { gte?: Date; lte?: Date } {
  const range: { gte?: Date; lte?: Date } = {}
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) range.gte = dateStartOfDay(from)
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) range.lte = dateEndOfDay(to)
  return range
}

function todayRange(): { gte: Date; lte: Date } {
  const now = new Date()
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return { gte: dateStartOfDay(key), lte: dateEndOfDay(key) }
}

export interface ReportResult {
  meta: Record<string, unknown>
  rows: Record<string, string | number>[]
  totals: Record<string, string | number>
}

export const waterReportsService = {
  /** FG on hand by variant + batch (qty > 0), valued at stored unit cost. */
  async fgValuation(): Promise<ReportResult> {
    const stocks = await prisma.finishedGoodStock.findMany({
      where: { quantity: { gt: 0 } },
      include: { variant: { include: { product: true } } },
      orderBy: [{ variantId: 'asc' }, { batchNumber: 'asc' }]
    })
    const rows = stocks.map(s => {
      const value = round2(s.quantity * Number(s.unitCost))
      return {
        variant: (s.variant as any).label,
        product: (s.variant as any).product?.name || '',
        category: (s.variant as any).product?.category || '',
        batchNumber: s.batchNumber,
        location: s.location,
        packs: s.quantity,
        unitCost: Number(s.unitCost),
        value
      }
    })
    const packs = rows.reduce((s, r) => s + (r.packs as number), 0)
    const value = round2(rows.reduce((s, r) => s + (r.value as number), 0))
    return { meta: {}, rows, totals: { packs, value } }
  },

  /** FG grouped by product → variant. Includes zero-stock active variants. */
  async fgGrouped(filters?: { category?: string; productId?: string; variantId?: string }): Promise<ReportResult> {
    const productWhere: any = { isActive: true }
    if (filters?.category) productWhere.category = filters.category
    if (filters?.productId) productWhere.id = filters.productId

    const activeProductIds = (await prisma.product.findMany({ where: productWhere, select: { id: true } })).map(p => p.id)

    const variantWhere: any = { isActive: true, productId: { in: activeProductIds } }
    if (filters?.variantId) variantWhere.id = filters.variantId

    const variants = await prisma.productVariant.findMany({
      where: variantWhere,
      include: {
        product: { select: { id: true, name: true, category: true } },
        fgStocks: { where: { quantity: { gt: 0 } }, orderBy: { batchNumber: 'asc' } }
      },
      orderBy: { label: 'asc' }
    })

    const filtered = variants.filter(v => v.product)

    const grouped = new Map<string, any>()
    for (const v of filtered) {
      const p = v.product as any
      if (!grouped.has(v.productId)) {
        grouped.set(v.productId, {
          productId: v.productId,
          product: p.name,
          category: p.category,
          variants: []
        })
      }
      const totalPacks = v.fgStocks.reduce((s, st) => s + st.quantity, 0)
      const totalValue = round2(v.fgStocks.reduce((s, st) => s + st.quantity * Number(st.unitCost), 0))
      const unitCost = totalPacks > 0 ? round2(totalValue / totalPacks) : 0
      const batches = v.fgStocks.map(st => ({
        variant: v.label,
        product: p.name,
        category: p.category,
        batchNumber: st.batchNumber,
        location: st.location,
        packs: st.quantity,
        unitCost: Number(st.unitCost),
        value: round2(st.quantity * Number(st.unitCost))
      }))
      grouped.get(v.productId).variants.push({
        variantId: v.id,
        variant: v.label,
        packSize: v.packSize,
        packs: totalPacks,
        unitCost,
        value: totalValue,
        batches
      })
    }

    const rows = [...grouped.values()].sort((a, b) => a.product.localeCompare(b.product))
    const allVariants = rows.flatMap(r => r.variants)
    const totalPacks = allVariants.reduce((s: number, v: any) => s + v.packs, 0)
    const totalValue = round2(allVariants.reduce((s: number, v: any) => s + v.value, 0))
    return {
      meta: { category: filters?.category || null, productId: filters?.productId || null, variantId: filters?.variantId || null },
      rows,
      totals: { packs: totalPacks, value: totalValue }
    }
  },

  /** Completed output grouped by variant. */
  async productionOutput(from?: string, to?: string): Promise<ReportResult> {
    const range = parseRange(from, to)
    const runs = await prisma.productionRun.findMany({
      where: { status: 'COMPLETED', ...(range.gte || range.lte ? { completedAt: range } : {}) },
      include: { variant: { include: { product: true } } },
      orderBy: { completedAt: 'desc' }
    })
    const byVariant = new Map<string, any>()
    for (const run of runs) {
      const v: any = run.variant
      if (!byVariant.has(run.variantId)) {
        byVariant.set(run.variantId, {
          variant: v.label,
          product: v.product?.name || '',
          category: v.product?.category || '',
          runs: 0,
          packs: 0,
          materialCost: 0,
          packagingCost: 0
        })
      }
      const row = byVariant.get(run.variantId)
      row.runs += 1
      row.packs += run.actualPacks || 0
      row.materialCost = round2(row.materialCost + Number(run.totalMaterialCost || 0))
      row.packagingCost = round2(row.packagingCost + Number(run.totalPackagingCost || 0))
    }
    const rows = [...byVariant.values()].map(r => ({
      ...r,
      totalCost: round2(r.materialCost + r.packagingCost),
      unitCost: r.packs > 0 ? round2((r.materialCost + r.packagingCost) / r.packs) : 0
    }))
    const totals = {
      runs: rows.reduce((s, r) => s + r.runs, 0),
      packs: rows.reduce((s, r) => s + r.packs, 0),
      materialCost: round2(rows.reduce((s, r) => s + r.materialCost, 0)),
      packagingCost: round2(rows.reduce((s, r) => s + r.packagingCost, 0)),
      totalCost: round2(rows.reduce((s, r) => s + r.totalCost, 0))
    }
    return { meta: { from: from || null, to: to || null }, rows, totals }
  },

  /** Recorded waste grouped by component material. */
  async wasteByComponent(from?: string, to?: string): Promise<ReportResult> {
    const range = parseRange(from, to)
    const usages = await prisma.productionRunComponentUsage.findMany({
      where: {
        ...(range.gte || range.lte
          ? { run: { status: 'COMPLETED', completedAt: range } }
          : { run: { status: 'COMPLETED' } })
      },
      include: { material: { select: { code: true, name: true, unitOfMeasure: true } } }
    })
    const byMaterial = new Map<string, any>()
    for (const u of usages) {
      if (!byMaterial.has(u.materialId)) {
        byMaterial.set(u.materialId, {
          code: (u.material as any)?.code || '',
          name: (u.material as any)?.name || '',
          unit: (u.material as any)?.unitOfMeasure || '',
          consumed: 0,
          waste: 0
        })
      }
      const row = byMaterial.get(u.materialId)
      row.consumed = round2(row.consumed + Number(u.actualQty))
      row.waste = round2(row.waste + Number(u.wasteQty))
    }
    const rows = [...byMaterial.values()]
      .map(r => ({ ...r, wastePct: r.consumed > 0 ? round2((r.waste / r.consumed) * 100) : 0 }))
      .sort((a, b) => b.waste - a.waste)
    return {
      meta: { from: from || null, to: to || null },
      rows,
      totals: {
        consumed: round2(rows.reduce((s, r) => s + r.consumed, 0)),
        waste: round2(rows.reduce((s, r) => s + r.waste, 0))
      }
    }
  },

  /**
   * Procured vs realised variance per material.
   * procured  = Σ StockMovement IN in period (purchase receipts only —
   *             INITIAL opening balances and ADJUSTMENTs excluded).
   * consumed  = Σ usage actualQty on runs completed in period.
   * theoretical = Σ actualPacks × frozen bomSnapshot qtyPerPack (no wastage
   *             allowance — allowance lives in plannedQty, not here).
   * waste     = Σ usage wasteQty.
   * unexplained = consumed − theoretical − waste (scale loss, spills, unrecorded).
   */
  async variance(from?: string, to?: string): Promise<ReportResult> {
    const range = parseRange(from, to)
    const createdAt = range.gte || range.lte ? range : undefined

    const movements = await prisma.stockMovement.findMany({
      where: { type: 'IN', ...(createdAt ? { createdAt } : {}) },
      include: { material: { select: { code: true, name: true, unitOfMeasure: true } } }
    })

    const runs = await prisma.productionRun.findMany({
      where: { status: 'COMPLETED', ...(createdAt ? { completedAt: createdAt } : {}) },
      include: {
        usages: {
          include: { material: { select: { code: true, name: true, unitOfMeasure: true } } }
        }
      }
    })

    const agg = new Map<string, any>()
    const ensure = (materialId: string, material: any) => {
      if (!agg.has(materialId)) {
        agg.set(materialId, {
          code: material?.code || '',
          name: material?.name || '',
          unit: material?.unitOfMeasure || '',
          procured: 0,
          consumed: 0,
          theoretical: 0,
          waste: 0
        })
      }
      return agg.get(materialId)
    }

    for (const m of movements) {
      const row = ensure(m.materialId, m.material)
      row.procured = round2(row.procured + Number(m.quantity))
    }

    for (const run of runs) {
      const snapshot = (run.bomSnapshot as unknown as BomSnapshotLine[] | null) || []
      const snapQty = new Map(snapshot.map(s => [s.materialId, Number(s.qtyPerPack)]))
      for (const u of run.usages) {
        const row = ensure(u.materialId, u.material)
        row.consumed = round2(row.consumed + Number(u.actualQty))
        row.waste = round2(row.waste + Number(u.wasteQty))
        row.theoretical = round2(row.theoretical + (run.actualPacks || 0) * (snapQty.get(u.materialId) || 0))
      }
    }

    const rows = [...agg.values()]
      .map(r => ({ ...r, unexplained: round2(r.consumed - r.theoretical - r.waste) }))
      .sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained))
    const sum = (k: string) => round2(rows.reduce((s, r) => s + (r[k] as number), 0))
    return {
      meta: {
        from: from || null,
        to: to || null,
        basis: 'IN movements only (INITIAL/ADJUSTMENT excluded); theoretical from frozen bomSnapshot'
      },
      rows,
      totals: {
        procured: sum('procured'),
        consumed: sum('consumed'),
        theoretical: sum('theoretical'),
        waste: sum('waste'),
        unexplained: sum('unexplained')
      }
    }
  },

  /** Delivered sales grouped by variant SKU (invoice date basis). */
  async salesBySku(from?: string, to?: string): Promise<ReportResult> {
    const range = parseRange(from, to)
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { not: 'CANCELLED' },
        ...(range.gte || range.lte ? { issuedAt: range } : {}),
        saleId: { not: null }
      },
      include: {
        sale: {
          include: { lines: { include: { variant: { include: { product: true } } } } }
        }
      },
      orderBy: { issuedAt: 'desc' }
    })
    const bySku = new Map<string, any>()
    for (const inv of invoices) {
      const sale: any = inv.sale
      if (!sale) continue
      for (const line of sale.lines) {
        const v: any = line.variant
        if (!bySku.has(line.variantId)) {
          bySku.set(line.variantId, {
            variant: v?.label || '',
            product: v?.product?.name || '',
            category: v?.product?.category || '',
            packs: 0,
            revenueExVat: 0,
            vat: 0,
            cogs: 0
          })
        }
        const row = bySku.get(line.variantId)
        row.packs += line.qty
        row.revenueExVat = round2(row.revenueExVat + (Number(line.subtotal) - Number(line.vatAmount)))
        row.vat = round2(row.vat + Number(line.vatAmount))
        row.cogs = round2(row.cogs + line.qty * Number(line.unitCost || 0))
      }
    }
    const rows = [...bySku.values()]
      .map(r => ({ ...r, grossProfit: round2(r.revenueExVat - r.cogs) }))
      .sort((a, b) => b.revenueExVat - a.revenueExVat)
    const sum = (k: string) => round2(rows.reduce((s, r) => s + r[k], 0))
    return {
      meta: { from: from || null, to: to || null, basis: 'invoice issuedAt; COGS at captured line unitCost' },
      rows,
      totals: {
        packs: rows.reduce((s, r) => s + r.packs, 0),
        revenueExVat: sum('revenueExVat'),
        vat: sum('vat'),
        cogs: sum('cogs'),
        grossProfit: sum('grossProfit')
      }
    }
  },

  /** Raw + packaging materials at or below min stock. */
  async lowRaw(): Promise<ReportResult> {
    const materials = await prisma.material.findMany({
      where: { isActive: true, category: { in: ['RAW_MATERIAL', 'PACKAGING'] } },
      include: { stocks: { where: { location: 'MAIN' } } },
      orderBy: { code: 'asc' }
    })
    const rows = materials
      .map(m => {
        const stock = Number(m.stocks[0]?.quantity || 0)
        return {
          code: m.code,
          name: m.name,
          unit: m.unitOfMeasure,
          stock: round2(stock),
          minStock: m.minStock,
          gap: round2(m.minStock - stock)
        }
      })
      .filter(r => r.stock <= r.minStock)
      .sort((a, b) => a.stock - b.stock)
    return { meta: {}, rows, totals: { count: rows.length } }
  },

  /** Single payload for the dashboard page. */
  async dashboard() {
    const today = todayRange()

    const fg = await this.fgValuation()

    const runsToday = await prisma.productionRun.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: today.gte, lte: today.lte } },
      select: { actualPacks: true }
    })

    const invoicesToday = await prisma.invoice.findMany({
      where: { status: { not: 'CANCELLED' }, issuedAt: { gte: today.gte, lte: today.lte }, saleId: { not: null } },
      include: { sale: { include: { lines: true } } }
    })
    let salesPacks = 0
    let salesValue = 0
    for (const inv of invoicesToday) {
      const sale: any = inv.sale
      if (!sale) continue
      salesPacks += sale.lines.reduce((s: number, l: any) => s + l.qty, 0)
      salesValue = round2(salesValue + Number(inv.totalAmount))
    }

    const low = await this.lowRaw()

    const recentRuns = await prisma.productionRun.findMany({
      where: { status: 'COMPLETED' },
      include: { variant: { select: { label: true, product: { select: { name: true } } } } },
      orderBy: { completedAt: 'desc' },
      take: 8
    })

    return {
      fgAvailable: fg.totals,
      todayProduction: {
        packs: runsToday.reduce((s, r) => s + (r.actualPacks || 0), 0),
        runs: runsToday.length
      },
      todaySales: { packs: salesPacks, value: salesValue },
      lowRaw: { count: (low.totals.count as number) || 0, items: low.rows.slice(0, 5) },
      recentBatches: recentRuns.map(r => ({
        runNumber: r.runNumber,
        variant: (r.variant as any)?.label || '',
        product: (r.variant as any)?.product?.name || '',
        batchNumber: r.batchNumber,
        packs: r.actualPacks,
        completedAt: r.completedAt,
        unitCost:
          (r.actualPacks || 0) > 0
            ? round2((Number(r.totalMaterialCost || 0) + Number(r.totalPackagingCost || 0)) / (r.actualPacks || 1))
            : 0
      }))
    }
  }
}

export function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
}

export type WaterReportName =
  | 'fg-valuation'
  | 'fg-grouped'
  | 'production-output'
  | 'waste'
  | 'variance'
  | 'sales-by-sku'
  | 'low-raw'

export async function runWaterReport(
  name: WaterReportName,
  query: { from?: string; to?: string; category?: string; productId?: string; variantId?: string }
): Promise<ReportResult> {
  switch (name) {
    case 'fg-valuation':
      return waterReportsService.fgValuation()
    case 'fg-grouped':
      return waterReportsService.fgGrouped({ category: query.category, productId: query.productId, variantId: query.variantId })
    case 'production-output':
      return waterReportsService.productionOutput(query.from, query.to)
    case 'waste':
      return waterReportsService.wasteByComponent(query.from, query.to)
    case 'variance':
      return waterReportsService.variance(query.from, query.to)
    case 'sales-by-sku':
      return waterReportsService.salesBySku(query.from, query.to)
    case 'low-raw':
      return waterReportsService.lowRaw()
  }
  logger.warn({ name }, 'Unknown water report requested')
  throw new Error(`Unknown report: ${name}`)
}
