-- Payout Recipient Verification & Private Uploaded Files Authorization

CREATE TYPE "PayoutDestinationVerificationStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED');

ALTER TABLE "seller_payout_destinations"
  ALTER COLUMN "isVerified" SET DEFAULT false,
  ADD COLUMN "verificationStatus" "PayoutDestinationVerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "bankRecipientId" TEXT,
  ADD COLUMN "verificationMethod" TEXT,
  ADD COLUMN "verificationEvidenceRef" TEXT,
  ADD COLUMN "verificationNote" TEXT,
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "verifiedByStaffId" UUID,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);

-- Existing records without independent staff verification proof must NOT remain auto-verified.
-- Historical payouts and ledger records remain intact via payout.destinationSnapshot & destinationReference.
UPDATE "seller_payout_destinations"
SET "isVerified" = false,
    "verificationStatus" = 'PENDING_REVIEW'
WHERE "verifiedByStaffId" IS NULL;

UPDATE "seller_payout_destinations"
SET "verificationStatus" = 'VERIFIED'
WHERE "verifiedByStaffId" IS NOT NULL AND "isVerified" = true;

CREATE INDEX "seller_payout_destinations_verificationStatus_createdAt_idx"
  ON "seller_payout_destinations"("verificationStatus", "createdAt");

-- Private uploaded files metadata & authorization tracking
CREATE TYPE "UploadedFilePurpose" AS ENUM ('BANK_PROOF', 'DELIVERABLE', 'GENERAL');

CREATE TABLE "uploaded_files" (
  "id" UUID NOT NULL,
  "storedName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploaderUserId" UUID,
  "purpose" "UploadedFilePurpose" NOT NULL DEFAULT 'GENERAL',
  "contractId" UUID,
  "milestoneId" UUID,
  "bankProofId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uploaded_files_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uploaded_files_storedName_key" ON "uploaded_files"("storedName");
CREATE INDEX "uploaded_files_uploaderUserId_createdAt_idx" ON "uploaded_files"("uploaderUserId", "createdAt");
CREATE INDEX "uploaded_files_contractId_purpose_idx" ON "uploaded_files"("contractId", "purpose");
CREATE INDEX "uploaded_files_milestoneId_idx" ON "uploaded_files"("milestoneId");

-- Best-effort link backfill for already linked bank proofs & deliverables (unlinked files stay inaccessible)
INSERT INTO "uploaded_files" ("id", "storedName", "originalName", "mimeType", "sizeBytes", "uploaderUserId", "purpose", "contractId", "bankProofId", "createdAt")
SELECT
  gen_random_uuid(),
  regexp_replace("receiptFileUrl", '^.*/uploads/', ''),
  regexp_replace("receiptFileUrl", '^.*/uploads/', ''),
  'application/octet-stream',
  0,
  "buyerId",
  'BANK_PROOF'::"UploadedFilePurpose",
  "contractId",
  "id",
  "createdAt"
FROM "bank_transfer_proofs"
WHERE "receiptFileUrl" ~ '/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|pdf|zip|txt)$'
ON CONFLICT ("storedName") DO NOTHING;

INSERT INTO "uploaded_files" ("id", "storedName", "originalName", "mimeType", "sizeBytes", "uploaderUserId", "purpose", "contractId", "milestoneId", "createdAt")
SELECT
  gen_random_uuid(),
  regexp_replace(u, '^.*/uploads/', ''),
  regexp_replace(u, '^.*/uploads/', ''),
  'application/octet-stream',
  0,
  ms."submittedById",
  'DELIVERABLE'::"UploadedFilePurpose",
  m."contractId",
  ms."milestoneId",
  ms."createdAt"
FROM "milestone_submissions" ms
JOIN "milestones" m ON m."id" = ms."milestoneId",
LATERAL unnest(ms."deliverableUrls") AS u
WHERE u ~ '/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|pdf|zip|txt)$'
ON CONFLICT ("storedName") DO NOTHING;

DO $$
DECLARE
  app_role text := COALESCE(NULLIF(current_setting('bobololadono.app_role', true), ''), 'bobololadono_app');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', 'uploaded_files', app_role);
  END IF;
END $$;
