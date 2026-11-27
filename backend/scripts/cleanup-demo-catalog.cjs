#!/usr/bin/env node
'use strict';

/**
 * Jonli/staging katalogdagi isbotlangan demo yozuvlarni xavfsiz tahlil qilish (--dry-run)
 * va zaxira nusxa yaratgandan keyin tozalash (--apply) skripti.
 *
 * Qoidalar:
 *  - Sukut bo'yicha faqat --dry-run (DB ga o'zgartirish kiritmaydi).
 *  - Sarlavha, sana yoki 0 taklif asosida hech narsani demo deb o'chirmaydi:
 *    yaratuvchi hisob + aniq seed imzosi birga tekshiriladi.
 *  - Ariza, shartnoma, taklif yoki moliyaviy yozuvi bor obyektlarning tarixi saqlanadi.
 *  - --apply da o'zgartirishdan oldin JSON zaxira fayli yoziladi va tranzaksiyada
 *    tasdiqlangan demo ishlar o'chiriladi, demo xizmatlar ARCHIVED qilinadi.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, ServiceStatus, SellerStatus } = require('@prisma/client');
const {
  classifyDemoJob,
  classifyDemoService,
  classifyDemoSeller,
  getSeedJobSignatures,
} = require('./lib/seed-safety.cjs');

function serializeSafe(obj) {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
}

async function run() {
  const apply = process.argv.includes('--apply');
  const backupArg = process.argv.find((a) => a.startsWith('--backup-dir='));
  const backupDir = backupArg
    ? path.resolve(backupArg.slice('--backup-dir='.length))
    : path.resolve(__dirname, '../../scratch/backups');

  const prisma = new PrismaClient();
  const seedSignatures = getSeedJobSignatures();

  try {
    const [jobs, services, sellers] = await Promise.all([
      prisma.job.findMany({
        include: {
          buyer: { select: { id: true, phone: true, fullName: true } },
          _count: { select: { proposals: true, contracts: true } },
        },
      }),
      prisma.service.findMany({
        include: {
          seller: { select: { id: true, phone: true, fullName: true } },
          _count: { select: { contracts: true } },
        },
      }),
      prisma.user.findMany({
        where: { sellerStatus: { not: SellerStatus.NONE } },
        select: {
          id: true,
          phone: true,
          fullName: true,
          sellerStatus: true,
          _count: {
            select: {
              contractsAsSeller: true,
              jobProposals: true,
              payouts: true,
              ledgerAccounts: true,
            },
          },
        },
      }),
    ]);

    const jobBuckets = { PROVEN_DEMO: [], PROTECTED_WITH_HISTORY: [], UNKNOWN: [], REAL: [] };
    for (const j of jobs) {
      const cls = classifyDemoJob(
        {
          buyerId: j.buyerId,
          buyerPhone: j.buyer.phone,
          title: j.title,
          description: j.description,
          attachedImagesCount: j.attachedImages.length,
          proposalsCount: j._count.proposals,
          contractsCount: j._count.contracts,
        },
        seedSignatures,
      );
      jobBuckets[cls].push(j);
    }

    const serviceBuckets = { PROVEN_DEMO: [], PROTECTED_WITH_HISTORY: [], UNKNOWN: [], REAL: [] };
    const sellerIdsWithNonSeedServices = new Set();
    for (const s of services) {
      const cls = classifyDemoService({
        id: s.id,
        sellerId: s.sellerId,
        sellerPhone: s.seller.phone,
        title: s.title,
        contractsCount: s._count.contracts,
        offersCount: 0,
      });
      if (cls === 'REAL' || cls === 'UNKNOWN') {
        sellerIdsWithNonSeedServices.add(s.sellerId);
      }
      serviceBuckets[cls].push(s);
    }

    const sellerBuckets = { PROVEN_DEMO: [], PROTECTED_WITH_HISTORY: [], UNKNOWN: [], REAL: [] };
    for (const sp of sellers) {
      const cls = classifyDemoSeller({
        userId: sp.id,
        phone: sp.phone,
        contractsCount: sp._count.contractsAsSeller,
        proposalsCount: sp._count.jobProposals,
        payoutsCount: sp._count.payouts,
        ledgerEntriesCount: sp._count.ledgerAccounts,
        hasNonSeedService: sellerIdsWithNonSeedServices.has(sp.id),
      });
      sellerBuckets[cls].push(sp);
    }

    const report = {
      mode: apply ? 'APPLY' : 'DRY_RUN',
      jobs: {
        total: jobs.length,
        provenDemo: jobBuckets.PROVEN_DEMO.length,
        protectedWithHistory: jobBuckets.PROTECTED_WITH_HISTORY.length,
        unknown: jobBuckets.UNKNOWN.length,
        real: jobBuckets.REAL.length,
      },
      services: {
        total: services.length,
        provenDemo: serviceBuckets.PROVEN_DEMO.length,
        protectedWithHistory: serviceBuckets.PROTECTED_WITH_HISTORY.length,
        unknown: serviceBuckets.UNKNOWN.length,
        real: serviceBuckets.REAL.length,
      },
      specialists: {
        total: sellers.length,
        provenDemo: sellerBuckets.PROVEN_DEMO.length,
        protectedWithHistory: sellerBuckets.PROTECTED_WITH_HISTORY.length,
        unknown: sellerBuckets.UNKNOWN.length,
        real: sellerBuckets.REAL.length,
      },
    };

    console.log(JSON.stringify(report, null, 2));

    if (!apply) {
      console.log('Dry-run yakunlandi. Hech qanday ma’lumot o‘zgartirilmadi.');
      return;
    }

    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `bozor-demo-backup-${ts}.json`);
    fs.writeFileSync(
      backupPath,
      serializeSafe({
        createdAt: new Date().toISOString(),
        report,
        jobs: jobBuckets.PROVEN_DEMO,
        services: serviceBuckets.PROVEN_DEMO,
        specialists: sellerBuckets.PROVEN_DEMO,
      }),
      { mode: 0o600 },
    );
    console.log(`Zaxira nusxa yozildi: ${backupPath}`);

    const demoJobIds = jobBuckets.PROVEN_DEMO.map((j) => j.id);
    const demoServiceIds = serviceBuckets.PROVEN_DEMO
      .filter((s) => s.status !== ServiceStatus.ARCHIVED)
      .map((s) => s.id);
    const demoSellerUserIds = sellerBuckets.PROVEN_DEMO.map((sp) => sp.id);

    const result = await prisma.$transaction(async (tx) => {
      const deletedJobs = demoJobIds.length
        ? await tx.job.deleteMany({
            where: {
              id: { in: demoJobIds },
              proposals: { none: {} },
              contracts: { none: {} },
            },
          })
        : { count: 0 };

      const archivedServices = demoServiceIds.length
        ? await tx.service.updateMany({
            where: { id: { in: demoServiceIds } },
            data: { status: ServiceStatus.ARCHIVED },
          })
        : { count: 0 };

      const suspendedDemoSellers = demoSellerUserIds.length
        ? await tx.user.updateMany({
            where: {
              id: { in: demoSellerUserIds },
              sellerStatus: { not: SellerStatus.SUSPENDED },
            },
            data: { sellerStatus: SellerStatus.SUSPENDED },
          })
        : { count: 0 };

      return { deletedJobs, archivedServices, suspendedDemoSellers };
    });

    console.log('Tozalash yakunlandi:', JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error('Demo katalog tozalash xatosi:', err);
  process.exit(1);
});
