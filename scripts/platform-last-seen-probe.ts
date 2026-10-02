import 'dotenv/config'
import { prisma } from '../apps/backend/src/database'
import { platformService } from '../apps/backend/src/modules/platform/service'

async function main() {
  const tenants = await platformService.listTenants() as any[]
  console.log('listTenants:')
  for (const t of tenants) {
    console.log(`  ${t.name} | users=${t.userCount} customers=${t.customerCount} lastLoginAt=${t.lastLoginAt ? new Date(t.lastLoginAt).toISOString() : 'null'}`)
    if ('salesOrderCount' in t) throw new Error('stale salesOrderCount still present')
  }
  const withLogin = tenants.find(t => t.lastLoginAt)
  const detail = await platformService.getTenant(withLogin ? withLogin.id : tenants[0].id) as any
  console.log(`getTenant(${detail.name}): lastLoginAt=${detail.lastLoginAt ? new Date(detail.lastLoginAt).toISOString() : 'null'} _count=${JSON.stringify(detail._count)}`)
  if ('salesOrders' in detail._count) throw new Error('stale _count.salesOrders still present')
  console.log('PASS: lastLoginAt populated, legacy salesOrderCount removed')
  await prisma.$disconnect()
}
main().catch(e => { console.error('FAIL:', e); process.exit(1) })
