-- First Release: contract pre-confirmation snapshots, single-active-contract-per-job guard,
-- manual bank inflow verification tracking, verified seller payout destinations, and payout corrections.

CREATE TYPE "BankTransferProofStatus" AS ENUM (
  'PENDING_REVIEW',
  'UNDERPAID',
  'OVERPAID_REVIEW',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "PayoutDestinationType" AS ENUM (
  'BANK_CARD',
  'BANK_ACCOUNT'
);

ALTER TABLE "contracts"
  ADD COLUMN "deliverableSummary" TEXT,
  ADD COLUMN "acceptanceCriteria" TEXT,
  ADD COLUMN "revisionsIncluded" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "buyerConfirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN "sellerConfirmedAt" TIMESTAMPTZ(6);

UPDATE "contracts"
SET
  "buyerConfirmedAt" = COALESCE("buyerConfirmedAt", "createdAt"),
  "sellerConfirmedAt" = CASE
    WHEN "status" IN ('ACTIVE', 'COMPLETED') THEN COALESCE("sellerConfirmedAt", "updatedAt")
    ELSE "sellerConfirmedAt"
  END;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_revisionsIncluded_check"
  CHECK ("revisionsIncluded" >= 0 AND "revisionsIncluded" <= 20);

CREATE UNIQUE INDEX "contracts_jobId_active_unique"
  ON "contracts"("jobId")
  WHERE "jobId" IS NOT NULL AND "status" IN ('PENDING_SELLER', 'ACTIVE', 'COMPLETED');

CREATE TABLE "bank_transfer_proofs" (
  "id" UUID NOT NULL,
  "contractId" UUID NOT NULL,
  "paymentId" UUID,
  "buyerId" UUID NOT NULL,
  "paymentPurposeCode" TEXT NOT NULL,
  "declaredAmount" BIGINT NOT NULL,
  "receivedAmount" BIGINT,
  "mismatchAmount" BIGINT NOT NULL DEFAULT 0,
  "bankOperationRef" TEXT,
  "receiptFileUrl" TEXT,
  "receiptNote" TEXT,
  "status" "BankTransferProofStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "rejectionReason" TEXT,
  "reviewedByStaffId" UUID,
  "reviewedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "bank_transfer_proofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_transfer_proofs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_transfer_proofs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_transfer_proofs_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "bank_transfer_proofs_paymentId_key" ON "bank_transfer_proofs"("paymentId");
CREATE UNIQUE INDEX "bank_transfer_proofs_bankOperationRef_key" ON "bank_transfer_proofs"("bankOperationRef");
CREATE INDEX "bank_transfer_proofs_contractId_createdAt_idx" ON "bank_transfer_proofs"("contractId", "createdAt");
CREATE INDEX "bank_transfer_proofs_status_createdAt_idx" ON "bank_transfer_proofs"("status", "createdAt");
CREATE INDEX "bank_transfer_proofs_buyerId_createdAt_idx" ON "bank_transfer_proofs"("buyerId", "createdAt");

CREATE TABLE "seller_payout_destinations" (
  "id" UUID NOT NULL,
  "sellerId" UUID NOT NULL,
  "type" "PayoutDestinationType" NOT NULL,
  "providerLabel" TEXT NOT NULL,
  "maskedValue" TEXT NOT NULL,
  "holderName" TEXT NOT NULL,
  "bankName" TEXT,
  "mfo" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isVerified" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "seller_payout_destinations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "seller_payout_destinations_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "seller_payout_destinations_sellerId_deletedAt_isDefault_idx"
  ON "seller_payout_destinations"("sellerId", "deletedAt", "isDefault");

ALTER TABLE "payouts"
  ADD COLUMN "destinationId" UUID,
  ADD COLUMN "destinationSnapshot" JSONB,
  ADD COLUMN "bankOperationRef" TEXT,
  ADD COLUMN "bankTransferredAt" TIMESTAMPTZ(6),
  ADD COLUMN "transferredAmount" BIGINT,
  ADD COLUMN "processedByStaffId" UUID,
  ADD CONSTRAINT "payouts_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "seller_payout_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "payouts_bankOperationRef_key" ON "payouts"("bankOperationRef");

CREATE TABLE "payout_corrections" (
  "id" UUID NOT NULL,
  "payoutId" UUID NOT NULL,
  "staffId" UUID NOT NULL,
  "previousBankRef" TEXT,
  "newBankRef" TEXT,
  "previousTransferredAt" TIMESTAMPTZ(6),
  "newTransferredAt" TIMESTAMPTZ(6),
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payout_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_corrections_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "payout_corrections_payoutId_createdAt_idx" ON "payout_corrections"("payoutId", "createdAt");

ALTER TABLE "refunds"
  ADD COLUMN "bankOperationRef" TEXT,
  ADD COLUMN "bankReturnedAt" TIMESTAMPTZ(6),
  ADD COLUMN "processedByStaffId" UUID;

CREATE UNIQUE INDEX "refunds_bankOperationRef_key" ON "refunds"("bankOperationRef");

DO $$
DECLARE
  app_role text := COALESCE(NULLIF(current_setting('bobololadono.app_role', true), ''), 'bobololadono_app');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', 'bank_transfer_proofs', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', 'seller_payout_destinations', app_role);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE %I TO %I', 'payout_corrections', app_role);
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE %I FROM %I', 'payout_corrections', app_role);
  END IF;
END $$;
