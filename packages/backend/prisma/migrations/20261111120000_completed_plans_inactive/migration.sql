-- Completed plan instances are inactive and keep the template's recurrence config
UPDATE "Plan" p
SET "stateCode" = 1,
    "recurrenceConfig" = COALESCE(p."recurrenceConfig", t."recurrenceConfig"),
    "updatedAt" = now()
FROM "Plan" t
WHERE p."templateId" = t."id"
  AND p."statusCode" = 3
  AND p."isTemplate" = false;

UPDATE "Plan"
SET "stateCode" = 1, "updatedAt" = now()
WHERE "statusCode" = 3
  AND "isTemplate" = false
  AND "stateCode" <> 1;
