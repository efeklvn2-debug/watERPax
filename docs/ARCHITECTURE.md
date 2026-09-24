# watERPax — System Architecture (MTS)

## 1. Overview

watERPax is a multi-tenant Make-to-Stock ERP for Nigerian water-packaging SMEs (Bottled / Sachet / Refill Jars). Flux from FlexoPrint but MTS-decoupled: production creates `FinishedGoodStock` batches independent of any customer order; sales allocates from that FG store and invoices immediately. All money is double-entry; all stock is lot-tracked by `variantId+batchNumber`.

**Status:** 2026-08-29 — new repo `C:/Users/USER/Desktop/watERPax`, separate DB `waterpax`, separate domain/PM2. FlexoPrint `phlexerp.com.ng` untouched.

## 2. Deployment Stack

```
Internet
  → Cloudflare (orange cloud, strict TLS)
    → Nginx ( :443 → :80 http→https, HSTS preload, CSP report-uri)
      → /api/* proxy_pass 127.0.0.1:3001 (Express, PM2 waterpax-backend)
      → /     → /var/www/waterpax (React Vite PWA static)
        PostgreSQL 16-18 (local on Hetzner CPX12), WAL → R2 waterpax/wal/
```

Local dev: `3001` backend `tsx watch`, `5173` Vite, PG `waterpax` on `localhost:5432`, `Africa/Lagos` timezone.

## 3. Components

### 3.1 Backend `apps/backend` — Express + Prisma + TS strict

- **Entry:** `src/index.ts` → `src/app.ts:createApp()` (helmet CSP, HSTS, CORS `CORS_ORIGIN`, `trust proxy 1`, json parsers, `honeypotMiddleware`, limiter, `idempotencyMiddleware`, `csrfProtection`, routes, `errorHandler`).
- **Database:** `src/database/index.ts` — single `PrismaClient` + `$extends` that auto-injects `tenantId` from `src/context.ts` `AsyncLocalStorage`. Return `as unknown as PrismaClient` to satisfy TS. Raw SQL must add `AND "tenantId"=${getCurrentTenantId()}`.
- **Auth:** `src/auth.ts` `generateAccessToken(15m)/generateRefreshToken(7d)/verifyToken` (HS256, `JWT_SECRET` fails boot if missing), `src/cookies.ts` `waterpax_at/rt/csrf` httpOnly+Secure+SameSite, `middleware/auth.ts:authenticate/loadUser`, `middleware/csrf.ts` double-submit `X-WaterPax-CSRF`.
- **Tenant:** `middleware/tenant.ts:tenantMiddleware` after `loadUser` — resolves `tenantId` from JWT into `AsyncLocalStorage`.
- **Modules:** `auth` (login/lockout/TOTP), `platform` (`SUPER_ADMIN` tenant CRUD, seeds), `inventory`+`procurement`+`suppliers`, `products` (catalog+BOM), `productionRuns` (MTS), `sales` (MTS + POS), `finance`, `reports`, `settings`, `guideAngel` (water), `audit`, `tax`.

### 3.2 Frontend `apps/frontend` — React 18 + Vite + Tailwind + PWA

- `src/api/client.ts` axios with cookie+CSRF interceptor (reads `waterpax_csrf` cookie → `X-WaterPax-CSRF` header), `stores/authStore.ts` zustand, `hooks/useCachedFetch.ts` (StrictMode `mountedRef` fix).
- Pages: `Dashboard` (FG KPIs), `Products` (catalog/BOM), `ProductionRuns`, `SalesMTS` (POS 80mm), `InventoryFG`, `Procurement`, `Finance`, `Reports`, `Customers`, `Suppliers`, `Settings`, `GuideAngel`, `Admin`, `Platform`.

### 3.3 Shared `packages/types` — TypeScript union types (Permission names, SaleStatus etc). `dist` not committed, must `npm run build` first.

## 4. Multi-Tenancy

- Shared DB, shared schema, `tenantId String` on every domain table (33+), `Tenant` master, `SUPER_ADMIN` no tenant.
- `AsyncLocalStorage` `getCurrentTenantId()/runWithTenant()`; `$extends` injects on `create/upsert`. Nullable `RefreshToken.tenantId`, `IdempotencyKey.tenantId` (pre-tenant). `User.username` globally `@unique` (no tenant selector on login). `@@unique([tenantId, field])` everywhere.
- Tenant isolation audit: API spot-check `GET /api/platform/tenants` → 403 for tenant admin.

## 5. Data Model (waterpax)

### 5.1 Kept (Flexo lineage)

`Tenant`, `User`, `RefreshToken`, `Permission`/`RolePermission`/`UserPermission`, `IdempotencyKey`, `BlockedIp`, `AuditLog`, `Tenant` relations, `Supplier`, `PurchaseOrder`/`POLineItem` (add `specJson Json? {grammage,vendor}`), `Material`/`Stock`/`StockMovement`, `Settings`, `Account`/`JournalEntry`/`JournalLine`, `Customer`, `SupplierInvoice`/`PaymentMade`, `GuideAngelSession`/`GuideAngelOpeningBalance`, `TaxProvision`/`PayeEntry`.

`MaterialCategory` generalized to `RAW_MATERIAL|PACKAGING|FINISHED_GOOD|CONSUMABLE` (vs flexo `PLAIN_ROLLS/INK_SOLVENTS/PACKAGING`). No `InkColor/Roll/PrintedRoll/MaterialIssue/OverheadRateHistory`.

### 5.2 New Masters

- `Product` (`category BOTTLED|SACHET|JAR`, `code`), `ProductVariant` (`label` free-form "33cl", `packSize` per-tenant flex, `pricePerUnit` VAT-inclusive), `BOM` (`variantId, componentMaterialId, qtyPerPack, grammage, wastagePct`, snapshot to run).
- `ProductionRun` (`runNumber PRD-YYYY-NNNN`, `variantId, batchNumber` only, `status PLANNED|IN_PROGRESS|COMPLETED|CANCELLED`, `plannedPacks/actualPacks, bomSnapshot Json, total*Cost`), `ProductionRunComponentUsage` (per-component `plannedQty/actualQty/wasteQty` — covers §6 waste), `FinishedGoodStock` (`variantId, batchNumber, location FG_STORE, quantity Int packs, unitCost`), `Sale` (`saleNumber SAL-YYYY-NNNN, customerId, status DRAFT|CONFIRMED|DELIVERED|COMPLETED|CANCELLED, totalAmount`) + `SaleLine` (`variantId, qty, unitPrice editable, subtotal, vatAmount`).

### 5.3 Archived

Flexo `SalesOrder` MTO 8-state (`PENDING→COMPLETED`) + `Invoice/PaymentTransaction/Receipt` skeletons are repointed to `Sale` (not deleted in old DB). Fresh `waterpax` DB has clean `Sale` set.

### 5.4 Finance COA (seed + platform DEFAULT_ACCOUNTS)

Add to flexo base: `1310 Raw-Preforms`, `1311 Raw-WrapPackaging`, `1325 FG-Bottled`, `1326 FG-Sachet`, `1327 FG-Jars`, `4001 Revenue-Bottled`, `4002 Revenue-Sachet`, `4003 Revenue-Jars`, optional `2251 Jar Deposit`. Keep `1300,1200,1000/1100,2100 VAT Output, 5000 COGS, 5400 Adjustment, 3000 OBE`.

## 6. Flows

### 6.1 Procurement (same for all lines + preform grammage)

`POST /procurement/pos` → `POLineItem {materialId: Preform-50cl-family, quantity, unitPrice, specJson:{grammage:14.5, vendor:"X"}}` → `POST /procurement/:id/receive` → `Stock MAIN +qty`, `StockMovement IN`, no `Roll` creation.

### 6.2 Production MTS (decoupled)

```
createRun {variantId, plannedPacks, batchNumber, line?} → PLANNED + bomSnapshot
startRun  → IN_PROGRESS, freeze
completeRun → inside prisma.$transaction:
  claim updateMany where status=IN_PROGRESS
  for each BOM: Stock OUT via inventoryService.addStock(-actualQty, tx)
  usages[] {plannedQty, actualQty, wasteQty}
  FinishedGoodStock IN (variantId+batchNumber, +actualPacks)
  JE: Dr 1325/1326/1327 FG / Cr 1300/1311 Raw ( + WIP optional )
  snapshot costs: totalMaterialCost/totalPackagingCost
```

Consumes raw/preform family stock, not rolls. No `customerName` gate.

### 6.3 Sales MTS (from FG)

```
create Sale DRAFT {customerId, lines:[{variantId, qty, unitPrice?}]}
  unitPrice defaults to ProductVariant.pricePerUnit, editable if sales:discount
  exclusive/vat = decomposeInclusive(line.qty*unitPrice, vatRate)
confirmSale → check FinishedGoodStock qty ≥ sale qty under SELECT ... FOR UPDATE (row-lock, same pattern as flexo recordPickup)
deliverSale → inside tx:
  FG stock OUT (FG_STORE)
  JE revenue: Dr 1200 AR / Cr 4001-4003 (excl) + Cr 2100 VAT
  JE COGS:   Dr 5000 / Cr 1325-1327 (unitCost × qty)
  Invoice auto (one per sale) + Sale status DELIVERED|COMPLETED
  Receipt 80mm POS (window.print thermal template, uses Settings.receipt* fields)
Payment: CASH → Dr 1000/Cr 1200 immediate, CREDIT → AR aging, paymentTermsDays, overpayment → 2250 Advance
```

Discount at delivery time is an audit-logged `unitPrice` override; finance still posts at that price. Period lock blocks backdated JEs.

### 6.4 Guide Angel (water)

4-step tenant admin only (`requireTenantAdmin`): 1) Money/Assets→ 2) Customers→ 3) Suppliers→ 4) Stock (FG packs + raw lots). On `complete()`: one balanced `OPENING` JE `Dr 1325-1327/1310/1311 / Cr 3000 OBE` + `GuideAngelOpeningBalance` receivables + `GuideAngelSession` completed. Stock not hidden as `OPEN-` rolls.

### 6.5 Supplier Credit Notes (vendor returns)

When defective or damaged goods are returned to a supplier, the supplier issues a credit note reducing the amount owed.

#### GL Posting

```
Dr 2000  Accounts Payable          — you owe the supplier LESS
Cr 1300  Raw Material Inventory    — value of returned goods leaves inventory
  or 1311 (if packaging material)
```

This is a single journal entry posted inside the same transaction as the credit note record.

#### Stock Impact

When `materialId` and `quantity` are provided, `inventoryService.addStock(materialId, -quantity)` decrements physical stock. This is a `OUT` StockMovement — no additional JE is posted (the financial impact is already captured above). When omitted, only the GL entry is posted (financial-only credit note).

#### PO Link

The credit note can optionally be linked to the original Purchase Order via `poId` for traceability. This does not change the PO status or amounts.

#### Form Fields

| Field | Required | Description |
|---|---|---|
| Supplier | Yes | The supplier who issued the credit |
| Amount | Yes | Credit amount in ₦ (must be positive) |
| Date | Yes | Transaction date (respects period lock) |
| Reason | Yes | Why the return happened (e.g., "Defective preforms") |
| PO Link | No | Link to the original Purchase Order |
| Material | No | Which material was returned (triggers stock decrement when quantity provided) |
| Quantity | No | How many units were returned (only shown when material selected) |
| Notes | No | Additional notes |

#### Credit Note Number

Auto-generated as `CN-YYYY-NNN` (e.g., `CN-2026-001`). Sequential per tenant per year.

#### API

- `POST /api/procurement/supplier-credit-notes` — create (requires `procurement:return` permission)
- `GET /api/procurement/supplier-credit-notes` — list all (requires `procurement:read`)

### 6.6 Customer Returns (inward defective) — Sales Credit Notes

When a customer returns defective / bad finished goods after delivery, the system records a customer credit note. Operator picks **disposition** per return and **refund method**.

#### GL Postings (two JEs per return)

**Revenue reversal — always:**
```
Dr 4001/4002/4003  Revenue (ex-VAT, by product category BOTTLED/SACHET/JAR)
Dr 2100           VAT Output
  Cr 2250  Advance Customer Payments  (if CREDIT — default, held for next order)
  or Cr 1000 Cash / Cr 1100 Bank (if CASH/BANK refund)
  — amount is qty × SaleLine.unitPrice (inclusive, decomposed via decomposeInclusive)
```

**COGS / stock reversal — depends on disposition:**
```
RESTOCK (sellable, e.g., wrong size, packs fine):
  Dr 1325/1326/1327 FG (FG_STORE)  qty × SaleLine.unitCost
    Cr 5000 COGS

SCRAP (defective, not sellable):
  Dr 1325/1326/1327 FG (FG_DEFECTIVE)  qty × SaleLine.unitCost
    Cr 5000 COGS
  — FG_DEFECTIVE is visible in Inventory → FG Store (red badge, location column) but excluded from POS availability (availableFgQty counts FG_STORE only).
```

Both JEs are `sourceModule: SALES_RETURN`, posted inside the same `prisma.$transaction` as the `CustomerCreditNote` row. Period lock (`booksLockedUntil`) validated via `financeService`.

#### Model

```
CustomerCreditNote {
  creditNoteNumber CR-YYYY-NNN (unique per tenant)
  customerId, saleId, variantId, quantity Int, unitPrice, amount (incl), vatAmount, exVatAmount
  reason, disposition RESTOCK|SCRAP, refundMethod CREDIT|CASH|BANK
  date, batchNumber (from SaleLine.allocation), notes, tenantId
}
```

`Sale` must be `DELIVERED` or `COMPLETED`; `quantity` is per-variant and checked against `saleLine.qty − Σ prior returns for same sale+variant`. `unitPrice`/`unitCost` are taken from `SaleLine` (captured at confirm/deliver), not current variant price. `batchNumber` from first `allocation` leg; FG stock increment uses `upsert` on `tenantId_variantId_batchNumber_location` (weighted-average not recalculated, qty increment only — mirrors `sales/cancel` restore).

**⚠️ Existing Tenant Limitation** (FIXED 2026-09-24):
- `SaleLine.allocation` is optional (written at CONFIRM for cancel-restore / returns)
- Historically delivered sales may have `null`/empty allocation
- **Runtime** (`createCustomerCreditNote`): if `allocation[0].batchNumber` missing, reconstruct FIFO from `FinishedGoodStock` (oldest `FG_STORE` ≤ sale date → oldest `FG_STORE` → newest any location) and backfill that line; else `RET-` bucket. Does **not** write `CustomerReturnsAllocationPatch`.
- **One-time migration**: `scripts/migrate-customer-returns-allocation.mjs` (dry-run default; `DRY_RUN=false` to apply) backfills lines + marks sales in `CustomerReturnsAllocationPatch`. Tracking table via `prisma db push` (no `_prisma_migrations`). Optional SQL: `apps/backend/prisma/migrations/20260920000000_patch_customer_returns_allocation/migration.sql` (FinishedGoodStock function + `v_customer_returns_allocation_status` view; **no trigger**, no `COMMIT`).
- No FG movement ledger — `StockMovement` is raw-materials only; reconstruction cannot replay OUT movements.
- Details: `docs/CUSTOMER_RETURNS_FIX.md`

#### Form

Sales → Orders → select delivered sale → **Record Return** (gated `sales:return`) or Sales → Returns tab → **+ Record Return**:
* Sale (DELIVERED/COMPLETED) → Variant (filtered to sale lines, shows original qty & price) → Quantity (with returnable max hint) → Date (period-lock) → Refund method pills `CREDIT`/`CASH`/`BANK` (BANK shows bank-account selector) → Disposition pills `RESTOCK → FG_STORE` / `SCRAP → FG_DEFECTIVE` → Reason → Notes.

#### API

- `POST /api/sales/credit-notes` — create (requires `sales:return`)
- `GET /api/sales/credit-notes` — list (requires `sales:read`, filter `customerId/saleId/dateFrom/dateTo`)

Journal filter `sourceModule=SALES_RETURN`.

## 7. Security

- JWT httpOnly Secure, CSRF double-submit `waterpax_csrf`, honeypot 27 scanner paths, 8 limiters including `loginLimiter 20/15m` + 5-attempt lockout, `api/csp/report` 64kb+`cspLimiter`, Helmet CSP `script-src 'self'`+`report-uri`, HSTS `63072000 preload`, CORS env-bound, `trust proxy 1` real IP, UFW 22/80/443 + Cloudflare-IPs-only on origin when proxied, `fail2ban` `sshd`+`phlexerp-auth`-style jail renamed.
- Secrets: `JWT_SECRET` env-only, `DATABASE_URL` for `waterpax` user, `ADMIN_PASSWORD` env, R2 key `/root/.waterpax_backup_key` 600, DB pw `/root/.waterpax_db_password` 600, Healthchecks URLs in `/etc/waterpax-monitor.env` 600.

## 8. Timezone

`Africa/Lagos`. `utils/dates.ts:todayLocal/dateFromInput/dateStartOfDay` day-level compare already in `validateJournalDate`. Buckets `booksLockedUntil` day-level.

## 9. Performance

- Code-split 14 routes lazy, `React Query` cached fetch, 11 indexes (`Material[isActive,category,subCategory]`, `Sale[tenantId,createdAt]`, `FinishedGoodStock[variantId,batchNumber]`, `ProductionRun[startDate]`), parent `Account` aggregation only via root filter (no double-count).
- Variance report leverages `StockMovement` + `ProductionRunComponentUsage` aggregation, not per-row.

## 10. Monitoring, Backup, Logs

- Logs `pm2 waterpax-backend` → `/var/log/waterpax/backend-{out,error}.log` (logrotate `copytrunc`, Nginx real-ip cf).
- Daily `rclone copy` `pg_dump | gzip | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -pass file:/root/.waterpax_backup_key` → `r2:waterpax/phlexerp_*.sql.gz.enc` (separate prefix `waterpax/`), retention 30d, local keep 3, cron 02:00, WAL to `r2:waterpax/wal` with `archive_command` per `postgresql.conf`. Healthchecks second check `waterpax` + cert-expiry + disk 90% alert, incident runbook mirrors `INCIDENT-RESPONSE.md`.

## 11. Product Variant Best Practice (free-form, tenant-configurable)

Tenant creates any variant label ("25cl", "60cl", "10L") + `packSize` + `pricePerUnit` + `BOM` without code change. Seed `33/50/75/150×12 + Sachet-20 + Jar-20L` as editable starters. Preform family grammage is per-lot not per-variant; BOM policy vs lot actual reconciled via variance.
