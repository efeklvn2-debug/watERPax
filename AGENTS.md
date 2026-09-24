# watERPax — Agent Instructions

> Water-packaging MTS ERP. Forked lineage from FlexoPrint ERP, **independent repo/DB/domain/deploy**. Local-first, same hardening lineage.

## CURRENT SESSION POINTER — WatERPax foundation (29 Aug 2026)

- **Source:** `C:/Users/USER/Desktop/rebuilding/To WebApp Project/FlexoPrint ERP` (live at `phlexerp.com.ng`, Hetzner `46.224.0.165`, PM2 `phlexerp-backend:3000`, DB `flexoprint`). **Do NOT edit that repo, DB, or deploy.**
- **Target:** `C:/Users/USER/Desktop/watERPax` — new monorepo `waterpax` (this file). **No legacy data**; fresh DB `waterpax` on same PG server locally / same VPS remotely.
- **Model:** Make-to-Stock. Sales decoupled from Production. `Roll` + `PrintedRoll` + `InkColor` + ink rates are **deleted** (not adapted). Pack sizes per `ProductVariant.packSize` tenant-configurable; variants are free-form labels (33cl seed is default, not enum — tenant can create any size). Jar products support OUTRIGHT/REFILL sales with per-variant jar material linkage.
- **Plan:** `docs/PLAN.md` — LOCKED 2026-08-29. Phases: P0 foundation fork (this session), P1 inventory/Guide Angel, P2a ProductionRun + P2b Sales MTS/POS parallel, P3 reports/variance, P4 second vhost on Hetzner.
- **Next action:** P0 scaffold validation: `npm ci` root → `packages/types build` → `prisma generate/push/seed` → `backend+frontend build` → `tsc --noEmit` → `smoke-test.mjs` green on local Postgres before any VPS work.

## DEPLOY WORKFLOW — single source of truth (watERPax, mirrors FlexoPrint law)

**Rule 1 — GitHub `master` is the only place code is born.** `local feature branch → push → PR → squash-merge when CI green`. Never commit on server.
**Rule 2 — Never commit on the server.** Server mutations (npm install dirt) are discarded; changes come via PR from local.
**Rule 3 — Deploy = one-way replication to second vhost.** On VPS (`/home/deploy/app-waterpax`) — **separate path from `/home/deploy/app` (FlexoPrint)** — in order:

1. `git fetch origin` (deploy key on `waterpax` repo).
2. `git reset --hard origin/master` (no diverging merges).
3. `export PATH=/home/deploy/.nvm/versions/node/v20.20.2/bin:$PATH` (node not on non-interactive PATH).
4. `npm ci --no-audit --no-fund` **from repo ROOT** (`app-waterpax`) — workspaces hoist `@waterpax/types`.
5. `cd apps/backend && npx prisma generate && npx prisma db push --skip-generate && npx prisma db seed` (seed upserts perms/roles/COA/products — required).
6. `npm run build` in `packages/types` **FIRST** (dist not committed), then `npm run build` in `apps/backend`. Verify marker `grep -c waterpax dist/index.js`.
   Frontend: build locally → `scp` tarball → as deploy user extract into `/var/www/waterpax` (`--strip-components=1`, `chown -R www-data:www-data` — deploy has no sudo on www, use `root@` for extract if needed).
7. `pm2 restart waterpax-backend` (ecosystem `waterpax-backend`, port 3001) — verify `export PATH=...` first.
8. **VERIFY in order:** `curl -sL -o /dev/null -w "%{http_code}" http://localhost:3001/api/health` = 200; `pm2 status` (`waterpax-backend` online, uptime advancing); `tail /var/log/waterpax/backend-error.log` 0 bytes; grep new marker in `dist/`; `curl -Ik https://<new-domain>/api/health` via Cloudflare.

**Server facts (when P4 deployed):** backend logs `/var/log/waterpax/backend-{out,error}.log` (logrotate `copytrunc`), PM2 name `waterpax-backend` (NOT `phlexerp-backend`), `CORS_ORIGIN=https://<new-domain>`, DB `waterpax` (user `waterpax`, pw at `/root/.waterpax_db_password` 600), R2 bucket prefix `waterpax/` + `waterpax/wal/`, backup key `/root/.waterpax_backup_key` 600, Healthchecks second check `waterpax`, cron `backup-waterpax.sh` 02:00. **FlexoPrint facts stay:** `phlexerp-backend:3000`, `/var/log/phlexerp/`, DB `flexoprint`, `phlexerp.com.ng` — untouched.

**PowerShell/SSH gotchas (copied from FlexoPrint, still apply):** pipe `ssh "cmd | head"` breaks; scp a `.sh` script + `ssh 'bash /tmp/x.sh'`. `Out-File` produces `\r\n` → use `[System.IO.File]::WriteAllLines(..., UTF8)` or `sed -i 's/\r$//'`. `USERNAME` env shadows `SMOKE_USER`. `git fetch origin master` writes only `FETCH_HEAD` — use plain `git fetch origin`.

## CI — target state

- Workflow `.github/workflows/ci.yml` — triggers `push/PR to master` + `workflow_dispatch`.
- Jobs: `typecheck-build` (`packages/types build` first — workspaces discovery order, not topological → must build types before `tsc`) + `smoke` (postgres service `postgres:16`, `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD` from job env, `BASE_URL=http://127.0.0.1:3001/api SMOKE_USER=superadmin node scripts/smoke-test.mjs`).
- Smoke suite must include cookie jar `waterpax_at/waterpax_rt` + `X-WaterPax-CSRF` derivation (FlexoPrint `53/53` adapted, not Bearer). `e2e` (Playwright) staged later with tax reports variant if needed.

## Project Structure

```
waterpax/
├── apps/
│   ├── backend/           Express + Prisma + TS (tsx watch, ports 3001 local / 3001 VPS)
│   │   ├── src/
│   │   │   ├── modules/   auth, platform, finance, procurement, suppliers, inventory,
│   │   │   │              products, productionRuns, sales, reports, settings, guideAngel, audit, tax
│   │   │   ├── middleware/ auth, tenant, csrf, honeypot, rateLimiters, idempotency, validation
│   │   │   ├── database/  Prisma client + $extends tenant inject
│   │   │   ├── auth.ts    JWT (waterpax_* cookies)
│   │   │   ├── cookies.ts waterpax_at / waterpax_rt / waterpax_csrf
│   │   │   └── app.ts     Helmet CSP, CORS <new-domain>, trust proxy 1
│   │   ├── prisma/        schema.prisma (watERPax, no Roll/InkColor), seed.ts
│   │   └── package.json   @waterpax/backend
│   └── frontend/          React 18 + Vite + Tailwind + PWA
│       ├── src/pages/     Dashboard, Products, ProductionRuns, SalesMTS (POS), InventoryFG, Procurement, Finance, Reports, Settings, GuideAngel, Admin, Platform, Login, Customers, CustomerDetail, Suppliers, SalesInvoices, SalesPayments
│       ├── src/api/       client (waterpax_csrf), auth, product, productionRuns, sales, inventory, procurement, finance, reports, settings, guideAngel
│       └── package.json   @waterpax/frontend
├── packages/types/        Shared TS types
├── docs/                  PLAN.md, ARCHITECTURE.md, DEPLOYMENT.md
├── scripts/               smoke-test.mjs, period-lock.e2e.mjs, _audit_*.mjs
├── CONTEXT.md             Session pointer
├── AGENTS.md              This file
├── opencode.json
└── package.json           Workspaces: apps/*, packages/*
```

## Multi-Tenancy (kept)

- Shared-DB shared-schema `tenantId` column, `AsyncLocalStorage` (`context.ts: getCurrentTenantId / runWithTenant`), Prisma `$extends` injects `tenantId` on create/upsert. Cast `as unknown as PrismaClient`.
- 12+ `@@unique([tenantId, code/slug])` per model, `RefreshToken.tenantId` nullable (pre-tenant middleware), `ProductionRun` etc scoped.
- Every raw SQL adds `AND "tenantId" = ${getCurrentTenantId()}` — prior bug in FlexoPrint `salesOrders/service.ts:296` was fixed this way.
- `SUPER_ADMIN` no tenant, manages tenants via `modules/platform`. Frontend `PlatformPage` gated `role==='SUPER_ADMIN'`. `User.username` globally `@unique` (no tenant selector on login).

## Key Deletions (vs FlexoPrint)

- Models: `InkColor`, `Roll`, `PrintedRoll`, `MaterialIssue`, `OverheadRateHistory`.
- Settings fields: `coreWeight`, `inkConsumptionRate`, `ipa/butanol/tolueneConsumptionRate`, `inkCostPerKg`, `coreDepositValue`.
- Flows: `MTOOrderStatus` 8-state, `salesOrderService.startProduction`, `recordPickup` roll coupling, `parentRollIds/printedRollMapping` FIFO.

## Finance Invariants (keep)

- Every money movement is `postJournalEntry` with `sourceModule` {SALES,PROCUREMENT,PRODUCTION,ADJUSTMENT,OPENING,TAX}. No revenue without AR, no COGS without FG relief. `Deferred COGS 1330` optional if WIP kept; primary is `Dr 1325-1327 FG / Cr 1300/1311`.
- VAT via `decomposeInclusive(amount, vatRate)` — all water prices VAT-inclusive, `unitPrice` editable per `sales:discount` with audit.
- Period lock: `Settings.booksLockedUntil` checked in `finance/service.ts:validateJournalDate` (day-level, Africa/Lagos). Negative-cash guard on `1000/1100` hierarchy (see `ARCHITECTURE.md`).

## Customer Discount System

- **Schema:** `Customer.discountPercent Decimal(5,2) @default(0)` — 0–100%, auto-applied on sale creation. No discount = 0% (list price used).
- **Pricing flow (`sales/service.ts:priceLines()`):** `effectivePrice = listPrice × (1 − customerDiscountPercent / 100)`. If `unitPrice` override is provided, it's compared against `effectivePrice` (not `listPrice`) for the permission check.
- **Permission:** `sales:discount` (module: `sales`) — gates ANY manual price deviation from `effectivePrice`, up or down. Customer's configured discount auto-applies without permission.
- **Default grants:** ADMIN, MANAGER, OPERATOR all get `sales:discount` by default. VIEWER does not. Admin can revoke via `PUT /roles/:role/permissions` or override per-user via `PUT /users/:id/permissions` (`{ granted: false }`).
- **Permission resolution (`auth.ts:checkUserPermission`):** `UserPermission` overrides `RolePermission`. If a `UserPermission` record exists for the user+permission, its `granted` boolean is the final answer.
- **Error messages:** Contextual — mentions "customer's X% discounted price" when discount > 0, "list price" when discount = 0.
- **Frontend (`SalesPage.tsx`):** New sale form shows `unitPrice` input per line, auto-filled with discounted price. `!` badge warns when price differs from expected. DRAFT detail panel: price column is click-to-edit (dotted underline, requires `sales:discount`).
- **Audit:** `sale.discount` action logged on `updateLinePrice` with user, line ID, and new price.

## Guide Angel — Water Variant

- Tenant ADMIN (`auth:manage_users`) wizard 4-step: Money→Customers→Suppliers→Stock (FG packs + raw lots, not rolls). Posts one balanced opening JE `Dr 1325-1327/1310 / Cr 3000 OBE` + `GuideAngelOpeningBalance` receivables. Idempotent, postal once. Printed FG on ground excluded pattern retained if tenant has residual stock to sell as `4200 Other Income` (optional).

## Commands

```bash
# Backend
cd apps/backend
npm install
npm run dev              # tsx watch :3001
npm run build            # tsc
npx prisma generate; npx prisma db push; npx prisma db seed
npx tsc --noEmit

# Frontend
cd apps/frontend
npm install
npm run dev              # vite :5173
npm run build
npx tsc --noEmit

# Smoke (after both builds, backend running)
BASE_URL=http://127.0.0.1:3001/api SMOKE_USER=superadmin node scripts/smoke-test.mjs
node scripts/period-lock.e2e.mjs
```

## Gotchas Retained

- `packages/types/dist` not committed → build it first before any `tsc`/`build`.
- Global `express.json` skip for `application/csp-report` → `POST /api/csp/report` needs its own 64kb parser + `cspLimiter`, CSRF-exempt.
- Login lockout 5 attempts / 10 min, `loginLimiter` 20/15min for smoke room, atomic `recordFailedAttempt` in `$transaction`.
- `UserPermission.granted=false` = deny, overrides `RolePermission`; `Prisma upsert` never deletes stale `RolePermission` — `PUT /roles/:role/permissions` does `deleteMany+create`.

## Tenant Config — Best Practice (free-form, not enum)

- **Product variants are tenant-configurable:** `Products → Add Product (BOTTLED/SACHET/JAR) → + Variant` with any `label` ("25cl", "60cl", "10L", ...) + `packSize` + `pricePerUnit`. Seed starters (`33/50/75/150cl x 12`, `Sachet-20`, `Jar-20L`) are editable/deletable. BOM per variant. No code change for new size.

## Production — Discrete Item Rounding

- **Problem:** BOM wastage percentage (e.g., 2%) applied to discrete items (preforms, caps, labels) produces fractional quantities (407.88 preforms). Cannot consume 0.88 of a preform.
- **Solution:** `roundQty()` in `productionRuns/service.ts:27` — rounds UP (`Math.ceil`) for discrete units, rounds to 2dp for continuous units (kg).
- **Discrete unit list:** `pcs, piece, pieces, unit, units, pack, packs, bag, bags, jar, jars, cap, caps, label, labels, bottle, bottles, preform, preforms, roll, rolls, sheet, sheets, box, boxes, can, cans, drum, drums`.
- **Applied at 3 points:** `startRun` (stock check + plannedQty), `completeRun` (actualQty pro-rata).
- **Formula:** `Math.ceil(qtyPerPack x (1 + wastagePct/100)) x plannedPacks` — per-unit rounding before multiplying by packs.

## Products Page — UI Pattern

- **Layout:** 2-panel — left (col-span-3) product list, right (col-span-2) BOM editor.
- **Product creation:** Inline form (Name + Category only). Code auto-generated from name.
- **Variant creation:** "+ Variant" button on each product card opens inline form (Label, Pack size, price/pack) within that card — no Product dropdown needed.
- **BOM column headers:** Row of `Material | Qty/pack | Waste %` labels above BOM lines, shown only when `bomDraft.length > 0`.
- **BOM dismiss:** Save BOM → `setSelectedVariant(null)` → box hides. Click empty white space → `e.target === e.currentTarget` → `setSelectedVariant(null)`.
- **Variant row:** Compact — `{label}` + `x{packSize}` + `{price}` badges, `{n} BOM` right-aligned.
- **BOM panel header:** Variant label as main heading, product name as subtitle.
- **Category badge:** Colored pill — `BOTTLED` (blue), `SACHET` (emerald), `JAR` (amber).

## Sales Page — UI Pattern

- **Layout:** 2-panel — left (col-span-3) sale list, right (col-span-2) selected sale detail.
- **New sale form:** Customer dropdown → line items (variant + qty + price/pack). Price auto-fills from customer discount. `!` badge warns when price differs from expected (requires `sales:discount` permission).
- **DRAFT detail panel:** Price column is click-to-edit (dotted underline) when user has `sales:discount` and sale is DRAFT. Saves via `PATCH /sales/:id/lines/:lineId/price`.
- **DELIVERED detail panel:** Shows invoice info (with Print/Download buttons), payment history (with receipt Print/Download), and "Record payment" button (with inline form) when `openBalance > 0 && canPay`. All in the right panel — no modal.
- **Status flow:** DRAFT → CONFIRMED (FG allocation) → DELIVERED (revenue+COGS JE) → COMPLETED (invoice paid). CANCELLED from DRAFT/CONFIRMED only.

## Sales Invoices & Payments Tabs

- **Location:** `SalesPage` has tabs: Orders | Invoices | Payments. Matches ProcurementPage pattern.
- **Invoices tab:** Table of all MTS invoices (saleId != null) with customer, sale number, amounts, status, issued date. Includes Print/Download buttons.
- **Payments tab:** Table of all payment transactions — both `PAYMENT` and `DEPOSIT` types — with customer, sale link, method, amount. Includes receipt Print/Download dropdown.
- **"+ Deposit" button:** Gated by `sales:payment` (same default holders as Record payment). Opens modal with customer selector, amount, method, date (with period lock), reference.
- **Deposit auto-apply on deliver:** When delivering a sale, the system checks available advance deposits (standalone DEPOSIT txns + GuideAngel opening CUSTOMER_DEPOSIT balances minus applied amounts). If deposits exist, `min(available, balanceDue)` is auto-applied before the payment leg. This reduces cash required and may immediately COMPLETE the sale.
- **JE for deposit:** `Dr 1000/1100 / Cr 2250 Advance Customer Payments`, `sourceModule: 'PAYMENT'`.
- **JE for deposit apply:** `Dr 2250 / Cr 1200 AR`, `sourceModule: 'SALES'`.
- **Customer deposit balance:** Exposed via `GET /customers/:id/balance` as `depositHeld: number`. Can be viewed on Customer detail page.

## Deposits Flow

1. **Record Deposit** (`POST /sales/deposits`, `sales:payment`): Creates standalone deposit with `transactionType='DEPOSIT'`, no sale linkage. Posts JE `Dr Cash/Bank / Cr 2250`. Returns updated `depositHeld`.
2. **Auto-apply on Invoice Creation** (`deliver`): When creating an invoice for a DELIVERED sale, checks `availableAdvance = Σ deposits - Σ depositApplied`. If balance > 0, applies `min(available, balanceDue)`, updates invoice, posts `Dr 2250 / Cr 1200`, marks invoice PAID, may complete the sale.
3. **Balance Calculation** (customers service.ts): `depositHeld = standaloneDeposits + openingDeposits - appliedOnInvoices`. Used for UI displays.

## Available FG Quantity (POS)

- When selecting a variant in the new sale form, displays "Available: N packs in FG store".
- Backend `GET /products` now includes `availableFgQty` on each variant (sum of FinishedGoodStock at FG_STORE location, qty > 0).
- Shown in green when >0, amber when 0, red when qty exceeds available.

## Jar Refill / Outright Sale

- **Business rules:** Jar products can be sold as OUTRIGHT (full BOM price, customer takes jar) or REFILL (reduced price excluding jar cost, customer returns empty jar). Jar variants default to REFILL in POS. Operator can toggle to OUTRIGHT.
- **Jar material linkage:** `ProductVariant.jarMaterialId` (nullable FK → Material) links each JAR variant to its container material. Set in Products page BOM panel (amber dropdown). This is how the system knows which material to replenish on refill delivery.
- **Refill price:** `ProductVariant.refillPrice` (nullable Decimal). Set in Products page BOM panel (green field). When a line is marked refill, price auto-fills from refillPrice. If null, outright price is used.
- **POS UX:** JAR variants show Outright/Refill toggle pills. "Empty jars brought" input appears only when at least one line is Refill. Jar balance displayed under customer name (green when positive, amber when negative/"owed").
- **Schema fields on Sale:** `saleType Enum(OUTRIGHT|REFILL)`, `emptyBrought Int @default(0)`. On SaleLine: `isRefill Boolean @default(false)`.
- **Delivery flow (`sales/service.ts:deliver()`):** On deliver, reads `emptyBrought` from sale. Jar balance updated: `customer.jarBalance += emptyBrought - totalRefillQty`. JAR20 (or configured material) stock incremented by `emptyBrought` via `RETURN` StockMovement. The material is resolved from `line.variant.jarMaterial` (loaded via Prisma include).
- **Record Jar Return** (`POST /customers/:id/jar-return`, `customer:edit`): Standalone jar return outside a sale. Decrements `customer.jarBalance` and increments configured material stock. Uses `Settings.jarMaterialCode` to resolve the material (global fallback for cases without a specific variant context).
- **MovementType:** `RETURN` added to enum — used for empty jar returns to raw material stock.
- **Per-customer jar balance:** `Customer.jarBalance Int @default(0)`. Tracks empty jars customer has in their possession. Starting balance = 0 at go-live. Can go negative (trusted customer takes refills before returning empties).
