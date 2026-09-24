# watERPax — Locked Implementation Plan

**Date:** 2026-08-29  
**Status:** LOCKED — approved for build  
**Model:** Make-to-Stock (MTS) — decoupled Sales & Production  
**Source lineage:** FlexoPrint ERP (`C:/Users/USER/Desktop/rebuilding/To WebApp Project/FlexoPrint ERP`)  
**Target repo:** `C:/Users/USER/Desktop/watERPax` (new, independent)  
**Workflow:** Local-first → deploy when green (same as FlexoPrint)

---

## 0. Executive Summary

watERPax re-purposes the production-hardened FlexoPrint foundation (multi-tenancy, JWT auth, RBAC, finance double-entry, procurement, audit) for the Nigerian water-packaging business model: **produce to stock, sell from stock**. Three product lines: **Bottled water** (tenant-configurable variants e.g. 33cl/50cl/75cl/150cl — extensible to any size), **Sachet water** (20 sachets/bag by default, configurable), **Refill jars**. Sales and production are independent: production creates `Finished Goods` batches, sales allocates from `FG Store` and invoices immediately. The flexo-specific domain (`Roll`, `PrintedRoll`, `InkColor`, ink/solvent rates, `coreWeight`) is deleted. Preform grammage (e.g. 16.5g → 14.5g vendor compromise) is tracked per procurement lot, not per global Material.

New repo, separate DB (`waterpax`) on same Hetzner VPS, new domain, zero touch on `phlexERP` production (`46.224.0.165`, `phlexerp.com.ng`).

---

## 1. Business Process (Consultant View)

### 1.1 Bottled Water

`Pre-forms (procured, grammage-spec per lot) → blown → PET bottles → filling line (caps+labels) → packed into packs (tenant packSize: e.g. 12×75cl, 20×33cl) with shrink-wrap nylon (kg) → FG Store → sale`.

Items per pack (via BOM): `N bottles (= packSize) + N caps + N labels + wrapKgPerPack`. Water itself is not a stock item (treated water assumed available). Optional outermost `PACKAGING` stock for shrink-wrap measured in kg, depleted per pack.

### 1.2 Sachet Water

`Flexo printed nylon (procured in kg) → sachet machine → 20 sachets per bag (tenant configurable) → BG Store → sale`. Items: `printed roll kg + packing bag pcs`. Each bag is the sellable unit.

### 1.3 Refill Jars

`Empty jars + caps + labels + packing bags → FG Store → sale (outright or returnable with deposit liability if tenant enables)`.

### 1.4 Key MTS Property

Production is **forecast/stock-driven** (min-stock alert, manual ProductionRun), not order-driven. No `customerId` on jobs. Sales is **availability-driven**: check `FinishedGoodStock`, allocate, invoice instantly (credit or cash). No `PENDING→APPROVED→IN_PRODUCTION→READY` chain.

---

## 2. Architecture — What Is Kept vs Deleted vs Built

### 2.1 Kept Verbatim (~60% — the hard part already proven)

- **Tenancy:** shared-DB shared-schema `tenantId` + `AsyncLocalStorage` + Prisma `$extends` auto-inject (`context.ts`, `database/index.ts`). Every `$queryRaw` retains `AND "tenantId" = ${getCurrentTenantId()}`.
- **Auth:** JWT `jsonwebtoken` + `bcryptjs` (12 rounds), `httpOnly` cookies `waterpax_at` 15m / `waterpax_rt` 7d, double-submit CSRF `X-WaterPax-CSRF`, login lockout (`failedLoginAttempts/lockedUntil`), TOTP, honeypot, 8 rate limiters, Helmet CSP/HSTS.
- **RBAC:** `Permission` + `RolePermission` + `UserPermission` + `requirePermission()` / `loadUser`. Re-seed perms for water (see §4).
- **Platform (SUPER_ADMIN):** tenant lifecycle, `POST /platform/tenants` + seed defaults.
- **Finance engine:** `Account` parent/child, `JournalEntry/JournalLine`, `postJournalEntry` double-entry, `validateJournalDate` + `Settings.booksLockedUntil` period lock, negative-cash guard, `lib/vat-utils.ts:decomposeInclusive`, parent aggregation fixes.
- **Procurement/Suppliers:** `PurchaseOrder` + `POLineItem` + `SupplierInvoice/PaymentMade` + `Supplier` registry. Extend only for preform spec.
- **Inventory base:** `Material` + `Stock` (Float qty, location MAIN/FG_STORE) + `StockMovement {IN,OUT,ADJUSTMENT}` + `adjustStock` GL (`Dr 1300/Cr 5400`), `addStock`, `recordPackingBagChange`. Keep case-insensitive `CORE`-like lookups pattern.
- **Audit/Reports shell/Health/Tax/Settings shell:** keep routing, extend content.

### 2.2 Deleted

- `InkColor` table + `/api/settings/ink-colors` CRUD + seed (`InkColor` model, `DEFAULT_INK_COLORS`).
- `Settings` ink/solvent fields: `inkConsumptionRate`, `ipaConsumptionRate`, `butanolConsumptionRate`, `tolueneConsumptionRate`, `inkCostPerKg`, `coreWeight`, `coreDepositValue` (replace with water defaults if needed).
- `Roll` + `PrintedRoll` + `MaterialIssue` + `OverheadRateHistory` + `production/service.ts` ink/FIFO/combo logic + `createRolls` `PRxxxxx`.
- Flexo `SalesOrder` MTO state machine (8 statuses), `salesOrderService.startProduction`, `recordPickup` roll-pickup coupling. Archive table for one release, hide route.

### 2.3 Rebuilt (≈40% — new domain)

`Product` → `ProductVariant` → `BOM` → `ProductionRun` → `ProductionRunComponentUsage` → `FinishedGoodStock` → `Sale`/`SaleLine` → `Invoice`/`Payment`/`Receipt` (repoint). Variance + waste reports. POS 80mm receipt.

---

## 3. Data Model (waterpax `schema.prisma` delta)

### 3.1 MaterialCategory (generalized)

```prisma
enum MaterialCategory { RAW_MATERIAL PACKAGING FINISHED_GOOD CONSUMABLE }
// RAW_MATERIAL: Preform-family, Caps, Labels, ShrinkWrap-kg, PrintedNylon-kg, EmptyJar
// PACKAGING: ShrinkWrap-kg (wrap), SachetBag-pcs
// FINISHED_GOOD: optional legacy if Product-as-Material path chosen (prefer Product table)
// CONSUMABLE: filters/cleaners if needed
enum ProductCategory { BOTTLED SACHET JAR }
```

### 3.2 New Masters

```prisma
model Product {
  id        String @id @default(cuid())
  tenantId  String
  tenant    Tenant @relation(fields:[tenantId], references:[id])
  name      String // "Bottled Water"
  category  ProductCategory
  code      String // tenant-unique
  isActive  Boolean @default(true)
  variants  ProductVariant[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([tenantId, code])
  @@index([tenantId])
}

model ProductVariant {
  id           String  @id @default(cuid())
  productId    String
  product      Product @relation(fields:[productId], references:[id], onDelete:Cascade)
  tenantId     String
  tenant       Tenant  @relation(fields:[tenantId], references:[id])
  label        String  // "33cl" | "50cl" | "Any custom" — free-form, not enum
  packSize     Int     // bottles/bags per pack — tenant-configurable (12 vs 20 vs 6)
  unitOfMeasure String @default("pack") // pack | bag | jar
  // Price is VAT-inclusive per your clarification #4, editable at invoice time for discounts
  pricePerUnit Decimal @db.Decimal(12,2)
  isActive     Boolean @default(true)
  boms         BOM[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([tenantId, productId, label])
  @@index([productId])
}

model BOM {
  id                  String   @id @default(cuid())
  variantId           String
  variant             ProductVariant @relation(fields:[variantId], references:[id], onDelete:Cascade)
  componentMaterialId String
  material            Material @relation(fields:[componentMaterialId], references:[id])
  qtyPerPack          Decimal  @db.Decimal(10,4) // e.g. 12 preforms, 0.04 kg wrap
  grammage            Decimal? @db.Decimal(6,2) // policy grammage for preform (16.5g)
  wastagePct          Decimal  @default(0) @db.Decimal(5,2)
  tenantId            String
  tenant              Tenant @relation(fields:[tenantId], references:[id])
  @@index([variantId])
  @@index([tenantId])
}
```

### 3.3 Execution + Stock

```prisma
model ProductionRun {
  id                String   @id @default(cuid())
  runNumber         String   // PRD-2026-0001
  variantId         String
  variant           ProductVariant @relation(fields:[variantId], references:[id])
  batchNumber       String   // per clarification #5 only batchNumber
  status            String   @default("PLANNED") // PLANNED | IN_PROGRESS | COMPLETED | CANCELLED
  plannedPacks      Int
  actualPacks       Int?
  bomSnapshot       Json     // frozen BOM at start
  notes             String?
  totalMaterialCost Decimal? @db.Decimal(12,2)
  totalPackagingCost Decimal? @db.Decimal(12,2)
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  tenantId          String
  tenant            Tenant @relation(fields:[tenantId], references:[id])
  usages            ProductionRunComponentUsage[]
  @@unique([tenantId, runNumber])
  @@index([tenantId, status])
}

model ProductionRunComponentUsage {
  id         String  @id @default(cuid())
  runId      String
  run        ProductionRun @relation(fields:[runId], references:[id], onDelete:Cascade)
  materialId String
  material   Material @relation(fields:[materialId], references:[id])
  plannedQty Decimal @db.Decimal(12,2)
  actualQty  Decimal @db.Decimal(12,2)
  wasteQty   Decimal @db.Decimal(12,2) @default(0) // per-component waste #6
  tenantId   String
  tenant     Tenant @relation(fields:[tenantId], references:[id])
  @@index([runId])
}

model FinishedGoodStock {
  id          String  @id @default(cuid())
  variantId   String
  variant     ProductVariant @relation(fields:[variantId], references:[id])
  batchNumber String
  location    String  @default("FG_STORE")
  quantity    Int     // packs/bags/jars
  unitCost    Decimal @db.Decimal(12,2)
  tenantId    String
  tenant      Tenant @relation(fields:[tenantId], references:[id])
  createdAt   DateTime @default(now())
  @@index([tenantId, variantId])
  @@index([tenantId, batchNumber])
}

model Sale {
  id         String   @id @default(cuid())
  saleNumber String   // SAL-2026-0001
  customerId String
  customer   Customer @relation(fields:[customerId], references:[id])
  status     SaleStatus @default(DRAFT) // DRAFT|CONFIRMED|DELIVERED|COMPLETED|CANCELLED
  totalAmount Decimal @db.Decimal(12,2)
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  tenantId   String
  tenant     Tenant @relation(fields:[tenantId], references:[id])
  lines      SaleLine[]
  @@unique([tenantId, saleNumber])
  @@index([tenantId, customerId])
}

model SaleLine {
  id        String  @id @default(cuid())
  saleId    String
  sale      Sale @relation(fields:[saleId], references:[id], onDelete:Cascade)
  variantId String
  variant   ProductVariant @relation(fields:[variantId], references:[id])
  qty       Int
  unitPrice Decimal @db.Decimal(12,2) // editable at invoice for discounts #4
  subtotal  Decimal @db.Decimal(12,2)
  vatAmount Decimal @db.Decimal(12,2)
  tenantId  String
  tenant    Tenant @relation(fields:[tenantId], references:[id])
  @@index([saleId])
}

enum SaleStatus { DRAFT CONFIRMED DELIVERED COMPLETED CANCELLED }
```

### 3.4 Procurement Extension

`POLineItem.specJson Json? // { grammage:14.5, vendor:"X", lot:"L-..." }` captures vendor-compromise preform weight. Stock valuation uses average cost; variance report compares `spec` vs policy.

### 3.5 Finance COA Additions (seed + platform DEFAULT_ACCOUNTS)

```
1300 Raw Material Inventory (keep, parent for 1310)
1310 Raw — Preforms (ASSET, child of 1300)
1311 Raw — ShrinkWrap & Packaging (ASSET)
1325 Finished Goods — Bottled (ASSET)
1326 Finished Goods — Sachet (ASSET)
1327 Finished Goods — Jars (ASSET)
1330 WIP (keep if WIP stage wanted; else skip)
1510 Packing Bag Inventory (keep, renamed Packing)
4001 Revenue — Bottled (REVENUE)
4002 Revenue — Sachet (REVENUE)
4003 Revenue — Jars (REVENUE)
2251 Jar Deposit Liability (LIABILITY, optional if returnable jars enabled)
```

Keep `5000 COGS`, `5400 Inventory Adjustment`, `2100 VAT Output`, `1200 AR`.

### 3.6 Deletions vs Archive

New DB `waterpax` is fresh — no migration drop needed for `InkColor/Roll/PrintedRoll`. Do not recreate them. Flexo `SalesOrder` table is not carried; if auditing demands, keep as `LegacySalesOrder` archived but hidden. Prefer clean schema for watERPax.

---

## 4. Permissions (re-seed, water-native)

Keep `auth:read/manage_users`, `inventory:read/create/edit/adjust/dispose`, `procurement:read/create/receive/edit`, `finance:read/write/manage_accounts`, `settings:read/write`, `customer:read/create/edit/payment`, `supplier:read/create/edit`, `report:read`, `audit:read`, `pricing:read/write`.

Replace flexo sales/production perms with:

- `product:read` / `product:write` (catalog + BOM, tenant-flexible variants)
- `production:read` / `production:plan` / `production:complete` / `production:cancel`
- `sales:read` / `sales:create` / `sales:confirm` / `sales:deliver` / `sales:payment` / `sales:discount` (discount gates `unitPrice` edit)
- `fg:read` / `fg:adjust`

Seed: `ADMIN` all 40+, `MANAGER` all minus `auth:manage_users`+`tax:manage`, `OPERATOR` production+sales+inventory limited, `VIEWER` read-only. Follow current `seed.ts:123` pattern (upsert, never delete stale `RolePermission`).

---

## 5. Core Flows (MTS, decoupled)

### 5.1 Bottled Production → Stock → Sale

```
Procurement PO: preforms spec 14.5g ×10k + caps 10k + labels 10k + shrink 40kg (specJson.grammage)
  → Goods Receipt: Stock MAIN + qty, StockMovement IN
ProductionRun PLANNED 800 packs (variant 50cl×12, batch B-002, BOM snapshot)
  → START: status IN_PROGRESS, freeze BOM
  → COMPLETE (/production-runs/:id/complete):
      inside prisma.$transaction:
        claim: updateMany where status=IN_PROGRESS (race guard, same pattern as production/service.ts:339)
        for each BOM: Stock OUT via inventoryService.addStock(...,-actualQty, tx)
        usages[] with wasteQty per component (#6)
        FinishedGoodStock IN +800 (FG_STORE, batch B-002)
        JE: Dr 1325 FG-Bottled / Cr 1300 Raw (1300+1311) — material + packaging
              (WIP intermediate optional: Dr WIP → Dr FG)
Sale CONFIRMED (customer, lines: 30×12×50cl @ unitPrice editable):
  check: SELECT ... FOR UPDATE on FinishedGoodStock (same row-lock as salesOrders/service.ts:333)
  → DELIVER:
        FG OUT -30
        JE revenue VAT-inclusive via decomposeInclusive:
          Dr 1200 AR  (total)
          Cr 4001 Revenue-Bottled (excl VAT)
          Cr 2100 VAT Output
        JE COGS: Dr 5000 / Cr 1325 (unitCost × qty)
        Invoice auto-created (per sale, not per pickup), Receipt 80mm POS thermal
Payment: CASH → Dr 1000/Cr 1200 immediate; CREDIT → AR aging, terms paymentTermsDays (#3)
```

### 5.2 Sachet & Jars: same pattern, different BOM/lines.

- Sachet BOM `per bag`: `printedNylonKgPerBag + 1 packingBag`. Finished unit is `bag (20 sachets)`.
- Jars: if returnable, sale posts `Dr 1200 AR / Cr 4003 (excl) + Cr 2100 + Dr 2251 Jar Deposit` option; return posts `Dr 2251 / Cr Cash`.

### 5.3 Waste & Variance

- Shop-floor may skip waste entry → system still reports variance: `Variance = Σ procurement IN (kg/pcs in period) − Σ FG produced × theoretical BOM − Σ waste recorded (#6)`. Report `GET /reports/variance` aggregates `StockMovement` vs `ProductionRunComponentUsage`.

### 5.4 Pricing & VAT

- `pricePerUnit` stored as **VAT-inclusive** per your #4. At invoice, `decomposeInclusive(amount, vatRate)` splits `exclusive`→Revenue, `vat`→2100. Per-line `unitPrice` editable if caller has `sales:discount`, audit logged.

---

## 6. Phases — Local-First Execution

### Phase 0 — Foundation Fork (1 week) — THIS PLAN

- Copy monorepo skeleton (`package.json` workspaces, `apps/backend`, `apps/frontend`, `packages/types`, `.opencode`, `scripts`, `docs`) to `waterpax`, rename `flexoprint→waterpax`, `phlexerp_at→waterpax_at`, `X-PhlexERP-CSRF→X-WaterPax-CSRF`.
- New `.env.example` (`DATABASE_URL=postgresql://waterpax:..@localhost:5432/waterpax`, `JWT_SECRET`, `CORS_ORIGIN`, `ADMIN_PASSWORD`, `PORT=3001` local).
- New `schema.prisma` (§3) + `seed.ts` (§4 perm + §3.5 COA + default Product/Variant seeds: 33cl×12, 50cl×12, 75cl×12, 150cl×12, Sachet-20, Jar-20L as editable starters).
- Local verify: `npm ci` root → `packages/types build` → `prisma generate/push/seed` → `backend build` → `frontend build` → `npx tsc --noEmit` both → `node scripts/smoke-test.mjs` (adapted to waterpax cookie names, 53 checks baseline) + `period-lock.e2e` green. **No deploy until green.**

### Phase 1 — Generalize Inventory / Guide Angel (1–2 weeks)

- Extend `MaterialCategory`, inventory UI `subCategory` picker water-native, keep `adjustStock` GL.
- Guide Angel 4-step: tenant admin enters opening `FG packs` + raw lots (not OPEN-rolls), one balanced `Dr 1325-1327/1310 / Cr 3000 OBE`.
- Period lock + negative-cash guard kept.

### Phase 2a + 2b Parallel (3–4 weeks, critical path)

- **2a ProductionRun:** `modules/products` (CRUD + BOM), `modules/productionRuns` (`generateRunNumber`, `create`, `start`, `complete` transaction, `cancel`), FG ledger, waste per component.
- **2b Sales MTS + POS:** `modules/sales` (`Sale` lifecycle, `FOR UPDATE` FG allocation, `deliver` revenue/COGS, `applyDiscount`, `PaymentTransaction` cash/credit), 80mm thermal receipt (reuse `Settings.receipt*`), invoice PDF `pdf-service.ts` lineage.

### Phase 3 — Reports/Dashboard/Procurement Wiring (1–2 weeks)

- Wire PO receipts to `Stock` (not Rolls), preform `specJson` display.
- Reports: `FG Valuation`, `Production Output by Line/Variant`, `Waste by Component`, `Variance Procured vs Realised`, `Sales by SKU`, `Low Raw` — same `reports/service.ts` aggregation style + CSV.
- Dashboard: `FG Available (packs)`, `Today Production (packs)`, `Today Sales (packs/value)`, `Low Raw`, `Recent Batches`.

### Phase 4 — Hardening & Second Vhost (when local working)

- Hetzner second Nginx `server { server_name <new-domain>; }` → `127.0.0.1:3001`, second PM2 `waterpax-backend`, separate R2 prefix `waterpax/`, WAL `waterpax/wal/`, Healthchecks second check, UFW already shared, Cloudflare second zone orange-cloud + origin lockdown, Let’s Encrypt cert for new domain. Follow `docs/DEPLOYMENT.md` Phase 4–8 pattern but targeting `waterpax`. Plan mode HSTS/TLS same.

---

## 7. Non-Goals / Constraints

- Do not port or reuse any `Roll/PrintedRoll/InkColor` code or data.
- Do not modify `FlexoPrint ERP` repo/DB/domain/deploy.
- No expiry/NAFDAC, batchNumber only. No per-tenant timezone (all Africa/Lagos).
- Sachet roll length/width irrelevant — nylon tracked as kg lot only.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `tenantId` leak in raw SQL | Every `$queryRaw` adds `AND "tenantId"=${getCurrentTenantId()}` (migrated bug in `salesOrders/service.ts:296`) |
| PackSize per variant drift breaks BOM | `bomSnapshot` frozen at run start; historical runs immutable |
| Preform grammage fragmentation | Family material + per-lot `specJson`; variance report reconciles by weight |
| FG valuation drift | `adjustStock` posts GL; periodic `InventoryGLRecon` (like `reports/inventory/gl-reconciliation`) for FG |
| Copy skeleton drifts from flexo hardening | Re-apply `helmet` CSP, honeypot, rate limiters verbatim; smoke suite requires cookie+CSRF |

---

## 9. Acceptance Criteria

- Local `smoke-test.mjs` + `period-lock.e2e.mjs` adapted to `waterpax` cookies pass on localhost Postgres.
- E2E water flow green: `PO (preform spec 14.5g) → Run PLANNED→COMPLETED (FG IN) → variance correct → Sale confirm (FG check FOR UPDATE) → deliver (AR+Revenue+VAT+COGS) → Receipt POS print`.
- `ProductVariant` created freely by tenant (`25cl`, any packSize) works end-to-end (PO→BOM→Run→Sale) without code change.
- Finance: TB balanced after each flow; `GET /finance/trial-balance` Dr=Cr; `reports/variance` shows material balance.

---

## 10. Next Step

Draft `AGENTS.md` + `ARCHITECTURE.md` for `waterpax` reflecting this plan, then scaffold the monorepo skeleton (§6 P0). See `docs/ARCHITECTURE.md` and `AGENTS.md` created alongside this plan.
