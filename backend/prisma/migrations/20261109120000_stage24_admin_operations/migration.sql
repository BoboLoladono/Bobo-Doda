-- 1. Create Enums
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'WAITING_USER', 'ANSWERED', 'CLOSED');
CREATE TYPE "TrustReportTargetType" AS ENUM ('USER', 'SERVICE', 'JOB', 'MESSAGE');
CREATE TYPE "TrustReportReasonType" AS ENUM ('SCAM', 'SPAM', 'PLAGIARISM', 'OFF_PLATFORM', 'INAPPROPRIATE', 'FAKE_PROFILE', 'COPYRIGHT');
CREATE TYPE "TrustReportSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "TrustReportStatus" AS ENUM ('NEW', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');
CREATE TYPE "TrustReportActionTaken" AS ENUM ('NONE', 'WARNED', 'RESTRICTED', 'SUSPENDED', 'REMOVED');
CREATE TYPE "UserAppealRestrictionType" AS ENUM ('SUSPENDED', 'BLOCKED', 'RESTRICTED');
CREATE TYPE "UserAppealStatus" AS ENUM ('PENDING', 'REVIEWING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "ReviewStatus" AS ENUM ('APPROVED', 'FLAGGED', 'HIDDEN');

-- 2. Create support_tickets table
CREATE TABLE "support_tickets" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "contactName" TEXT,
  "contactInfo" TEXT,
  "topic" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "closedAt" TIMESTAMPTZ(6),
  "closedByStaffId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "support_tickets_userId_status_idx" ON "support_tickets"("userId", "status");
CREATE INDEX "support_tickets_status_createdAt_idx" ON "support_tickets"("status", "createdAt");

-- 3. Create ticket_messages table
CREATE TABLE "ticket_messages" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "senderId" UUID,
  "senderName" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- 4. Create trust_reports table
CREATE TABLE "trust_reports" (
  "id" UUID NOT NULL,
  "reporterId" UUID NOT NULL,
  "targetType" "TrustReportTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetTitle" TEXT NOT NULL,
  "reasonType" "TrustReportReasonType" NOT NULL,
  "description" TEXT NOT NULL,
  "evidenceUrl" TEXT,
  "severity" "TrustReportSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "TrustReportStatus" NOT NULL DEFAULT 'NEW',
  "assignedAdminId" UUID,
  "assignedAdminName" TEXT,
  "resolutionNote" TEXT,
  "actionTaken" "TrustReportActionTaken" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(6),
  CONSTRAINT "trust_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trust_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "trust_reports_status_createdAt_idx" ON "trust_reports"("status", "createdAt");
CREATE INDEX "trust_reports_reporterId_idx" ON "trust_reports"("reporterId");
CREATE INDEX "trust_reports_targetId_idx" ON "trust_reports"("targetId");

-- 5. Create user_appeals table
CREATE TABLE "user_appeals" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "restrictionType" "UserAppealRestrictionType" NOT NULL,
  "originalReason" TEXT NOT NULL,
  "appealText" TEXT NOT NULL,
  "evidenceUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "UserAppealStatus" NOT NULL DEFAULT 'PENDING',
  "reviewerId" UUID,
  "reviewerName" TEXT,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(6),
  CONSTRAINT "user_appeals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_appeals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_appeals_userId_status_idx" ON "user_appeals"("userId", "status");
CREATE INDEX "user_appeals_status_createdAt_idx" ON "user_appeals"("status", "createdAt");

-- 6. Create reviews table
CREATE TABLE "reviews" (
  "id" UUID NOT NULL,
  "contractId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "targetId" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
  "reportCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_contractId_key" UNIQUE ("contractId"),
  CONSTRAINT "reviews_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reviews_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "reviews_targetId_status_idx" ON "reviews"("targetId", "status");
CREATE INDEX "reviews_authorId_idx" ON "reviews"("authorId");

-- 7. Grant permissions to app role
DO $$
DECLARE
  app_role text := COALESCE(NULLIF(current_setting('bobololadono.app_role', true), ''), 'bobololadono_app');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'support_tickets', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'ticket_messages', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'trust_reports', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'user_appeals', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', 'reviews', app_role);
  END IF;
END $$;
