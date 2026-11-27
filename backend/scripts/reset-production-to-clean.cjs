#!/usr/bin/env node
'use strict';

/**
 * Production'ni birinchi haqiqiy foydalanuvchi uchun toza holatga keltirish skripti.
 *
 * Kafolatlar:
 *  - Sukut bo'yicha `--dry-run` (faqat boshlang'ich sonlar + real bank o'tkazmalari tekshiruvi).
 *  - `--apply --confirm-full-test-wipe` berilganda:
 *      1) REGISTRATION_PAUSED=true tekshiradi (yoki --allow-without-pause).
 *      2) O'zgartirishdan oldin barcha marketplace jadvallari JSON zaxirasini yozadi.
 *      3) Bankda haqiqatan bajarilgan o'tkazmasi bor obyektlarni (APPROVED BankTransferProof
 *         yoki SUCCEEDED/bankOperationRef li Payout/Payment) aniqlab saqlaydi (`preservedRealBankTransfer`).
 *      4) Qolgan barcha test foydalanuvchilarini (`users`: xaridorlar, mutaxassislar, SAIDKARIM),
 *         profillar, ishlar, xizmatlar, takliflar, shartnomalar, chat/support xabarlari, fayllar,
 *         balans/ledger, test to'lovlari va barcha eski sessiyalarni (`refresh_tokens`) tozalaydi.
 *      5) Texnik administratorlar (`staff_members`, `staff_sessions`), `audit_logs`, `categories`
 *         va `_prisma_migrations` jadvalini SAQLAB QOLADI.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

function serializeSafe(obj) {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
}

async function collectCounts(prisma) {
  const [
    users,
    refreshTokens,
    otpCodes,
    authGrants,
    smsLogs,
    sellerApplications,
    services,
    jobs,
    jobProposals,
    contracts,
    milestones,
    milestoneSubmissions,
    milestoneRevisionRequests,
    payments,
    paymeTransactions,
    bankTransferProofs,
    payouts,
    payoutCorrections,
    sellerPayoutDestinations,
    refunds,
    ledgerAccounts,
    ledgerTransactions,
    ledgerEntries,
    disputes,
    reviews,
    supportTickets,
    ticketMessages,
    trustReports,
    userAppeals,
    kycVerifications,
    kycDocuments,
    uploadedFiles,
    outboxEvents,
    idempotencyKeys,
    categories,
    staffMembers,
    staffSessions,
    auditLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.refreshToken.count(),
    prisma.otpCode.count(),
    prisma.authGrant.count(),
    prisma.smsLog.count(),
    prisma.sellerApplication.count(),
    prisma.service.count(),
    prisma.job.count(),
    prisma.jobProposal.count(),
    prisma.contract.count(),
    prisma.milestone.count(),
    prisma.milestoneSubmission.count(),
    prisma.milestoneRevisionRequest.count(),
    prisma.payment.count(),
    prisma.paymeTransaction.count(),
    prisma.bankTransferProof.count(),
    prisma.payout.count(),
    prisma.payoutCorrection.count(),
    prisma.sellerPayoutDestination.count(),
    prisma.refund.count(),
    prisma.ledgerAccount.count(),
    prisma.ledgerTransaction.count(),
    prisma.ledgerEntry.count(),
    prisma.dispute.count(),
    prisma.review.count(),
    prisma.supportTicket.count(),
    prisma.ticketMessage.count(),
    prisma.trustReport.count(),
    prisma.userAppeal.count(),
    prisma.kycVerification.count(),
    prisma.kycDocument.count(),
    prisma.uploadedFile.count(),
    prisma.outboxEvent.count(),
    prisma.idempotencyKey.count(),
    prisma.category.count(),
    prisma.staffMember.count(),
    prisma.staffSession.count(),
    prisma.auditLog.count(),
  ]);

  return {
    users,
    refreshTokens,
    otpCodes,
    authGrants,
    smsLogs,
    sellerApplications,
    services,
    jobs,
    jobProposals,
    contracts,
    milestones,
    milestoneSubmissions,
    milestoneRevisionRequests,
    payments,
    paymeTransactions,
    bankTransferProofs,
    payouts,
    payoutCorrections,
    sellerPayoutDestinations,
    refunds,
    ledgerAccounts,
    ledgerTransactions,
    ledgerEntries,
    disputes,
    reviews,
    supportTickets,
    ticketMessages,
    trustReports,
    userAppeals,
    kycVerifications,
    kycDocuments,
    uploadedFiles,
    outboxEvents,
    idempotencyKeys,
    preservedSystemTables: {
      categories,
      staffMembers,
      staffSessions,
      auditLogs,
    },
  };
}

async function findVerifiedRealBankTransfers(prisma) {
  const [approvedProofs, realPayouts, realPaymePayments] = await Promise.all([
    prisma.bankTransferProof.findMany({
      where: {
        status: 'APPROVED',
        bankOperationRef: { not: null },
      },
      select: {
        id: true,
        contractId: true,
        buyerId: true,
        paymentId: true,
        receivedAmount: true,
        bankOperationRef: true,
        contract: { select: { sellerId: true, jobId: true, serviceId: true } },
      },
    }),
    prisma.payout.findMany({
      where: {
        provider: { not: 'TEST' },
        OR: [{ status: 'SUCCEEDED' }, { bankOperationRef: { not: null } }],
      },
      select: {
        id: true,
        sellerId: true,
        amount: true,
        provider: true,
        status: true,
        bankOperationRef: true,
        destinationId: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        provider: 'PAYME',
        status: 'SUCCEEDED',
      },
      select: {
        id: true,
        contractId: true,
        payerUserId: true,
        amount: true,
        providerPaymentId: true,
        contract: { select: { sellerId: true, jobId: true, serviceId: true } },
      },
    }),
  ]);

  const preservedContractIds = new Set();
  const preservedUserIds = new Set();
  const preservedJobIds = new Set();
  const preservedServiceIds = new Set();
  const preservedDestinationIds = new Set();

  for (const p of approvedProofs) {
    preservedContractIds.add(p.contractId);
    preservedUserIds.add(p.buyerId);
    if (p.contract?.sellerId) preservedUserIds.add(p.contract.sellerId);
    if (p.contract?.jobId) preservedJobIds.add(p.contract.jobId);
    if (p.contract?.serviceId) preservedServiceIds.add(p.contract.serviceId);
  }
  for (const po of realPayouts) {
    preservedUserIds.add(po.sellerId);
    if (po.destinationId) preservedDestinationIds.add(po.destinationId);
  }
  for (const pm of realPaymePayments) {
    preservedContractIds.add(pm.contractId);
    preservedUserIds.add(pm.payerUserId);
    if (pm.contract?.sellerId) preservedUserIds.add(pm.contract.sellerId);
    if (pm.contract?.jobId) preservedJobIds.add(pm.contract.jobId);
    if (pm.contract?.serviceId) preservedServiceIds.add(pm.contract.serviceId);
  }

  return {
    approvedBankProofs: approvedProofs,
    realPayouts,
    realPaymePayments,
    preservedContractIds: Array.from(preservedContractIds),
    preservedUserIds: Array.from(preservedUserIds),
    preservedJobIds: Array.from(preservedJobIds),
    preservedServiceIds: Array.from(preservedServiceIds),
    preservedDestinationIds: Array.from(preservedDestinationIds),
  };
}

async function run() {
  const apply = process.argv.includes('--apply');
  const confirmWipe = process.argv.includes('--confirm-full-test-wipe');
  const allowWithoutPause = process.argv.includes('--allow-without-pause');
  const backupArg = process.argv.find((a) => a.startsWith('--backup-dir='));
  const backupDir = backupArg
    ? path.resolve(backupArg.slice('--backup-dir='.length))
    : path.resolve(__dirname, '../../scratch/backups');

  const prisma = new PrismaClient();
  try {
    const baselineCounts = await collectCounts(prisma);
    const preserved = await findVerifiedRealBankTransfers(prisma);

    const preview = {
      mode: apply ? 'APPLY' : 'DRY_RUN',
      registrationPausedEnv: process.env.REGISTRATION_PAUSED === 'true',
      baselineCounts,
      preservedRealBankHistory: {
        approvedBankProofsCount: preserved.approvedBankProofs.length,
        realPayoutsCount: preserved.realPayouts.length,
        realPaymePaymentsCount: preserved.realPaymePayments.length,
        preservedContractIds: preserved.preservedContractIds,
        preservedUserIds: preserved.preservedUserIds,
        records: {
          approvedBankProofs: preserved.approvedBankProofs,
          realPayouts: preserved.realPayouts,
          realPaymePayments: preserved.realPaymePayments,
        },
      },
    };

    if (!apply) {
      console.log(serializeSafe(preview));
      console.log('Dry-run yakunlandi. Bazaga hech qanday o‘zgartirish kiritilmadi.');
      return;
    }

    if (!confirmWipe) {
      throw new Error('Tozalashni bajarish uchun --apply bilan birga --confirm-full-test-wipe ham ko‘rsatilishi shart.');
    }
    if (process.env.REGISTRATION_PAUSED !== 'true' && !allowWithoutPause) {
      throw new Error(
        'Xavfsizlik: avval REGISTRATION_PAUSED=true qilib ro‘yxatdan o‘tishni to‘xtating (yoki --allow-without-pause bering).',
      );
    }

    const [usersSnapshot, jobsSnapshot, servicesSnapshot, contractsSnapshot, filesSnapshot] =
      await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            phone: true,
            fullName: true,
            email: true,
            roles: true,
            sellerStatus: true,
            createdAt: true,
          },
        }),
        prisma.job.findMany(),
        prisma.service.findMany(),
        prisma.contract.findMany(),
        prisma.uploadedFile.findMany(),
      ]);

    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `prod-clean-reset-backup-${ts}.json`);
    fs.writeFileSync(
      backupPath,
      serializeSafe({
        createdAt: new Date().toISOString(),
        preview,
        snapshots: {
          users: usersSnapshot,
          jobs: jobsSnapshot,
          services: servicesSnapshot,
          contracts: contractsSnapshot,
          uploadedFiles: filesSnapshot,
        },
      }),
      { mode: 0o600 },
    );

    const pContracts = preserved.preservedContractIds;
    const pUsers = preserved.preservedUserIds;
    const pJobs = preserved.preservedJobIds;
    const pServices = preserved.preservedServiceIds;
    const pDestIds = preserved.preservedDestinationIds;

    const filesToRemove = filesSnapshot.filter(
      (f) => !f.contractId || !pContracts.includes(f.contractId),
    );

    await prisma.$transaction(async (tx) => {
      // 1. Barcha marketplace foydalanuvchi sessiyalari va OTP/grantlar bekor qilinadi
      await tx.refreshToken.deleteMany({});
      await tx.authGrant.deleteMany({});
      await tx.otpCode.deleteMany({});
      await tx.smsLog.deleteMany({});
      await tx.idempotencyKey.deleteMany({});
      await tx.outboxDeliveryAttempt.deleteMany({});
      await tx.outboxEvent.deleteMany({});

      // 2. Saqlanadigan real bank shartnomalariga tegishli bo'lmagan yuklamalar, chat va arizalar
      await tx.uploadedFile.deleteMany({
        where: pContracts.length ? { OR: [{ contractId: null }, { contractId: { notIn: pContracts } }] } : {},
      });
      await tx.ticketMessage.deleteMany({});
      await tx.supportTicket.deleteMany({});
      await tx.trustReport.deleteMany({});
      await tx.userAppeal.deleteMany({});
      await tx.kycDocument.deleteMany({});
      await tx.kycVerification.deleteMany({});
      await tx.sellerApplication.deleteMany({
        where: pUsers.length ? { userId: { notIn: pUsers } } : {},
      });

      // 3. Moliyaviy / shartnoma yozuvlari (real bank tarixidan tashqari)
      await tx.disputeEvent.deleteMany({
        where: pContracts.length ? { dispute: { contractId: { notIn: pContracts } } } : {},
      });
      await tx.disputeEvidence.deleteMany({
        where: pContracts.length ? { dispute: { contractId: { notIn: pContracts } } } : {},
      });
      await tx.dispute.deleteMany({
        where: pContracts.length ? { contractId: { notIn: pContracts } } : {},
      });
      await tx.review.deleteMany({
        where: pContracts.length ? { contractId: { notIn: pContracts } } : {},
      });

      await tx.milestoneRevisionRequest.deleteMany({
        where: pContracts.length ? { milestone: { contractId: { notIn: pContracts } } } : {},
      });
      await tx.milestoneSubmission.deleteMany({
        where: pContracts.length ? { milestone: { contractId: { notIn: pContracts } } } : {},
      });
      await tx.milestone.deleteMany({
        where: pContracts.length ? { contractId: { notIn: pContracts } } : {},
      });

      await tx.bankTransferProof.deleteMany({
        where: pContracts.length ? { contractId: { notIn: pContracts } } : {},
      });
      await tx.paymeTransaction.deleteMany({
        where: pContracts.length ? { payment: { contractId: { notIn: pContracts } } } : {},
      });
      await tx.refundProviderEvent.deleteMany({});
      await tx.refund.deleteMany({
        where: pContracts.length ? { contractId: { notIn: pContracts } } : {},
      });
      await tx.paymentProviderEvent.deleteMany({});
      await tx.payment.deleteMany({
        where: pContracts.length ? { contractId: { notIn: pContracts } } : {},
      });

      await tx.payoutCorrection.deleteMany({
        where: pUsers.length ? { payout: { sellerId: { notIn: pUsers } } } : {},
      });
      await tx.payoutProviderEvent.deleteMany({});
      await tx.payout.deleteMany({
        where: pUsers.length ? { sellerId: { notIn: pUsers } } : {},
      });
      await tx.sellerPayoutDestination.deleteMany({
        where: pDestIds.length ? { id: { notIn: pDestIds } } : {},
      });

      if (pUsers.length === 0 && pContracts.length === 0) {
        await tx.ledgerEntry.deleteMany({});
        await tx.ledgerTransaction.deleteMany({});
        await tx.ledgerAccount.deleteMany({});
      } else {
        const accountsToDrop = await tx.ledgerAccount.findMany({
          where: {
            AND: [
              { ownerType: 'USER' },
              { ownerId: { notIn: pUsers } },
            ],
          },
          select: { id: true },
        });
        const dropAccIds = accountsToDrop.map((a) => a.id);
        if (dropAccIds.length) {
          await tx.ledgerEntry.deleteMany({ where: { accountId: { in: dropAccIds } } });
          await tx.ledgerAccount.deleteMany({ where: { id: { in: dropAccIds } } });
        }
      }

      // 4. Shartnomalar, takliflar, ishlar, xizmatlar va marketplace foydalanuvchilari
      await tx.contract.deleteMany({
        where: pContracts.length ? { id: { notIn: pContracts } } : {},
      });
      await tx.jobProposal.deleteMany({
        where: pJobs.length ? { jobId: { notIn: pJobs } } : {},
      });
      await tx.job.deleteMany({
        where: pJobs.length ? { id: { notIn: pJobs } } : {},
      });
      if (pJobs.length) {
        await tx.job.updateMany({
          where: { id: { in: pJobs }, status: 'OPEN' },
          data: { status: 'CLOSED' },
        });
      }
      await tx.service.deleteMany({
        where: pServices.length ? { id: { notIn: pServices } } : {},
      });
      if (pServices.length) {
        await tx.service.updateMany({
          where: { id: { in: pServices }, status: { not: 'ARCHIVED' } },
          data: { status: 'ARCHIVED' },
        });
      }
      await tx.user.deleteMany({
        where: pUsers.length ? { id: { notIn: pUsers } } : {},
      });
    });

    // 5. Faqat tozalangan yozuvlarga tegishli lokal yuklama fayllarini diskdan o'chirish
    const uploadDir = process.env.UPLOAD_DIR?.trim() || path.resolve(__dirname, '../../uploads');
    let diskDeleted = 0;
    for (const f of filesToRemove) {
      const target = path.resolve(uploadDir, f.storedName);
      if (target.startsWith(`${path.resolve(uploadDir)}${path.sep}`)) {
        try {
          fs.unlinkSync(target);
          diskDeleted += 1;
        } catch {
          // Fayl diskda mavjud bo'lmasa o'tkazib yuboriladi
        }
      }
    }

    const afterCounts = await collectCounts(prisma);
    console.log(
      serializeSafe({
        backupPath,
        diskDeleted,
        before: baselineCounts,
        after: afterCounts,
        preservedRealBankHistory: preview.preservedRealBankHistory,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { findVerifiedRealBankTransfers, collectCounts };

if (require.main === module) {
  run().catch((err) => {
    console.error('Production reset xatosi:', err);
    process.exit(1);
  });
}
