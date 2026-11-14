-- A tag can now be assigned to a plan, budget or account as well as a transaction
ALTER TABLE "TagObject" ALTER COLUMN "transactionId" DROP NOT NULL;

ALTER TABLE "TagObject" ADD COLUMN "planId" TEXT;
ALTER TABLE "TagObject" ADD COLUMN "budgetId" TEXT;
ALTER TABLE "TagObject" ADD COLUMN "accountId" TEXT;

CREATE UNIQUE INDEX "TagObject_planId_tagId_key" ON "TagObject"("planId", "tagId");
CREATE UNIQUE INDEX "TagObject_budgetId_tagId_key" ON "TagObject"("budgetId", "tagId");
CREATE UNIQUE INDEX "TagObject_accountId_tagId_key" ON "TagObject"("accountId", "tagId");

ALTER TABLE "TagObject" ADD CONSTRAINT "TagObject_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagObject" ADD CONSTRAINT "TagObject_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagObject" ADD CONSTRAINT "TagObject_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one target object per row
ALTER TABLE "TagObject" ADD CONSTRAINT "TagObject_single_object_check"
  CHECK (num_nonnulls("transactionId", "planId", "budgetId", "accountId") = 1);
