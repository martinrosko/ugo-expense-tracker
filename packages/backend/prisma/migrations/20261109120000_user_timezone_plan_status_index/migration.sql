-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezone" TEXT;

-- CreateIndex
CREATE INDEX "Plan_statusCode_startDate_endDate_idx" ON "Plan"("statusCode", "startDate", "endDate");
