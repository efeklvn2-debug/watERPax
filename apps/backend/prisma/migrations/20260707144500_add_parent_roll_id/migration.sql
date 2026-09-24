-- AlterTable
ALTER TABLE "Roll" ADD COLUMN "parentRollId" TEXT;

-- AddForeignKey
ALTER TABLE "Roll" ADD CONSTRAINT "Roll_parentRollId_fkey" FOREIGN KEY ("parentRollId") REFERENCES "Roll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Roll_parentRollId_idx" ON "Roll"("parentRollId");
