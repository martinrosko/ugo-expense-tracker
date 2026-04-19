-- Fix plan and transaction dates shifted -1 day due to UTC+2 timezone during import.
-- Resco startDate/plannedOn/executedOn: midnight local time → UTC shift → -1 day → needs +1.
-- Resco endDate: exclusive midnight of NEXT day local time → UTC shift accidentally gives correct
--   inclusive last day → endDate was already correct, so we do NOT shift it.

UPDATE "Plan"
SET "startDate" = "startDate" + INTERVAL '1 day'
WHERE "startDate" IS NOT NULL;

-- endDate was already stored correctly (UTC shift on exclusive end date = correct inclusive date)
-- No change needed for endDate.

UPDATE "Transaction"
SET "plannedOn" = "plannedOn" + INTERVAL '1 day'
WHERE "plannedOn" IS NOT NULL;

UPDATE "Transaction"
SET "executedOn" = "executedOn" + INTERVAL '1 day'
WHERE "executedOn" IS NOT NULL;
