# watERPax — Agent Instructions

> Water-packaging MTS ERP. Forked lineage from FlexoPrint ERP, **independent repo/DB/domain/deploy**. Local-first, same hardening lineage.

## CURRENT SESSION POINTER — WatERPax build state (5 Oct 2026)

- **State:** P0–P4 shipped — **live in production at `https://waterpax.com.ng`** (Docker deploy, see DEPLOY WORKFLOW below). `master` @ `50da48a` (PR #26: nginx vhosts + Origin CA install scripts). PRs #1–#26 all merged, CI green. Session history + **known issues** live in `CONTEXT.md` → "Session Log (continued, Sep–Oct 2026)" — read that before adding work.
- **P4 Docker deployment — DONE 5 Oct (PRs #24 #25 #26 + server ops, all live-verified):** app containerized — multi-stage `apps/backend/Dockerfile` (runtime carries `dist` + `src`/`tsconfig` because `prisma/seed.ts` imports `../src` — PR #25 lesson) and `apps/frontend/Dockerfile` (nginx SPA + `/api` proxy; frontend calls relative `/api`, no origin rebuild). Stack `deploy/docker-compose.yml` (postgres 16 + backend + web, loopback-only `127.0.0.1:8088`, fail-fast required env via `deploy/.env` — NOT committed, gitignored). CI `.github/workflows/docker.yml` builds/pushes `ghcr.io/efeklvn2-debug/waterpax-{backend,web}` on every `master` merge + **SSH auto-deploy job** (repo variable `DEPLOY_ENABLED=true`, secrets `DEPLOY_SSH_HOST/USER/KEY`; deploy user `deploy@46.224.0.165` with dedicated key `~/.ssh/waterpax_deploy_ed25519`, member of `docker` group). Prisma migrations **re-baselined** to `prisma/migrations/0001_init` (pre-fork FlexoPrint migrations deleted — recoverable in git history; prod runs `migrate deploy` + idempotent seed in the container entrypoint; local dev still `db push` — if switching a local DB to `migrate deploy`, first `prisma migrate resolve --applied 0001_init`). TLS = **Cloudflare Origin CA cert** (valid to Oct 2041, `/etc/ssl/waterpax-origin.pem`) because ufw only admits 80/443 from Cloudflare IP ranges → Let's Encrypt HTTP-01 can never reach the origin (this will bite phlexerp's renewal, see Next action). DNS: qservers nameservers → Cloudflare (`magali`/`albert.ns.cloudflare.com`), A `@`/`www` → `46.224.0.165`, orange-clouded, SSL Full (strict). Verified end-to-end: health 200, SPA 200, login 200 via `https://waterpax.com.ng`.
- **Production users (5 Oct):** new SUPER_ADMIN `rarebreedos1@gmail.com` created by direct DB insert (temp password set, user changes from UI). Old `superadmin` still exists with the shared `ADMIN_PASSWORD` (in `deploy/.env` on VPS + local copy) — retire it once the new login is confirmed. There is **no `email` column** — `username` is the identity. DB currently has **1 tenant** (`Demo Water Factory`) and **no backup cron yet** — data lives only in the `waterpax-postgres-1` `pgdata` volume until that lands.
- **Finance integrity audit — DONE 3–4 Oct (PRs #18 + #19):** every `postJournalEntry` caller traced; no unbalanced/non-atomic postings. PR #18: packaging single-home **1311** (1510 dormant), supplier CN VAT decomposition (**reversing input VAT CREDITS 1400** — watch the sign, the JE residual-absorber hides errors), VAT summary nets both sides on 2100/1400, AP aging nets supplier CNs, **PAYE posts `Dr 6300 / Cr 2300`** (was memo-only; JE dated PAYE month's LAST DAY → invisible in Journal's default 30-day window for the current month — user locked: keep month-end dating), `assertCashAccount` guard on `bankAccountId` (400 `INVALID_CASH_ACCOUNT`), numeric JE numbering, CIT TOCTOU closed. PR #19: dashboard cash `opening` = balance strictly before window (identity `opening+in−out==closing` holds), bank-movements consolidate `1100-XXX` children (`[Name]`-prefixed rows), fully-cascaded deposit → anchor PAYMENT tx + receipt (no schema migration), OBE banner one-click "Close to Retained Earnings" (`POST /finance/obe/close`, `Dr/Cr 3000 ↔ 3100`, `OBE_ALREADY_ZERO` on repeat). **Scope correction:** `/reports/sales/by-product` is a dead endpoint — **Sales by SKU** (`waterReports.ts`) is the real per-variant report; B2 rewrite reverted (`0a2b9a1`), endpoint is a deletion candidate. Probes: `scripts/_finance_hygiene.e2e.mjs` 46/46, `scripts/_reports_cashflow.e2e.mjs` 38/38 (both committed). Details in `CONTEXT.md`.
- **P&L cut-off + sign convention (4 Oct, PR #20 `e5ed1d6`, CI green):** desktop export `profit_loss_2026-10-01_2026-10-04.csv` (Acmed) read `Expenses -50000 / Net Profit 51845.58` on ₦2,325.58 revenue — traced line-by-line to the GL (revenue ex-VAT + COGS were correct; only the expense line was wrong). Two defects: (1) **cut-off** — `tax/service.ts deletePayeEntry` dated its reversal `new Date()` while PAYE accruals are dated month-end, so deleting one left the *reversal inside* the window and the *accrual (31 Oct) outside* → phantom negative expenses, inflated profit, and a reversal that pre-dated its own accrual. Reversal is now dated **at the accrual's date**, falling back to today only when that date is now period-locked (closed period keeps its accrual; correction lands in the open one); date built from local parts, not UTC `toISOString()`. (2) **presentation** — P&L rows are now **signed contributions** (deductions negative) so rows add down to Net: Reports statement table, expense breakdown, CSV export, chart, Finance Profit tab; `utils/currency.ts formatNaira` prints `-₦50,000` (was `₦-50,000`); no clamping — a credit on an expense account is real and must flow through. Same PR also landed the previously uncommitted shared `formatNaira` refactor (8 pages) and deleted stray `$null` / `scripts/_logo_preview.html`. Local data: Acmed `JE-2026-0168` re-dated to 31 Oct to match `JE-2026-0167`. Verified: hygiene probe 46/46 (its new reversal now lands 2026-10-31), `tsc` both apps, frontend build, lint 0 errors; post-merge Acmed 1–4 Oct = revenue 2,325.58 / COGS 480 / expenses **0** → net **1,845.58**, full Oct → net **−48,154.40**.
- **PR #8 — BS/ledger parent-child + modal double-count (2 Oct):** `reports/service.ts buildSection` totals sum top-level rows only (parent rows already roll up children — was double-counting bank subtrees, e.g. "Out of Balance ₦85,550" in `acmed`); `BalanceSheetLine` carries `parentId`, child rows indented. `finance/service.ts getGeneralLedger` returns `children`/`childrenTotal`/`consolidatedBalance` and no longer double-counts without a date filter (GTBank modal was 2× page); parent rows tagged, footer Dr/Cr sums all rows. Verified: ledger-probe 22/22, BS roll-up probe 8/8, smoke 90/90, reports smoke 53/53.
- **Local runtime:** `start-dev.bat` (PG + backend `:3001` + vite `:5173`). Backend runs plain `tsx` (**not** watch) → **restart it after every merge** or you are testing stale code. Smoke login for `/api/reports` is `admin`, never `superadmin` (`requireTenantUser` 403s SUPER_ADMIN). **Rate-limiter gotcha:** back-to-back probe batches trip the in-memory login limiter (20/15 min) → mid-suite 429s are environmental; restart backend to clear, re-run isolated. Port-3001 orphans survive background-session stops → `netstat -ano | findstr :3001` + `taskkill /PID <pid> /F` before relaunch.

- **Source:** `C:/Users/USER/Desktop/rebuilding/To WebApp Project/FlexoPrint ERP` (live at `phlexerp.com.ng`, Hetzner `46.224.0.165`, PM2 `phlexerp-backend:3000`, DB `flexoprint`). **Do NOT edit that repo, DB, or deploy.**
- **Target:** `C:/Users/USER/Desktop/watERPax` — new monorepo `waterpax` (this file). **No legacy data**; fresh DB `waterpax` on same PG server locally / same VPS remotely.
- **Model:** Make-to-Stock. Sales decoupled from Production. `Roll` + `PrintedRoll` + `InkColor` + ink rates are **deleted** (not adapted). Pack sizes per `ProductVariant.packSize` tenant-configurable; variants are free-form labels (33cl seed is default, not enum — tenant can create any size). Jar products support OUTRIGHT/REFILL sales with per-variant jar material linkage.
- **Plan:** `docs/PLAN.md` — LOCKED 2026-08-29. Phases: P0 foundation fork (this session), P1 inventory/Guide Angel, P2a ProductionRun + P2b Sales MTS/POS parallel, P3 reports/variance, P4 second vhost on Hetzner.
- **Next action:** backup cron (02:00 `pg_dump` from `waterpax-postgres-1` — the ONLY data store; no backup exists yet) → then retire old `superadmin` once `rarebreedos1@gmail.com` login is confirmed; **phlexerp LE cert expires 28 Dec 2026** and the CF-only ufw will block its HTTP-01 renewal — swap it to a Cloudflare Origin CA (same as waterpax) before then; scaling = Hetzner resize (CPX12 → CPX21/31, few-minutes window) or a second box (containerized app migrates via `pg_dump` + compose up). Open decision: one-off reclass `Dr 5400 ₦45,500 / Cr 3000` for the demo tenant's legacy credit (local DB only). Cleanup candidates (deferred): lint-hygiene pass (694 warnings, 0 errors) and dead `/reports/sales/by-product` endpoint removal. Standing pre-deploy gate unchanged: `npm ci` → `packages/types build` → builds → `tsc --noEmit` → `smoke-test.mjs` (CI enforces; never commit on `master` — feature branch → PR → squash-merge when CI green).

## DEPLOY WORKFLOW — single source of truth (watERPax — DOCKER, since 5 Oct 2026)

**Rule 1 — GitHub `master` is the only place code is born.** `local feature branch → push → PR → squash-merge when CI green`. Never commit on server.
**Rule 2 — Never commit on the server.** The only server state that matters is `deploy/.env` + the `pgdata` volume; everything else is disposable images.
**Rule 3 — Deploy is automatic on merge.** `.github/workflows/docker.yml` on every `master` push: buildx → push `ghcr.io/efeklvn2-debug/waterpax-backend` + `waterpax-web` (`latest` + commit SHA) → SSH deploy job (gated on `DEPLOY_ENABLED=true` + `DEPLOY_SSH_HOST/USER/KEY`) runs `docker compose pull && docker compose up -d --remove-orphans` on the VPS, then health-gates on `http://127.0.0.1:8088/api/health` (15×2s, dumps backend logs + fails the job if not healthy). Manual fallback: `ssh deploy@46.224.0.165` → `cd /home/deploy/waterpax && docker compose pull && docker compose up -d --remove-orphans`.

**VPS layout (Hetzner `46.224.0.165`, Ubuntu, coexists with FlexoPrint):**
- Stack: `/home/deploy/waterpax/` — `docker-compose.yml` + `.env` (0600; holds `BACKEND_IMAGE`/`WEB_IMAGE`/`POSTGRES_PASSWORD`/`JWT_SECRET`/`ADMIN_PASSWORD`/`CORS_ORIGIN`/`COOKIE_SECURE`). Compose project name `waterpax` → containers `waterpax-postgres-1` / `waterpax-backend-1` / `waterpax-web-1`.
- **Containers (NOT PM2 — watERPax has no PM2/nvm/Node on the host):** web (nginx SPA + `/api` proxy) binds `127.0.0.1:8088` only; backend entrypoint runs `prisma migrate deploy` + idempotent `db seed` then `node dist/index.js` on 3001; postgres 16 with `pgdata` named volume. GHCR auth: `docker login ghcr.io -u efeklvn2-debug` (gh PAT with `read:packages`) — done once per server.
- Host nginx: `/etc/nginx/sites-available/waterpax` (port 80: ACME webroot `/var/www/waterpax` + HTTPS redirect) and `waterpax-https` (443: Cloudflare **Origin CA** cert `/etc/ssl/waterpax-origin.pem` + key in `/etc/ssl/private/`, phlexerp-grade security headers, proxies everything to `127.0.0.1:8088`, `proxy_hide_header` for app-level security headers to avoid doubling). Reload: `nginx -t && systemctl reload nginx`.
- ufw admits 80/443 **from Cloudflare IP ranges only** (+ 22). Let's Encrypt HTTP-01 can never reach the origin → certbot is dead here; use Origin CA certs (15-year, free, dashboard-issued). **FlexoPrint still runs its old way:** PM2 `phlexerp-backend:3000`, DB `flexoprint` — do not touch.
- Agent tooling gotcha: direct root nginx edits over SSH are blocked by the local security guard → write a `.sh` script, `scp` to `/tmp`, `ssh root@ "bash /tmp/x.sh"`, delete from `/tmp` after.

**VERIFY after any deploy:** `curl -s -o /dev/null -w "%{http_code}" https://waterpax.com.ng/api/health` = 200; `docker compose -f /home/deploy/waterpax/docker-compose.yml ps` all Up (postgres healthy); `docker logs waterpax-backend-1 | tail` shows `Server started`, no errors. Schema changes ship inside images via `migrate deploy` — never `db push` on prod.

**PowerShell/SSH gotchas (still apply, plus):** pipe `ssh "cmd | head"` breaks; scp a `.sh` script + `ssh 'bash /tmp/x.sh'`. Windows `ssh` to this box needs `-n -o BatchMode=yes` or the session hangs on stdin (GetConsoleMode). `USERNAME` env shadows `SMOKE_USER`. `git fetch origin master` writes only `FETCH_HEAD` — use plain `git fetch origin`.

## CI — active state

- `.github/workflows/ci.yml` — triggers `push/PR to master` + `workflow_dispatch`.
- Jobs: `typecheck-build` (`packages/types build` first — workspaces discovery order, not topological → must build types before `tsc`) + `smoke` (postgres service `postgres:16`, `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD` from job env, `BASE_URL=http://127.0.0.1:3001/api SMOKE_USER=superadmin node scripts/smoke-test.mjs`).
- Smoke suite must include cookie jar `waterpax_at/waterpax_rt` + `X-WaterPax-CSRF` derivation (FlexoPrint `53/53` adapted, not Bearer). `e2e` (Playwright) staged later with tax reports variant if needed.
- `.github/workflows/docker.yml` — on `master` push only: buildx + push `waterpax-{backend,web}` to GHCR (GHA layer cache), then SSH auto-deploy (skipped unless `DEPLOY_ENABLED=true`). Smoke login on PR CI is `superadmin`; on the live prod stack the tenant-router smoke logins are `admin` (`requireTenantUser` 403s SUPER_ADMIN) — same rule as local.

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
├── deploy/                 docker-compose.yml + .env.example (live .env is gitignored, 0600 on VPS)
│                           + nginx-waterpax-{http,https}.conf + install scripts
├── docs/                   PLAN.md, ARCHITECTURE.md, DEPLOYMENT.md (Docker server checklist)
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

- Tenant ADMIN (`auth:manage_users`) wizard: Money→Customers→Suppliers→Stock→Review. **Products first:** save/validate/complete return `400 SETUP_NO_PRODUCTS` until ≥1 active product variant exists (frontend shows a blocking banner + disabled Next linking to Products). Stock step seeds raw/packaging lots (`stockItems: {materialId, qty}` → `Stock`@MAIN + Dr 1300/1311) **and** FG packs on ground (`fgItems: {variantId, packs}` → `FinishedGoodStock`@`FG_STORE` batch `OPENING` + Dr 1325/1326/1327 by product category). FG packs valued from the variant BOM at current material `costPrice` (`Σ qtyPerPack × (1+wastagePct/100) × costPrice`); variants without a BOM are rejected for FG entry. One balanced opening JE `Dr 1300/1311/1325-1327/1200/1000… / Cr 2000/2250/2500/3000 OBE` + `GuideAngelOpeningBalance` receivables/payables. Idempotent, postal once. (The old "FG stays off-book / sell via Sales as 4200" stub is gone — CONFIRM hard-blocks `INSUFFICIENT_FG` on empty `FG_STORE`, so off-book FG was unsellable.)

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
