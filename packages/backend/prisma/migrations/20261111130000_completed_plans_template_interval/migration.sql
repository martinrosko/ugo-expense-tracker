-- Completed plan instances keep the interval type of their template
UPDATE "Plan" p
SET "intervalType" = t."intervalType", "updatedAt" = now()
FROM "Plan" t
WHERE p."templateId" = t."id"
  AND p."statusCode" = 3
  AND p."isTemplate" = false
  AND p."intervalType" IS DISTINCT FROM t."intervalType";
