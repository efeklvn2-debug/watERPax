import 'dotenv/config'
import { prisma } from '../apps/backend/src/database'
import { runWithTenant } from '../apps/backend/src/context'
import { waterReportsService } from '../apps/backend/src/modules/reports/waterReports'

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { name: 'Acmed' } })
  if (!tenant) throw new Error('Acmed tenant not found')
  await runWithTenant(tenant.id, async () => {
    const d = await waterReportsService.dashboard() as any
    console.log('fgAvailable:', JSON.stringify(d.fgAvailable))
    console.log('todayProduction:', JSON.stringify(d.todayProduction))
    console.log('todaySales:', JSON.stringify(d.todaySales))
    console.log('lowRaw: count=' + d.lowRaw.count, 'outCount=' + d.lowRaw.outCount, 'items=' + d.lowRaw.items.length)
    if (!d.fgAvailable.byCategory) throw new Error('fgAvailable.byCategory missing')
    if (!d.todayProduction.byCategory) throw new Error('todayProduction.byCategory missing')
    if (d.todaySales.collected === undefined || d.todaySales.outstanding === undefined) throw new Error('sales split missing')
    if (d.lowRaw.outCount === undefined) throw new Error('lowRaw.outCount missing')
    console.log('PASS: enriched dashboard payload complete')
  })
  await prisma.$disconnect()
}
main().catch(e => { console.error('FAIL:', e); process.exit(1) })
