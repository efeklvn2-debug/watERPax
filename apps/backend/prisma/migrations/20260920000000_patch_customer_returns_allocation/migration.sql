-- Migration: Patch Customer Returns Allocation for Existing Tenants
-- Issue: createCustomerCreditNote uses SaleLine.allocation[0].batchNumber to know
-- which FG batch to increment on returns, but legacy DELIVERED/COMPLETED sales
-- may have null/empty allocation → incorrect COGS attribution.
--
-- Deploy note: watERPax uses `prisma db push` (no _prisma_migrations).
-- This SQL is optional/manual; the Node script below does the data patch.
-- No trigger: the app writes allocation at sale CONFIRM (sales/service.ts).
-- No COMMIT: prisma migrate wraps each migration in a transaction.

-- Step 1: Tracking table (must match prisma/schema.prisma CustomerReturnsAllocationPatch)
CREATE TABLE IF NOT EXISTS "CustomerReturnsAllocationPatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "saleNumber" TEXT NOT NULL,
    "linePatched" INTEGER NOT NULL DEFAULT 0,
    "patchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerReturnsAllocationPatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerReturnsAllocationPatch_saleId_key"
    ON "CustomerReturnsAllocationPatch"("saleId");

CREATE INDEX IF NOT EXISTS "CustomerReturnsAllocationPatch_tenantId_idx"
    ON "CustomerReturnsAllocationPatch"("tenantId");

CREATE INDEX IF NOT EXISTS "CustomerReturnsAllocationPatch_saleId_idx"
    ON "CustomerReturnsAllocationPatch"("saleId");

ALTER TABLE "CustomerReturnsAllocationPatch"
    ADD CONSTRAINT IF NOT EXISTS "CustomerReturnsAllocationPatch_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 2: Optional helper — best-effort FIFO reconstruction from FinishedGoodStock only
-- (StockMovement is raw-materials only; there is no FG movement ledger.)
CREATE OR REPLACE FUNCTION "get_allocation_for_sale_line"(
    p_tenant_id TEXT,
    p_sale_id TEXT,
    p_variant_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
    v_sale_created TIMESTAMP(3);
    v_line_qty INTEGER;
    v_id TEXT;
    v_batch TEXT;
BEGIN
    SELECT s."createdAt" INTO v_sale_created FROM "Sale" s WHERE s.id = p_sale_id;
    IF v_sale_created IS NULL THEN
        RETURN '[]'::JSONB;
    END IF;

    SELECT sl.qty INTO v_line_qty FROM "SaleLine" sl
    WHERE sl."saleId" = p_sale_id AND sl."variantId" = p_variant_id
    LIMIT 1;
    IF v_line_qty IS NULL THEN
        v_line_qty := 0;
    END IF;

    -- 1) Oldest FG_STORE batch created at or before the sale (FIFO)
    SELECT f.id, f."batchNumber" INTO v_id, v_batch
    FROM "FinishedGoodStock" f
    WHERE f."tenantId" = p_tenant_id
      AND f."variantId" = p_variant_id
      AND f.location = 'FG_STORE'
      AND f."createdAt" <= v_sale_created
    ORDER BY f."createdAt" ASC
    LIMIT 1;

    -- 2) Else oldest FG_STORE batch of any age
    IF v_batch IS NULL THEN
        SELECT f.id, f."batchNumber" INTO v_id, v_batch
        FROM "FinishedGoodStock" f
        WHERE f."tenantId" = p_tenant_id
          AND f."variantId" = p_variant_id
          AND f.location = 'FG_STORE'
        ORDER BY f."createdAt" ASC
        LIMIT 1;
    END IF;

    -- 3) Else most recent batch at any location
    IF v_batch IS NULL THEN
        SELECT f.id, f."batchNumber" INTO v_id, v_batch
        FROM "FinishedGoodStock" f
        WHERE f."tenantId" = p_tenant_id
          AND f."variantId" = p_variant_id
        ORDER BY f."createdAt" DESC
        LIMIT 1;
    END IF;

    IF v_batch IS NULL THEN
        RETURN '[]'::JSONB;
    END IF;

    RETURN jsonb_build_array(jsonb_build_object(
        'stockId', v_id,
        'batchNumber', v_batch,
        'qty', v_line_qty
    ));
END
$function$;

-- Step 3: Verification view (columns renamed to avoid duplicate "status")
CREATE OR REPLACE VIEW "v_customer_returns_allocation_status" AS
SELECT
    s.id,
    s."saleNumber",
    s.status AS sale_status,
    s."createdAt",
    COUNT(sl.id) AS line_count,
    COUNT(CASE WHEN sl.allocation IS NOT NULL AND sl.allocation != '[]'::JSONB THEN 1 END) AS lines_with_allocation,
    CASE
        WHEN COUNT(sl.id) = 0 THEN 'NO_LINES'
        WHEN COUNT(CASE WHEN sl.allocation IS NOT NULL AND sl.allocation != '[]'::JSONB THEN 1 END) = COUNT(sl.id)
            THEN 'READY_FOR_RETURNS'
        ELSE 'NEEDS_REPROCESSING'
    END AS allocation_status
FROM "Sale" s
LEFT JOIN "SaleLine" sl ON sl."saleId" = s.id
WHERE s.status IN ('DELIVERED', 'COMPLETED')
GROUP BY s.id, s."saleNumber", s.status, s."createdAt";

-- Step 4: Optional single-shot batch UPDATE (prefer scripts/migrate-customer-returns-allocation.mjs)
/*
UPDATE "SaleLine" sl
SET allocation = "get_allocation_for_sale_line"(sl."tenantId", sl."saleId", sl."variantId")
FROM "Sale" s
WHERE s.id = sl."saleId"
  AND s.status IN ('DELIVERED', 'COMPLETED')
  AND (sl.allocation IS NULL OR sl.allocation = '[]'::JSONB)
  AND NOT EXISTS (
    SELECT 1 FROM "CustomerReturnsAllocationPatch" p WHERE p."saleId" = s.id
  );
*/

-- Rollback
/*
DROP VIEW IF EXISTS "v_customer_returns_allocation_status";
DROP FUNCTION IF EXISTS "get_allocation_for_sale_line"(TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS "CustomerReturnsAllocationPatch";
*/
