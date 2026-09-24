-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "expectedDeliveryDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductionJob" ADD COLUMN "customerId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "rollWeight" DECIMAL(5,2) NOT NULL DEFAULT 15;

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ProductionJob_customerId_idx" ON "ProductionJob"("customerId");
