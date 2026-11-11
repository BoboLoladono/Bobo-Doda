-- 1. Create Enums
CREATE TYPE "ContractSourceType" AS ENUM ('SERVICE', 'JOB');
CREATE TYPE "KycVerificationStatus" AS ENUM ('DRAFT', 'PENDING', 'SCANNING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');
CREATE TYPE "KycDocumentStatus" AS ENUM ('QUARANTINED', 'SCANNING', 'CLEAN', 'INFECTED', 'REJECTED');
CREATE TYPE "KycDocumentType" AS ENUM ('PASSPORT', 'ID_CARD', 'RESIDENCE_PERMIT', 'DRIVER_LICENSE');

-- 2. Update contracts table
ALTER TABLE "contracts" ADD COLUMN "sourceType" "ContractSourceType" NOT NULL DEFAULT 'SERVICE';
ALTER TABLE "contracts" ALTER COLUMN "serviceId" DROP NOT NULL;
ALTER TABLE "contracts" ADD COLUMN "jobId" UUID;
ALTER TABLE "contracts" ADD COLUMN "proposalId" TEXT;

CREATE UNIQUE INDEX "contracts_proposalId_key" ON "contracts"("proposalId");
CREATE INDEX "contracts_jobId_idx" ON "contracts"("jobId");

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "job_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_source_check" CHECK (
  ("sourceType" = 'SERVICE' AND "serviceId" IS NOT NULL AND "jobId" IS NULL AND "proposalId" IS NULL) OR
  ("sourceType" = 'JOB' AND "serviceId" IS NULL AND "jobId" IS NOT NULL AND "proposalId" IS NOT NULL)
);

-- 3. Create kyc_verifications table
CREATE TABLE "kyc_verifications" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "KycVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "country" TEXT NOT NULL DEFAULT 'UZ',
  "documentType" "KycDocumentType" NOT NULL DEFAULT 'PASSPORT',
  "legalName" TEXT NOT NULL,
  "birthDate" DATE,
  "passportNumberHash" TEXT,
  "encryptedPassportNumber" TEXT,
  "encryptedInn" TEXT,
  "encryptedCompanyDetails" TEXT,
  "rejectionReason" TEXT,
  "staffNotes" TEXT,
  "submittedAt" TIMESTAMPTZ(6),
  "reviewedAt" TIMESTAMPTZ(6),
  "reviewedByStaffId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kyc_verifications_userId_key" UNIQUE ("userId"),
  CONSTRAINT "kyc_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "kyc_verifications_status_submittedAt_idx" ON "kyc_verifications"("status", "submittedAt");
CREATE INDEX "kyc_verifications_userId_status_idx" ON "kyc_verifications"("userId", "status");

-- 4. Create kyc_documents table
CREATE TABLE "kyc_documents" (
  "id" UUID NOT NULL,
  "verificationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "fileKey" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "sha256Hash" TEXT NOT NULL,
  "status" "KycDocumentStatus" NOT NULL DEFAULT 'QUARANTINED',
  "scanResult" JSONB,
  "scannedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kyc_documents_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "kyc_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "kyc_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "kyc_documents_verificationId_status_idx" ON "kyc_documents"("verificationId", "status");
CREATE INDEX "kyc_documents_userId_createdAt_idx" ON "kyc_documents"("userId", "createdAt");

-- 5. Grant permissions to app role
DO $$
DECLARE
  app_role text := COALESCE(NULLIF(current_setting('bobololadono.app_role', true), ''), 'bobololadono_app');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'kyc_verifications', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'kyc_documents', app_role);
  END IF;
END $$;
