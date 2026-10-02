// Tenant delete probe: verifies deleteTenant handles all MTS-era FK families.
// Run from apps/backend: npx tsx ../../scripts/tenant-delete-probe.ts
import 'dotenv/config'
import { prisma } from '../apps/backend/src/database'
import { platformService } from '../apps/backend/src/modules/platform/service'

async function main() {
  const slug = `probe-del-${Date.now()}`
  const tenant = await prisma.tenant.create({ data: { name: 'Delete Probe', slug } })
  const t = tenant.id

  try {
    const customer = await prisma.customer.create({ data: { tenantId: t, name: 'Probe Cust', code: 'C1' } as any })
    const supplier = await prisma.supplier.create({ data: { tenantId: t, name: 'Probe Sup', code: 'S1' } as any })
    const material = await prisma.material.create({ data: { tenantId: t, code: 'M1', name: 'Preform', category: 'RAW_MATERIAL', unitOfMeasure: 'pcs' } as any })
    const product = await prisma.product.create({ data: { tenantId: t, code: 'P1', name: 'Water', category: 'BOTTLED' } as any })
    const variant = await prisma.productVariant.create({ data: { tenantId: t, productId: product.id, label: '33cl', packSize: 12, pricePerUnit: 500 } as any })
    const sale = await prisma.sale.create({ data: { tenantId: t, saleNumber: 'S-1', customerId: customer.id, totalAmount: 500 } as any })
    await prisma.saleLine.create({ data: { tenantId: t, saleId: sale.id, variantId: variant.id, qty: 1, unitPrice: 500, subtotal: 500, vatAmount: 0 } as any })
    await prisma.customerCreditNote.create({ data: { tenantId: t, creditNoteNumber: 'CN-1', customerId: customer.id, saleId: sale.id, variantId: variant.id, quantity: 1, unitPrice: 500, amount: 500, vatAmount: 0, exVatAmount: 500, reason: 'probe', disposition: 'RESTOCK' } as any })
    await prisma.customerReturnsAllocationPatch.create({ data: { tenantId: t, saleId: sale.id, saleNumber: 'S-1' } as any })
    const session = await prisma.guideAngelSession.create({ data: { tenantId: t, createdById: 'probe' } as any })
    await prisma.guideAngelOpeningBalance.create({ data: { tenantId: t, sessionId: session.id, type: 'CUSTOMER_DEPOSIT', customerId: customer.id, supplierId: supplier.id, reference: 'r', date: new Date(), amount: 100 } as any })
    await prisma.supplierCreditNote.create({ data: { tenantId: t, creditNoteNumber: 'SCN-1', supplierId: supplier.id, amount: 50, reason: 'probe' } as any })
    await prisma.finishedGoodStock.create({ data: { tenantId: t, variantId: variant.id, batchNumber: 'B1', quantity: 10, unitCost: 40 } as any })
    const run = await prisma.productionRun.create({ data: { tenantId: t, runNumber: 'PR-1', variantId: variant.id, batchNumber: 'B1', plannedPacks: 10 } as any })
    await prisma.productionRunComponentUsage.create({ data: { tenantId: t, runId: run.id, materialId: material.id, plannedQty: 120, actualQty: 120 } as any })
    await prisma.bOM.create({ data: { tenantId: t, variantId: variant.id, componentMaterialId: material.id, qtyPerPack: 12 } as any })
    await prisma.taxProvision.create({ data: { tenantId: t, year: 2026, period: '2026', netProfit: 1000, citRate: 0.3, citAmount: 300 } as any })
    await prisma.payeEntry.create({ data: { tenantId: t, year: 2026, month: 9, amount: 100, period: '2026-09' } as any })
    const account = await prisma.account.create({ data: { code: '1000', name: 'Cash', type: 'ASSET', tenantId: t } as any })
    const je = await prisma.journalEntry.create({ data: { tenantId: t, entryNumber: 'JE-1', date: new Date(), sourceModule: 'SALES', description: 'probe' } as any })
    await prisma.journalLine.create({ data: { tenantId: t, journalEntryId: je.id, accountId: account.id, debit: 500, credit: 0 } as any })
    console.log('seeded: all MTS-era FK families')

    await platformService.deleteTenant(t)

    const orphanSale = await prisma.sale.count({ where: { tenantId: t } })
    const orphanCust = await prisma.customer.count({ where: { tenantId: t } })
    const orphanRun = await prisma.productionRun.count({ where: { tenantId: t } })
    const gone = await prisma.tenant.findUnique({ where: { id: t } })
    if (orphanSale + orphanCust + orphanRun > 0 || gone) {
      throw new Error('probe failed: rows remain after deleteTenant')
    }
    console.log(`PASS: tenant ${slug} deleted with all MTS-era FK families`)
  } finally {
    const still = await prisma.tenant.findUnique({ where: { id: t } })
    if (still) {
      try { await platformService.deleteTenant(t); console.log('cleaned up partially-seeded tenant') } catch (e) { console.error('cleanup failed — inspect tenant', t, e) }
    }
  }
}

main()
  .catch((e) => { console.error('FAIL:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
