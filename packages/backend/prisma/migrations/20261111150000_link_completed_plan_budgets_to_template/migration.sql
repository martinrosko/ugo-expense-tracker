-- Budgets of completed plan instances that were imported without a template link and with empty values:
-- pair them with the template plan's budgets and copy the inherited values.
-- Budgets are indistinguishable, so the pairing is by rank: budgets with the most executed spend get the largest template budget.
-- Plans whose unlinked budget count differs from the template's budget count are left untouched.
WITH ranked AS (
  SELECT b."id", p."templateId" AS "planTemplateId",
    row_number() OVER (
      PARTITION BY b."planId"
      ORDER BY COALESCE((SELECT sum(x."amount") FROM "Transaction" x WHERE x."budgetId" = b."id"), 0) DESC, b."createdAt", b."id"
    ) AS rn,
    count(*) OVER (PARTITION BY b."planId") AS cnt
  FROM "Budget" b
  JOIN "Plan" p ON p."id" = b."planId"
  WHERE p."statusCode" = 3
    AND p."isTemplate" = false
    AND p."templateId" IS NOT NULL
    AND b."templateId" IS NULL
    AND b."name" IS NULL
    AND b."amount" IS NULL
),
tpl AS (
  SELECT t."id", t."planId", t."name", t."amount", t."defaultAccountId",
    row_number() OVER (PARTITION BY t."planId" ORDER BY t."amount" DESC NULLS LAST, t."name", t."id") AS rn,
    count(*) OVER (PARTITION BY t."planId") AS cnt
  FROM "Budget" t
)
UPDATE "Budget" b
SET "templateId" = tpl."id",
    "name" = tpl."name",
    "amount" = tpl."amount",
    "defaultAccountId" = COALESCE(b."defaultAccountId", tpl."defaultAccountId"),
    "updatedAt" = now()
FROM ranked r
JOIN tpl ON tpl."planId" = r."planTemplateId" AND tpl.rn = r.rn AND tpl.cnt = r.cnt
WHERE b."id" = r."id";
