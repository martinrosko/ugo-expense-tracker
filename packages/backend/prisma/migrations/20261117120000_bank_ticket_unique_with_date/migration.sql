-- DropIndex
DROP INDEX "BankTicket_accountId_ticketId_key";

-- CreateIndex
CREATE UNIQUE INDEX "BankTicket_accountId_ticketId_executedOn_key" ON "BankTicket"("accountId", "ticketId", "executedOn");
