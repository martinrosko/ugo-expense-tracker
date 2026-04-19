-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "defaultAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
