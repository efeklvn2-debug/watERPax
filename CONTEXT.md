# watERPax — Session Context

## Pointer — Foundation Locked 29 Aug 2026

- **Source (do NOT edit):** `C:/Users/USER/Desktop/rebuilding/To WebApp Project/FlexoPrint ERP` live `phlexerp.com.ng` Hetzner `46.224.0.165` PM2 `phlexerp-backend:3000` DB `flexoprint`.
- **Target (this repo):** `C:/Users/USER/Desktop/watERPax` — new monorepo `waterpax`, independent branch `master`, independent DB `waterpax` (local) / same VPS separate DB (prod), PM2 `waterpax-backend:3001`, domain `<new-domain>` (to be set).
- **Model:** Make-to-Stock, decoupled Production/Sales. `Roll`/`PrintedRoll`/`InkColor` + ink rates are **deleted**, not adapted. Preform grammage per `POLineItem.specJson.grammage` (16.5g → 14.5g). Pack sizes per `ProductVariant.packSize` tenant-configurable; labels free-form (33cl seed not enum).
- **Plan:** `docs/PLAN.md` LOCKED 29 Aug 2026 — Phases P0 foundation fork (current) → P1 inventory/Guide Angel → P2a ProductionRun + P2b Sales MTS/POS → P3 reports/variance → P4 second vhost.
- **Next:** P0 scaffold validation: `npm ci` root → `packages/types build` → `prisma generate/push/seed` → `backend+frontend build` → `tsc --noEmit` → `smoke-test.mjs` green on local PG before any VPS work.

## Decisions Locked (user, 29 Aug)

- InkColor + Roll/PrintedRoll entirely rebuilt → deleted.
- Fork not mutate in place (new repo `waterpax`).
- Bottled line grammage per-lot not per-Material family.
- No impact on phlexERP production.
- Pack sizes vary per tenant/company → `ProductVariant.packSize` flexible (not 12 fixed).
- Sales: both cash/credit; POS 80mm thermal receipt.
- Prices VAT-inclusive per variant, editable at invoice for discounts.
- BatchNumber only (no expiry/NAFDAC).
- Waste per component + derived variance (procured vs FG realised).
- Same VPS, same PG server (separate DB `waterpax`), new domain; start local before deploy (phlexERP workflow).
- Tenants can create any bottled variant not listed (free-form).

## Best Practice Applied (assistant)

- Product variants tenant-configurable, seed is starter not constraint. BOM per variant, `PRODUCT_CATEGORY` enum `BOTTLED|SACHET|JAR` only.
- Preform tracking: family Material + per-lot `specJson`; variance report derives waste even when not recorded.
- PR workflow + local-first retained from FlexoPrint `AGENTS.md`.

## Verification So Far

- Docs drafted: `docs/PLAN.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `CONTEXT.md` — all 29 Aug 2026.
- Scaffold: pending `npm ci` / `prisma` validation.

## Session Log (build sessions, Aug–Sep 2026)

- **P0 green:** types/backend/frontend `tsc` clean, Prisma pushed+seeded, smoke adapted (`waterpax_*` cookies, `:3001`). Superadmin 2FA disabled (re-enable later). `ADMIN_PASSWORD=admin123` seeds BOTH `superadmin` (SUPER_ADMIN, no tenant) and `admin` (ADMIN, Demo Water Factory) — same password by design, do not "fix".
- **P1 (WP1-3):** inventory module de-flexoed; Guide Angel rolls removed (qty-only stock step); schema dropped `drumSize`/`coreWeight`. `Roll`/`MaterialIssue` relation fields kept on `Material` for schema validity until models dropped.
- **Superadmin isolation fix:** new `requireTenantUser` (`middleware/tenant.ts`) 403s SUPER_ADMIN on all 12 tenant routers; `tenantMiddleware` passes superadmin through with NO tenant context (fail-open by itself). Login matrix: `admin` → tenant pages, `superadmin` → `/platform` only. Dashboard race fixed (no tenant fetch for SUPER_ADMIN / logged-out mounts).
- **P2a:** `modules/products` (CRUD+BOM) + `modules/productionRuns` (create/start/complete/cancel, BOM snapshot, 409 stock checks, FG weighted-avg, JE Dr 1325-27/Cr 1300+1311) created; old `modules/production` deleted. Verified: PRD-2026-0002 balanced ₦2940, FG 10 packs @ ₦294.
- **P2b:** `modules/sales` (draft/confirm FOR UPDATE FIFO/FG allocate/deliver revenue+COGS/invoice/cash-or-credit payments/receipts/cancel-restore) + `modules/customers` created; old `salesOrders` + dead `core` module deleted; new tenants seed water COA. Verified: SAL-2026-0001 revenue ₦7200 (ex-VAT 6697.67 + VAT 502.33), COGS ₦1176, FG 10→6.
- **1311-single-home (user-approved):** PACKAGING-category value lives ONLY in 1311 (Guide Angel opening + supplier-invoice split + run completion). 1510 dormant legacy. Invoice raw/pack split basis is `quantity × unitPrice` (not per-kg).
- **P3:** `reports/waterReports.ts` (fg-valuation, production-output, waste, variance, sales-by-sku, low-raw, dashboard) + CSV; deferred-COGS neutralized (MTS has no WIP: summary returns 1330 balance + empty list; recognize → 400 NOT_APPLICABLE).
- **WP4/WP5:** water frontend (Dashboard, Products, Production, Sales POS, Customers, Inventory raw+FG, Reports+CSV, Settings de-flexoed, nav). Deleted: SalesOrdersPage, api/salesOrders, api/production, flexo e2e. Left flexo-flavored but working: Procurement, Suppliers, Finance, Admin, Platform pages.
- **Env lessons:** machine reboot stops PG service; sandbox reaps spawned trees (backend/PG must run in user session via `start-dev.bat`, which now starts PG first). `npx prisma generate` must run from repo root (CLI+client co-located); `db push` from `apps/backend` (DATABASE_URL). Corrupted `@reduxjs/toolkit` fixed by copying from FlexoPrint `node_modules`. `vite.config.ts` proxy → `:3001`.
- **Conventions:** shared guards in `middleware/`; explicit `requireTenantId()` in write payloads (fail-closed over `$extends` + satisfies tsc); number-gen max+1 with P2002 retry; `{ data }` API envelopes; zeroed-shape stubs over dead MTO endpoints.
- **Overhead (user 09 Sep, Option A):** factory overhead (monthly salaries) is **period expense, not absorbed into FG**. `Settings.overheadRatePerKg` remains editable but unused in `productionRuns/service.ts:285-296`; FG cost = material + packaging only. `getOverheadRateHistory` stubbed to `[]` after `OverheadRateHistory` model drop. UI copy updated to dormant.
- **Phase-3 procurement wiring (Sep):** PO lines `quantity` = UoM qty, `specJson {grammage,vendor,lot}` stored/displayed, receive posts `quantity` to `MAIN` (no `Roll`), `receivedQty Float`, packaging single-home `1311`, dead models dropped (`Roll`/`PrintedRoll`/`InkColor`/`OverheadRateHistory`/`MaterialIssue`/`ProductionJob`), `transactions` module removed, `finance/postJournalEntry:135` now rounds to kobo + residual plug. ProcurementPage water rewrite. Smoke + `mts-flow` + `guide-angel` scripts added; `period-lock` adapted to `waterpax_*`.
- **Tax fixes (Sep):** `finance/repository.ts` revenue now sums `4001+4002+4003` (was 4000 only), `getExpensesByPeriod` excludes `2510`, `getCogsByPeriod` sums `5000+5100+5300`; `tax/service.ts` loss-guard `NO_PROFIT`, filing-pack VAT now year-bound, `taxSettingsSchema` partial. All flows verified (CIT/VAT/PAYE) except WHT (intentionally unimplemented, 2320 dormant).
