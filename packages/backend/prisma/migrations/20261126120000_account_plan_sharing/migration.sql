-- CreateEnum
CREATE TYPE "PlanRole" AS ENUM ('VIEWER', 'CONTRIBUTOR');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "AccountCoOwner" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCoOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanMember" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlanRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountCoOwner_userId_idx" ON "AccountCoOwner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCoOwner_accountId_userId_key" ON "AccountCoOwner"("accountId", "userId");

-- CreateIndex
CREATE INDEX "PlanMember_userId_idx" ON "PlanMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanMember_planId_userId_key" ON "PlanMember"("planId", "userId");

-- CreateIndex
CREATE INDEX "Transaction_createdById_idx" ON "Transaction"("createdById");

-- AddForeignKey
ALTER TABLE "AccountCoOwner" ADD CONSTRAINT "AccountCoOwner_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCoOwner" ADD CONSTRAINT "AccountCoOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanMember" ADD CONSTRAINT "PlanMember_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanMember" ADD CONSTRAINT "PlanMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Co-ownership is never granted on payment partners
CREATE FUNCTION "reject_partner_co_owner"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Account" WHERE "id" = NEW."accountId" AND "type" = 'PAYMENT_PARTNER') THEN
    RAISE EXCEPTION 'Payment partners cannot have co-owners';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountCoOwner_no_partner" BEFORE INSERT OR UPDATE ON "AccountCoOwner"
FOR EACH ROW EXECUTE FUNCTION "reject_partner_co_owner"();
