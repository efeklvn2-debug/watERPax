# watERPax — Make-to-Stock Water Packaging ERP

Multi-tenant production & financial ERP for Nigerian water-packaging factories (Bottled, Sachet, Refill Jars). Forked lineage from FlexoPrint ERP, independent repo/DB/domain/deploy.

**Status:** Foundation (P0) 29 Aug 2026 — `docs/PLAN.md` locked, `AGENTS.md` deploy workflow defined, `docs/ARCHITECTURE.md` MTS architecture. Local-first dev on `waterpax` DB before any Hetzner work.

## What it does (MTS)

| Module | Highlights |
|---|---|
| **Products (tenant-configurable)** | `Product` (BOTTLED/SACHET/JAR) + `ProductVariant` free-form labels (33cl/50cl/... any size) + `packSize` + VAT-inclusive `pricePerUnit` (editable at invoice for discounts) + `BOM` per variant |
| **Production MTS** | `ProductionRun` PLANNED→IN_PROGRESS→COMPLETED, `batchNumber` only, BOM snapshot, per-component waste + derived variance (procured vs FG realised) |
| **Inventory FG** | `FinishedGoodStock` by `variantId+batchNumber` at `FG_STORE`, lot-tracked |
| **Sales MTS + POS** | `Sale` DRAFT→CONFIRMED→DELIVERED, from FG with `SELECT ... FOR UPDATE` allocation, cash & credit, 80mm thermal receipt, `SaleLine.unitPrice` discount |
| **Procurement** | PO with `POLineItem.specJson {grammage, vendor}` for preform vendor compromise, goods receipt → raw stock, supplier invoices |
| **Finance** | Double-entry JE `postJournalEntry`, COA `1325-1327 FG / 1310 raw`, `Dr 5000 COGS / Cr FG` on delivery, VAT `decomposeInclusive`, period lock `booksLockedUntil`, negative-cash guard |
| **Guide Angel** | Tenant admin 4-step (Money→Customers→Suppliers→FG+raw Stock) → one balanced `Dr 1325-1327/1310 / Cr 3000 OBE` |
| **Reports** | FG Valuation, Production Output, Waste by Component, Variance, Sales by SKU, Low Stock — CSV + print |

## Stack

Frontend React 18 + Vite + Tailwind + PWA | Backend Node 20 Express+Prisma+TS | PG 16-18 | Hetzner CPX12 Nginx PM2 Cloudflare (second vhost) — same pattern as FlexoPrint but `waterpax-backend:3001`, DB `waterpax`.

## Local Dev

```bash
npm ci                               # root
# backend
cd apps/backend && npm install
cp .env.example .env                  # DATABASE_URL=.../waterpax, JWT_SECRET, CORS_ORIGIN, ADMIN_PASSWORD, PORT=3001
npx prisma generate && npx prisma db push && npx prisma db seed
npm run dev                           # :3001
# frontend (second terminal)
cd apps/frontend && npm install && npm run dev  # :5173
npx tsc --noEmit                      # both sides
BASE_URL=http://127.0.0.1:3001/api SMOKE_USER=superadmin node scripts/smoke-test.mjs
```

## Source

Forked from `C:/Users/USER/Desktop/rebuilding/To WebApp Project/FlexoPrint ERP` (`phlexerp.com.ng`). No legacy Roll/InkColor. See `docs/PLAN.md`.

## License

Proprietary — all rights reserved.
