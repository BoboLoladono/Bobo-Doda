-- Additive only: legacy Redis proposals require an explicit reviewed import.
CREATE TABLE "job_proposals" (
  "id" TEXT NOT NULL,
  "jobId" UUID NOT NULL,
  "sellerId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'korib_chiqilmoqda',
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "job_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_proposals_status_check" CHECK ("status" IN ('korib_chiqilmoqda', 'qaytarib_olingan', 'yollandi', 'rad_etilgan')),
  CONSTRAINT "job_proposals_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "job_proposals_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "job_proposals_jobId_sellerId_key" ON "job_proposals"("jobId", "sellerId");
CREATE INDEX "job_proposals_sellerId_createdAt_idx" ON "job_proposals"("sellerId", "createdAt");
