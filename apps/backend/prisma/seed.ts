import bcrypt from 'bcryptjs'
import { runWithTenant } from '../src/context'
import { prisma } from '../src/database'
import { DEFAULT_ACCOUNTS } from '@waterpax/types'

async function main() {
  console.log('Seeding watERPax database...')

  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  // ── SUPER ADMIN (no tenant) ───────────────────────────────────────
  const superAdminHash = await bcrypt.hash(adminPassword, 12)
  await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: {},
    create: {
      username: 'superadmin',
      passwordHash: superAdminHash,
      role: 'SUPER_ADMIN',
    }
  })
  console.log('Created SUPER_ADMIN user (superadmin / ' + adminPassword + ')')

  // ── Default Tenant ────────────────────────────────────────────────
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'demo' } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { slug: 'demo', name: 'Demo Water Factory' }
    })
    console.log('Created default tenant: Demo Water Factory')
  }

  // ── All tenant-scoped data ────────────────────────────────────────
  await runWithTenant(tenant.id, async () => {
    const passwordHash = await bcrypt.hash(adminPassword, 12)

    await prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: {
        username: 'admin',
        passwordHash,
        role: 'ADMIN',
        tenantId: tenant!.id,
      }
    })
    console.log('Created admin user (admin / ' + adminPassword + ') for Demo Water Factory')

    const makeUser = async (username: string, role: string) => {
      const h = await bcrypt.hash('test123', 10)
      await prisma.user.upsert({
        where: { username },
        update: {},
        create: { username, passwordHash: h, role: role as any, tenantId: tenant!.id }
      })
      console.log(`Created ${role.toLowerCase()} user (${username}/test123)`)
    }
    await makeUser('manager', 'MANAGER')
    await makeUser('operator', 'OPERATOR')
    await makeUser('viewer', 'VIEWER')

    // ── Permissions (water-native) ───────────────────────────────────
    const permDefs = [
      { name: 'auth:read',                description: 'View own profile',                        module: 'auth' },
      { name: 'auth:manage_users',         description: 'Create and manage users',                 module: 'auth' },
      // Product catalog (tenant-configurable variants)
      { name: 'product:read',              description: 'View products and variants',              module: 'products' },
      { name: 'product:write',             description: 'Create/edit products, variants and BOM',  module: 'products' },
      // Production MTS
      { name: 'production:read',           description: 'View production runs',                    module: 'production' },
      { name: 'production:plan',           description: 'Create/plan production runs',             module: 'production' },
      { name: 'production:complete',       description: 'Complete runs and post FG',              module: 'production' },
      { name: 'production:cancel',         description: 'Cancel production runs',                  module: 'production' },
      // Sales MTS + POS
      { name: 'sales:read',                description: 'View sales',                              module: 'sales' },
      { name: 'sales:create',              description: 'Create sales',                            module: 'sales' },
      { name: 'sales:confirm',             description: 'Confirm sales (allocate FG)',             module: 'sales' },
      { name: 'sales:deliver',             description: 'Deliver sales and post revenue/COGS',     module: 'sales' },
      { name: 'sales:payment',             description: 'Record payments',                         module: 'sales' },
      { name: 'sales:discount',            description: 'Override line item price (manual discount)', module: 'sales' },
      { name: 'sales:return',             description: 'Process customer returns and credit notes', module: 'sales' },
      // Inventory & FG
      { name: 'inventory:read',            description: 'View inventory and FG stock',             module: 'inventory' },
      { name: 'inventory:create',          description: 'Add new materials',                       module: 'inventory' },
      { name: 'inventory:edit',            description: 'Edit material definitions',               module: 'inventory' },
      { name: 'inventory:adjust',          description: 'Adjust stock quantities',                 module: 'inventory' },
      { name: 'inventory:dispose',         description: 'Dispose or write off stock',              module: 'inventory' },
      { name: 'fg:read',                   description: 'View FG stock',                           module: 'fg' },
      { name: 'fg:adjust',                 description: 'Adjust FG stock',                         module: 'fg' },
      // Procurement & suppliers
      { name: 'procurement:read',          description: 'View purchase orders',                    module: 'procurement' },
      { name: 'procurement:create',        description: 'Create purchase orders',                  module: 'procurement' },
      { name: 'procurement:receive',       description: 'Receive PO items into inventory',         module: 'procurement' },
      { name: 'procurement:return',        description: 'Return received items to supplier (credit notes)', module: 'procurement' },
      { name: 'procurement:edit',          description: 'Edit purchase orders',                    module: 'procurement' },
      { name: 'finance:read',              description: 'View accounts and journal entries',        module: 'finance' },
      { name: 'finance:write',             description: 'Post manual journal entries',              module: 'finance' },
      { name: 'finance:manage_accounts',   description: 'Add or edit chart of accounts',           module: 'finance' },
      { name: 'settings:read',             description: 'View business settings',                  module: 'settings' },
      { name: 'settings:write',            description: 'Update business settings',                module: 'settings' },
      { name: 'customer:read',             description: 'View customers',                          module: 'customers' },
      { name: 'customer:create',           description: 'Add new customers',                       module: 'customers' },
      { name: 'customer:edit',             description: 'Edit customer details',                   module: 'customers' },
      { name: 'customer:payment',          description: 'Record customer payments and deposits',    module: 'customers' },
      { name: 'supplier:read',             description: 'View suppliers',                          module: 'suppliers' },
      { name: 'supplier:create',           description: 'Add suppliers',                           module: 'suppliers' },
      { name: 'supplier:edit',             description: 'Edit supplier details',                   module: 'suppliers' },
      { name: 'report:read',               description: 'View reports',                            module: 'reports' },
      { name: 'audit:read',                description: 'View audit log',                          module: 'audit' },
      { name: 'pricing:read',              description: 'View price lists',                        module: 'pricing' },
      { name: 'pricing:write',             description: 'Set and update price lists',              module: 'pricing' },
      { name: 'tax:manage',                description: 'View and manage tax provisions',          module: 'tax' },
      // Legacy (kept for compatibility until P2 removes MTO UI)
      { name: 'sales_order:read',          description: '(legacy) View sales orders',              module: 'sales_orders' },
      { name: 'sales_order:create',        description: '(legacy) Create sales orders',            module: 'sales_orders' },
    ] as const

    const perms = new Map<string, string>()
    for (const p of permDefs) {
      const created = await prisma.permission.upsert({
        where: { name: p.name },
        update: { description: p.description, module: p.module },
        create: { name: p.name, description: p.description, module: p.module }
      })
      perms.set(p.name, created.id)
    }
    console.log(`Created ${permDefs.length} permissions`)

    type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'
    const rolePerms: Record<Role, string[]> = {
      ADMIN: permDefs.map(p => p.name),
      MANAGER: permDefs.filter(p => p.name !== 'auth:manage_users' && p.name !== 'tax:manage').map(p => p.name),
      OPERATOR: permDefs.filter(p => p.name !== 'auth:manage_users' && p.name !== 'audit:read' && p.name !== 'tax:manage' && p.name !== 'finance:manage_accounts').map(p => p.name),
      VIEWER: [
        'auth:read', 'product:read', 'production:read', 'inventory:read', 'fg:read',
        'procurement:read', 'finance:read', 'settings:read', 'customer:read', 'supplier:read',
        'report:read', 'pricing:read', 'sales:read',
      ],
    }

    for (const [role, permNames] of Object.entries(rolePerms)) {
      const data = permNames
        .map(name => perms.get(name))
        .filter((id): id is string => !!id)
        .map(permissionId => ({ role: role as Role, permissionId }))
      if (data.length > 0) {
        await prisma.rolePermission.createMany({ data, skipDuplicates: true })
      }
    }
    console.log('Created role → permission mappings')

    // ── Water Materials ───────────────────────────────────────────────
    const materials = [
      // Preforms (family, grammage per lot)
      { code: 'PF33', name: 'Preform 33cl', category: 'RAW_MATERIAL' as const, subCategory: 'Preform-33cl', unitOfMeasure: 'pcs', costPrice: 12, minStock: 1000 },
      { code: 'PF50', name: 'Preform 50cl', category: 'RAW_MATERIAL' as const, subCategory: 'Preform-50cl', unitOfMeasure: 'pcs', costPrice: 14, minStock: 1000 },
      { code: 'PF75', name: 'Preform 75cl', category: 'RAW_MATERIAL' as const, subCategory: 'Preform-75cl', unitOfMeasure: 'pcs', costPrice: 18, minStock: 1000 },
      { code: 'PF150', name: 'Preform 150cl', category: 'RAW_MATERIAL' as const, subCategory: 'Preform-150cl', unitOfMeasure: 'pcs', costPrice: 28, minStock: 500 },
      { code: 'CAP', name: 'Cap', category: 'RAW_MATERIAL' as const, subCategory: 'Cap', unitOfMeasure: 'pcs', costPrice: 2, minStock: 2000 },
      { code: 'LAB', name: 'Label', category: 'RAW_MATERIAL' as const, subCategory: 'Label', unitOfMeasure: 'pcs', costPrice: 1.5, minStock: 2000 },
      { code: 'SHR', name: 'Shrink Wrap Nylon', category: 'PACKAGING' as const, subCategory: 'ShrinkWrap', unitOfMeasure: 'kg', costPrice: 2800, minStock: 20 },
      // Sachet
      { code: 'NYL', name: 'Printed Nylon (Sachet)', category: 'RAW_MATERIAL' as const, subCategory: 'PrintedNylon', unitOfMeasure: 'kg', costPrice: 2400, minStock: 50 },
      { code: 'BAG20', name: 'Packing Bag 20-micron', category: 'PACKAGING' as const, subCategory: 'PackingBag-20', unitOfMeasure: 'pcs', costPrice: 8, minStock: 500 },
      // Jar
      { code: 'JAR20', name: 'Empty Jar 20L', category: 'RAW_MATERIAL' as const, subCategory: 'EmptyJar-20L', unitOfMeasure: 'pcs', costPrice: 650, minStock: 50 },
      { code: 'JCAP', name: 'Jar Cap', category: 'RAW_MATERIAL' as const, subCategory: 'JarCap', unitOfMeasure: 'pcs', costPrice: 15, minStock: 100 },
      // Legacy flex materials kept for compile (will be phased out)
      { code: 'PR25', name: '25 Microns (legacy)', category: 'RAW_MATERIAL' as const, subCategory: '25microns', unitOfMeasure: 'kg', costPrice: 2900 },
      { code: 'PBAG', name: 'Packing Bag (legacy)', category: 'PACKAGING' as const, subCategory: 'PackingBag', unitOfMeasure: 'pcs', costPrice: 1250 },
    ]

    for (const mat of materials) {
      const existing = await prisma.material.findFirst({
        where: { tenantId: tenant!.id, code: mat.code }
      })
      if (!existing) {
        await prisma.material.create({ data: mat as any })
      }
    }
    console.log(`Created ${materials.length} materials`)

    const allMats = await prisma.material.findMany({ where: { tenantId: tenant!.id } })
    for (const mat of allMats) {
      await prisma.stock.upsert({
        where: { materialId_location: { materialId: mat.id, location: 'MAIN' } },
        update: {},
        create: { materialId: mat.id, quantity: 0, location: 'MAIN', tenantId: tenant!.id }
      })
    }
    console.log('Created stock locations')

    const existingCustomer = await prisma.customer.findFirst({
      where: { tenantId: tenant!.id, name: 'Walk-In' }
    })
    if (!existingCustomer) {
      await prisma.customer.create({
        data: { name: 'Walk-In', code: 'WALKIN', isActive: true, tenantId: tenant!.id } as any
      })
      console.log('Created Walk-In customer')
    }



    // ── Water Products (tenant-configurable variants — seed is starter, editable) ──
    const bottled = await prisma.product.upsert({
      where: { tenantId_code: { tenantId: tenant!.id, code: 'BOTTLED' } },
      update: {},
      create: { tenantId: tenant!.id, name: 'Bottled Water', category: 'BOTTLED' as any, code: 'BOTTLED', isActive: true }
    })
    const sachet = await prisma.product.upsert({
      where: { tenantId_code: { tenantId: tenant!.id, code: 'SACHET' } },
      update: {},
      create: { tenantId: tenant!.id, name: 'Sachet Water', category: 'SACHET' as any, code: 'SACHET', isActive: true }
    })
    const jar = await prisma.product.upsert({
      where: { tenantId_code: { tenantId: tenant!.id, code: 'JAR' } },
      update: {},
      create: { tenantId: tenant!.id, name: 'Refill Jar', category: 'JAR' as any, code: 'JAR', isActive: true }
    })
    console.log('Created 3 products (BOTTLED/SACHET/JAR)')

    const variants = [
      { productId: bottled.id, label: '33cl', packSize: 20, unitOfMeasure: 'pack', pricePerUnit: 1800 },
      { productId: bottled.id, label: '50cl', packSize: 12, unitOfMeasure: 'pack', pricePerUnit: 1800 },
      { productId: bottled.id, label: '75cl', packSize: 12, unitOfMeasure: 'pack', pricePerUnit: 2200 },
      { productId: bottled.id, label: '150cl', packSize: 6, unitOfMeasure: 'pack', pricePerUnit: 2400 },
      { productId: sachet.id, label: 'Sachet-20', packSize: 1, unitOfMeasure: 'bag', pricePerUnit: 350 },
      { productId: jar.id, label: 'Jar-20L', packSize: 1, unitOfMeasure: 'jar', pricePerUnit: 1200, refillPrice: 750 },
    ]
    for (const v of variants) {
      await prisma.productVariant.upsert({
        where: { tenantId_productId_label: { tenantId: tenant!.id, productId: v.productId, label: v.label } },
        update: { packSize: v.packSize, pricePerUnit: v.pricePerUnit, refillPrice: (v as any).refillPrice ?? null },
        create: { ...v, tenantId: tenant!.id } as any
      })
    }
    console.log(`Created ${variants.length} product variants (editable)`)

    // BOMs — per variant (qtyPerPack). Grammage policy here is 16.5g for 50cl as example
    const matByCode = new Map(allMats.map(m => [m.code, m]))
    const vByLabel = new Map((await prisma.productVariant.findMany({ where: { tenantId: tenant!.id } })).map(v => [v.label, v]))
    const bomDefs: Array<{ label: string; components: Array<{ code: string; qty: number; grammage?: number }> }> = [
      { label: '33cl', components: [{ code: 'PF33', qty: 20 }, { code: 'CAP', qty: 20 }, { code: 'LAB', qty: 20 }, { code: 'SHR', qty: 0.04 }] },
      { label: '50cl', components: [{ code: 'PF50', qty: 12, grammage: 16.5 }, { code: 'CAP', qty: 12 }, { code: 'LAB', qty: 12 }, { code: 'SHR', qty: 0.03 }] },
      { label: '75cl', components: [{ code: 'PF75', qty: 12 }, { code: 'CAP', qty: 12 }, { code: 'LAB', qty: 12 }, { code: 'SHR', qty: 0.04 }] },
      { label: '150cl', components: [{ code: 'PF150', qty: 6 }, { code: 'CAP', qty: 6 }, { code: 'LAB', qty: 6 }, { code: 'SHR', qty: 0.05 }] },
      { label: 'Sachet-20', components: [{ code: 'NYL', qty: 0.25 }, { code: 'BAG20', qty: 1 }] },
      { label: 'Jar-20L', components: [{ code: 'JAR20', qty: 1 }, { code: 'JCAP', qty: 1 }, { code: 'LAB', qty: 1 }, { code: 'BAG20', qty: 1 }] },
    ]
    for (const def of bomDefs) {
      const variant = vByLabel.get(def.label)
      if (!variant) continue
      for (const c of def.components) {
        const mat = matByCode.get(c.code)
        if (!mat) continue
        const existing = await prisma.bOM.findFirst({ where: { tenantId: tenant!.id, variantId: variant.id, componentMaterialId: mat.id } })
        if (!existing) {
          await prisma.bOM.create({
            data: {
              variantId: variant.id,
              componentMaterialId: mat.id,
              qtyPerPack: c.qty,
              grammage: c.grammage ?? null,
              tenantId: tenant!.id,
            } as any
          })
        }
      }
    }
    console.log('Created BOMs for 6 variants')

    const accounts = DEFAULT_ACCOUNTS.map(a => ({ ...a, tenantId: tenant!.id }))
    await prisma.account.createMany({ data: accounts as any, skipDuplicates: true })
    console.log(`Created ${accounts.length} chart of accounts (water-extended)`)

    const existingSettings = await prisma.settings.findFirst({ where: { tenantId: tenant!.id } })
    if (!existingSettings) {
      await prisma.settings.create({ data: { tenantId: tenant!.id, jarMaterialCode: 'JAR20' } as any })
      console.log('Created default settings')
    }
  })

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
