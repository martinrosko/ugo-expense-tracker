-- AlterTable
ALTER TABLE "BankTicket" ADD COLUMN "pairedTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "BankTicket_pairedTransactionId_idx" ON "BankTicket"("pairedTransactionId");

-- AddForeignKey
ALTER TABLE "BankTicket" ADD CONSTRAINT "BankTicket_pairedTransactionId_fkey" FOREIGN KEY ("pairedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
