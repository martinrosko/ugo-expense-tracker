-- Budgets of completed plan instances are completed + inactive and keep what they inherited from their template
UPDATE "Budget" b
SET "name" = COALESCE(b."name", t."name"),
    "amount" = COALESCE(b."amount", t."amount"),
    "defaultAccountId" = COALESCE(b."defaultAccountId", t."defaultAccountId")
FROM "Budget" t, "Plan" p
WHERE b."templateId" = t."id"
  AND b."planId" = p."id"
  AND p."statusCode" = 3
  AND p."isTemplate" = false;

UPDATE "Budget" b
SET "statusCode" = 3, "stateCode" = 1, "updatedAt" = now()
FROM "Plan" p
WHERE b."planId" = p."id"
  AND p."statusCode" = 3
  AND p."isTemplate" = false;
