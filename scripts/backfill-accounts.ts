#!/usr/bin/env node
/**
 * Backfill missing COA accounts (5310-5340) for all existing tenants.
 * Run once: npx tsx scripts/backfill-accounts.ts
 * Uses Prisma directly — no API auth needed.
 */
import { PrismaClient } from '@prisma/client'

const MISSING_ACCOUNTS = [
  { code: '5310', name: 'Production Waste',       type: 'COGS',    description: 'Production waste expense' },
  { code: '5320', name: 'Damaged Goods',          type: 'EXPENSE', description: 'Damaged goods write-off' },
  { code: '5330', name: 'Theft & Unexplained Loss', type: 'EXPENSE', description: 'Theft and unexplained loss' },
  { code: '5340', name: 'Internal Use',           type: 'EXPENSE', description: 'Internal consumption expense' },
]

const prisma = new PrismaClient()

async function main() {
  console.log('=== Backfill COA Accounts for Existing Tenants ===\n')

  const tenants = await prisma.tenant.findMany({ where: { isActive: true } })
  console.log(`Found ${tenants.length} active tenant(s)\n`)

  let totalCreated = 0
  let totalSkipped = 0

  for (const tenant of tenants) {
    const existing = await prisma.account.findMany({
      where: { tenantId: tenant.id, code: { in: MISSING_ACCOUNTS.map(a => a.code) } }
    })
    const existingCodes = new Set(existing.map(a => a.code))
    const toCreate = MISSING_ACCOUNTS.filter(a => !existingCodes.has(a.code))

    if (toCreate.length === 0) {
      console.log(`  ${tenant.name}: already up to date (${existingCodes.size} of ${MISSING_ACCOUNTS.length})`)
      totalSkipped += MISSING_ACCOUNTS.length
      continue
    }

    const created = await prisma.account.createMany({
      data: toCreate.map(a => ({ ...a, tenantId: tenant.id } as any)),
    })
    console.log(`  ${tenant.name}: created ${created.count} account(s) — [${toCreate.map(a => a.code).join(', ')}]`)
    totalCreated += created.count
  }

  console.log(`\nDone. Created: ${totalCreated}, Already existed: ${totalSkipped}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
