# Customer Returns — Fix for Existing Tenants

## Problem

The customer returns feature (ARCHITECTURE.md §6.6) had a critical issue with **existing tenants**:

- **Symptom**: Credit notes could not correctly restore FG stock to the original batch
- **Root Cause**: `SaleLine.allocation` is optional and often missing for sales DELIVERED before customer returns were implemented
- **Financial Impact**: COGS reversal credited the **wrong** FG batch, breaking material lot tracking

## Solution (two parts)

### 1. Data migration — `scripts/migrate-customer-returns-allocation.mjs`

Best-effort FIFO reconstruction from `FinishedGoodStock` (there is **no FG movement ledger** — `StockMovement` is raw-materials only; the app writes `SaleLine.allocation` at sale CONFIRM).

**Reconstruction order** (per sale line):
1. Oldest `FG_STORE` batch with `createdAt <= sale.createdAt`
2. Else oldest `FG_STORE` batch of any age
3. Else most recent batch at any location
4. Else leave `null` → runtime falls back to a `RET-YYYY-NNNN` bucket (no `CustomerReturnsAllocationPatch` row written at runtime)

Each processed sale is marked in `CustomerReturnsAllocationPatch` (`saleId` unique) so re-runs skip it.

**Script contract:**
- Imports `PrismaClient` from `@prisma/client` (not `@waterpax/types`)
- Loads `DATABASE_URL` from `apps/backend/.env` if not already set
- `DRY_RUN` defaults to **true**; apply with `DRY_RUN=false`
- Optional `BATCH_SIZE` (default 1000) — candidates selected via `$queryRaw` with `NOT EXISTS` on the patch table + JSON null/`'[]'`/non-array/missing-`batchNumber` filter
- Dry-run is a single pass (terminates without writing)

**Tracking table** comes from `prisma/schema.prisma` via `npx prisma db push` (watERPax deploy uses `db push`, not `migrate deploy` — there is no `_prisma_migrations` table).

Optional SQL lives at `apps/backend/prisma/migrations/20260920000000_patch_customer_returns_allocation/migration.sql`:
- Table DDL matching Prisma (`saleId` unique, tenant/sale indexes, FK)
- Helper `get_allocation_for_sale_line()` using FinishedGoodStock only
- Verification view `v_customer_returns_allocation_status` (`sale_status` / `allocation_status` columns — no duplicate `status`)
- **No trigger** (app writes allocation at CONFIRM), **no `COMMIT`**

### 2. Runtime fallback — `apps/backend/src/modules/sales/service.ts`

`createCustomerCreditNote` no longer references nonexistent `sale.allocation` / `input.tenantId` and no longer writes to `CustomerReturnsAllocationPatch` (migration-only bookkeeping).

If `allocation[0]?.batchNumber` is missing:
1. Reconstruct FIFO from `FinishedGoodStock` (same order as the script)
2. If a real batch is found → backfill that line’s `SaleLine.allocation` inside the credit-note transaction, use that batch
3. Else → `RET-` bucket (warn only; no patch-table write)
4. Audit `metadata` includes `batchNumber`, `allocationMissing`, `allocationReconstructed`

## Usage

### Step 1 — Ensure tracking table exists

```bash
cd apps/backend
npx prisma generate
npx prisma db push --skip-generate
```

(Optional) apply `migration.sql` manually if you also want the SQL function/view.)

### Step 2 — Dry-run, then apply

```bash
# Dry run (default — no writes)
node scripts/migrate-customer-returns-allocation.mjs

# Apply
DRY_RUN=false node scripts/migrate-customer-returns-allocation.mjs

# Larger batch
DRY_RUN=false BATCH_SIZE=2000 node scripts/migrate-customer-returns-allocation.mjs
```

Example dry-run output:

```
Customer Returns Allocation Backfill
  Dry run: yes (no writes)
  Batch size: 1000

Found 1 sale(s) with missing allocation

  SAL-2026-0028: patch 1/1 missing line(s)

SUMMARY
Sales processed:     1
Lines patched:       1
Lines left null:     0
Dry run:             yes (no writes)

Apply with: DRY_RUN=false node scripts/migrate-customer-returns-allocation.mjs
```

### Step 3 — Verify

```sql
SELECT
  "saleNumber",
  sale_status,
  "createdAt",
  line_count,
  lines_with_allocation,
  allocation_status
FROM v_customer_returns_allocation_status;
-- allocation_status = READY_FOR_RETURNS when every line has a batch
```

Or re-run the script — it should print `No sales need allocation backfill`.

### Step 4 — Test returns

```bash
# Backend must be running on :3001
node scripts/customer-return.e2e.mjs
```

## Rollback (if needed)

```sql
DROP VIEW IF EXISTS "v_customer_returns_allocation_status";
DROP FUNCTION IF EXISTS "get_allocation_for_sale_line"(TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS "CustomerReturnsAllocationPatch";
-- Do NOT null SaleLine.allocation on real data unless you intend to force RET- fallback
```

## Technical details

### Why batches are critical

COGS reversal must credit the **exact batch** that was debited when the sale was delivered:

```
Sale Deliver → Dr FG (B-100, qty 100) → Cr COGS
Customer Return → Cr FG (B-100, qty 10) → Dr COGS   // same batch
```

Credit the wrong batch and FG balances diverge from physical lots even though the JE totals balance.

### Why no trigger / no FG movement ledger

- Allocation is written by the app at CONFIRM (`sales/service.ts`) — a DB trigger would race/duplicate that path.
- `StockMovement` only tracks raw materials (`materialId`/`stockId→Stock`); FG qty lives as a counter on `FinishedGoodStock`. Reconstruction therefore cannot replay OUT movements and must FIFO from current FG rows.

### Runtime vs migration patch table

- **Migration script** is the only writer of `CustomerReturnsAllocationPatch`.
- **Runtime** reconstructs + backfills `saleLine.allocation` directly and never creates patch rows (avoids polluting migration bookkeeping with `saleId @unique` rows that would make later migrations skip sales).

## Monitoring

```sql
-- Sales still missing allocation (candidates for another apply run)
SELECT COUNT(*) AS pending_sales
FROM "Sale" s
WHERE s.status IN ('DELIVERED', 'COMPLETED')
  AND EXISTS (
    SELECT 1 FROM "SaleLine" sl
    WHERE sl."saleId" = s.id
      AND (sl.allocation IS NULL OR sl.allocation = '[]'::JSONB)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "CustomerReturnsAllocationPatch" p WHERE p."saleId" = s.id
  );
```

Runtime warnings in backend logs:

```
⚠️  No allocation for sale SAL-2026-001, reconstructed batch: PRD-2026-0001
⚠️  No allocation or FG stock for sale SAL-2026-002, creating return bucket: RET-2026-0001
⚠️  Used reconstructed batch number: PRD-2026-0001
```

## Future enhancements

- [ ] Alert when a DELIVERED sale stays null-allocation for >30 days
- [ ] Cleanup / reassign stale `RET-` batches
- [ ] Write multi-leg FIFO allocation at CONFIRM when a sale spans batches
