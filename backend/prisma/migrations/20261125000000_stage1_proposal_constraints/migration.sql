-- Stage 1: enforce typed proposal fields, server/DB-level validation checks, and buyer lookup index.
ALTER TABLE "job_proposals"
  ADD COLUMN "bidAmount" BIGINT,
  ADD COLUMN "estimatedDeliveryDays" INTEGER,
  ADD COLUMN "coverLetter" TEXT;

UPDATE "job_proposals"
SET
  "bidAmount" = COALESCE(NULLIF("payload"->>'bidAmount', '')::bigint, 1000),
  "estimatedDeliveryDays" = CASE
    WHEN ("payload"->>'estimatedDeliveryDays') ~ '^\d+$' THEN ("payload"->>'estimatedDeliveryDays')::integer
    ELSE NULL
  END,
  "coverLetter" = COALESCE(NULLIF(btrim("payload"->>'coverLetter'), ''), 'Legacy proposal');

ALTER TABLE "job_proposals"
  ALTER COLUMN "bidAmount" SET NOT NULL,
  ALTER COLUMN "coverLetter" SET NOT NULL;

ALTER TABLE "job_proposals"
  ADD CONSTRAINT "job_proposals_bidAmount_check" CHECK ("bidAmount" >= 1000 AND "bidAmount" <= 10000000000),
  ADD CONSTRAINT "job_proposals_estimatedDeliveryDays_check" CHECK ("estimatedDeliveryDays" IS NULL OR ("estimatedDeliveryDays" >= 1 AND "estimatedDeliveryDays" <= 365)),
  ADD CONSTRAINT "job_proposals_coverLetter_check" CHECK (char_length(btrim("coverLetter")) >= 5 AND char_length("coverLetter") <= 5000);

CREATE INDEX "job_proposals_jobId_createdAt_idx" ON "job_proposals"("jobId", "createdAt");

DO $$
DECLARE
  app_role text := COALESCE(NULLIF(current_setting('bobololadono.app_role', true), ''), 'bobololadono_app');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', 'job_proposals', app_role);
  END IF;
END $$;
