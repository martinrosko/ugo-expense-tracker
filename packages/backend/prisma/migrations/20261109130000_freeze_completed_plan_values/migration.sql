-- Freeze template-inherited values on plans that are already completed, so history stays unchanged
-- when their template is edited later. Only fills NULLs; own values are never overwritten.

UPDATE "Plan" p
SET "name" = COALESCE(p."name", t."name"),
    "defaultAccountId" = COALESCE(p."defaultAccountId", t."defaultAccountId")
FROM "Plan" t
WHERE p."templateId" = t."id"
  AND p."statusCode" = 3
  AND p."isTemplate" = false;

UPDATE "Budget" b
SET "name" = COALESCE(b."name", t."name"),
    "amount" = COALESCE(b."amount", t."amount"),
    "defaultAccountId" = COALESCE(b."defaultAccountId", t."defaultAccountId")
FROM "Budget" t, "Plan" p
WHERE b."templateId" = t."id"
  AND b."planId" = p."id"
  AND p."statusCode" = 3
  AND p."isTemplate" = false;

UPDATE "Transaction" x
SET "name" = COALESCE(x."name", t."name"),
    "plannedAmount" = COALESCE(x."plannedAmount", t."plannedAmount"),
    "plannedOn" = COALESCE(x."plannedOn", t."plannedOn"),
    "dueDateConfig" = COALESCE(x."dueDateConfig", t."dueDateConfig"),
    "fromAccountId" = COALESCE(x."fromAccountId", t."fromAccountId"),
    "toAccountId" = COALESCE(x."toAccountId", t."toAccountId")
FROM "Transaction" t
WHERE x."templateId" = t."id"
  AND (
    x."planId" IN (SELECT "id" FROM "Plan" WHERE "statusCode" = 3 AND "isTemplate" = false)
    OR x."budgetId" IN (
      SELECT b."id" FROM "Budget" b JOIN "Plan" p ON p."id" = b."planId"
      WHERE p."statusCode" = 3 AND p."isTemplate" = false
    )
  );
