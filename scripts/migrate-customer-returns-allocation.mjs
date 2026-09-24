#!/usr/bin/env node

/**
 * Backfill SaleLine.allocation for legacy DELIVERED/COMPLETED sales.
 *
 * Reconstructs a single FIFO leg from FinishedGoodStock (no FG movement ledger).
 * Marks each processed sale in CustomerReturnsAllocationPatch so re-runs skip it.
 *
 * USAGE:
 *   node scripts/migrate-customer-returns-allocation.mjs          # dry-run (default)
 *   DRY_RUN=false node scripts/migrate-customer-returns-allocation.mjs
 *
 * Reads DATABASE_URL from apps/backend/.env if not already in the environment.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, 'apps', 'backend', '.env')

function loadEnv(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!(m[1] in process.env)) process.env[m[1]] = v
    }
  } catch {
    /* missing .env is fine if DATABASE_URL already set */
  }
}

loadEnv(envPath)
if (!process.env.DATABASE_URL) {
  console.error('✗ DATABASE_URL not set (export it or add apps/backend/.env)')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const DRY_RUN = process.env.DRY_RUN !== 'false'
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '1000', 10)

function needsPatch(allocation) {
  if (allocation == null) return true
  if (!Array.isArray(allocation)) return true
  if (allocation.length === 0) return true
  if (!allocation[0]?.batchNumber) return true
  return false
}

async function reconstructBatch(tenantId, variantId, saleCreatedAt, qty) {
  const candidates = await prisma.finishedGoodStock.findMany({
    where: { tenantId, variantId },
    orderBy: { createdAt: 'asc' }
  })
  const fgStore = candidates.filter((s) => s.location === 'FG_STORE')
  const eligible =
    fgStore.find((s) => s.createdAt <= saleCreatedAt) ||
    fgStore[0] ||
    candidates[candidates.length - 1]
  if (!eligible?.batchNumber) return null
  return { stockId: eligible.id, batchNumber: eligible.batchNumber, qty }
}

async function findCandidateSales() {
  return prisma.$queryRaw`
    SELECT s.id, s."saleNumber", s."tenantId", s."createdAt"
    FROM "Sale" s
    WHERE s.status IN ('DELIVERED', 'COMPLETED')
      AND EXISTS (
        SELECT 1 FROM "SaleLine" sl
        WHERE sl."saleId" = s.id
          AND (
            sl.allocation IS NULL
            OR jsonb_typeof(sl.allocation) IS DISTINCT FROM 'array'
            OR (
              jsonb_typeof(sl.allocation) = 'array'
              AND (
                jsonb_array_length(sl.allocation) = 0
                OR NOT (sl.allocation -> 0 ? 'batchNumber')
              )
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "CustomerReturnsAllocationPatch" p WHERE p."saleId" = s.id
      )
    ORDER BY s."createdAt" ASC
    LIMIT ${BATCH_SIZE}
  `
}

async function main() {
  console.log('Customer Returns Allocation Backfill')
  console.log(`  Dry run: ${DRY_RUN ? 'yes (no writes)' : 'NO — will write'}`)
  console.log(`  Batch size: ${BATCH_SIZE}`)
  console.log('')

  const sales = await findCandidateSales()
  if (sales.length === 0) {
    console.log('✓ No sales need allocation backfill')
    return
  }

  console.log(`Found ${sales.length} sale(s) with missing allocation\n`)

  let totalSales = 0
  let totalLinesPatched = 0
  let totalLinesSkipped = 0

  for (const sale of sales) {
    const lines = await prisma.saleLine.findMany({
      where: { saleId: sale.id },
      select: { id: true, variantId: true, qty: true, allocation: true }
    })
    const badLines = lines.filter((l) => needsPatch(l.allocation))
    const goodLines = lines.length - badLines.length

    const reconstructed = []
    for (const line of badLines) {
      const batch = await reconstructBatch(sale.tenantId, line.variantId, sale.createdAt, line.qty)
      if (batch) reconstructed.push({ line, batch })
    }

    const note = reconstructed.length === badLines.length
      ? `patch ${reconstructed.length}/${badLines.length} missing line(s)`
      : `patch ${reconstructed.length}/${badLines.length} missing line(s) (${badLines.length - reconstructed.length} no FG stock — left null for runtime RET- fallback)`
    console.log(`  ${sale.saleNumber}: ${note}${goodLines ? `, ${goodLines} line(s) already allocated` : ''}`)

    totalSales++
    totalLinesPatched += reconstructed.length
    totalLinesSkipped += badLines.length - reconstructed.length

    if (DRY_RUN) continue

    await prisma.$transaction(async (tx) => {
      for (const { line, batch } of reconstructed) {
        await tx.saleLine.update({
          where: { id: line.id },
          data: { allocation: [batch] }
        })
      }
      await tx.customerReturnsAllocationPatch.create({
        data: {
          tenantId: sale.tenantId,
          saleId: sale.id,
          saleNumber: sale.saleNumber,
          linePatched: reconstructed.length,
          executedAt: new Date()
        }
      })
    })
  }

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Sales processed:     ${totalSales}`)
  console.log(`Lines patched:       ${totalLinesPatched}`)
  console.log(`Lines left null:     ${totalLinesSkipped}`)
  console.log(`Dry run:             ${DRY_RUN ? 'yes (no writes)' : 'no (writes applied)'}`)
  console.log('='.repeat(60))

  if (!DRY_RUN) {
    const remaining = await findCandidateSales()
    console.log(`Remaining candidates: ${remaining.length}`)
  } else {
    console.log('\nApply with: DRY_RUN=false node scripts/migrate-customer-returns-allocation.mjs')
  }
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
