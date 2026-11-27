'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const SEED_BUYER_IDS = new Set([
  '01a11b3f-a77a-75ce-96f0-e72f7a8b8c10',
  '01a11b3f-a785-7299-aa57-2a9bcb3c02b3',
  '01a11b3f-a78c-727c-a571-074ef591e281',
  '01a0ec88-4380-71dc-8c51-49396deba6ec',
  '01a0ec88-46e2-75cf-8f4a-b651e29da807',
  '01a0ec88-4974-7f5c-9688-fe31d97369c0',
  '01a0ec88-4be4-7446-bf16-ec2dff6be19e',
  '01a0ec88-510d-7e08-90fd-374409354d8c',
  '01a1e4d2-c9ca-768f-a41c-41688948e7f3',
]);

const SEED_BUYER_PHONES = new Set([
  '+998901110001',
  '+998901110002',
  '+998901110003',
]);

const SEED_SELLER_IDS = new Set([
  '01a11b3f-a793-716b-912b-33fa9c686306',
  '01a11b3f-a7ae-7304-92ff-498cdc5506c9',
  '01a11b3f-a7c1-7d79-beba-d29bd8bd05cd',
]);

const SEED_SELLER_PHONES = new Set([
  '+998901110004',
  '+998901110005',
  '+998901110006',
  '+998901110010',
]);

const KNOWN_TEST_SERVICE_IDS = new Set([
  '01a14e25-700d-72de-ac13-1117147e475f', // Payme Test Xizmati — 1 000 so'm
  '01a11b3f-a7a2-770a-9fdb-541953416ba5',
  '01a11b3f-a7bc-78bf-93e9-b97d40e57648',
  '01a11b3f-a7cb-7c77-a742-b3e779991537',
]);

const KNOWN_SEED_SERVICE_TITLES = new Set([
  "Payme Test Xizmati — 1 000 so'm",
  'Full-Stack Web Dasturlash va API ishlab chiqish',
  'Mobil Ilova va Veb-sayt uchun Zamonaviy UI/UX Dizayn',
  "To'liq Target Reklama va Ijtimoiy Tarmoqlarda SMM Boshqaruvi",
  'Zamonaviy UI/UX Dizayn va Prototip tayyorlash',
  'To‘liq Target Reklama va Ijtimoiy Tarmoqlarda SMM Boshqaruvi',
]);

function assertNonProductionSeedAllowed(scriptName) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`[${scriptName}] Production muhitida (NODE_ENV=production) demo seed taqiqlangan.`);
  }
  if (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL_ENV === 'production') {
    throw new Error(`[${scriptName}] Hosting muhitida demo seed ishlatish taqiqlangan.`);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    let host = '';
    try {
      host = new URL(dbUrl.replace(/^postgresql:/i, 'http:')).hostname;
    } catch {
      throw new Error(`[${scriptName}] DATABASE_URL formati noto'g'ri — seed to'xtatildi.`);
    }
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `[${scriptName}] Masofaviy DB (${host}) ga demo seed yozish taqiqlangan — faqat loopback ruxsat etiladi.`,
      );
    }
  }
}

let cachedSeedJobPairs = null;

function getSeedJobSignatures() {
  if (cachedSeedJobPairs) return cachedSeedJobPairs;
  const seedFile = path.resolve(__dirname, '../seed-100-jobs.js');
  const src = fs.readFileSync(seedFile, 'utf8');
  const match = src.match(/const RAW_JOBS = (\[[\s\S]*?\n\]);/);
  if (!match) {
    throw new Error('seed-100-jobs.js ichidan RAW_JOBS ro‘yxati o‘qilmadi');
  }
  const rawJobs = Function(`"use strict"; return (${match[1]});`)();
  cachedSeedJobPairs = new Map(
    rawJobs.map((j) => [`${j.title}\u0000${j.description}`, j]),
  );
  return cachedSeedJobPairs;
}

/**
 * Qat'iy dalillar asosida e'lonni tasniflaydi (title/sana/0-taklifning o'zi yetarli emas):
 *  - PROVEN_DEMO: yaratuvchi (seed buyerId/phone) + aniq seed matn + bog'langan tarix yo'q
 *  - PROTECTED_WITH_HISTORY: seed yaratuvchi va/yoki matn mos keladi, lekin ariza/shartnoma mavjud
 *  - UNKNOWN: qisman signal (masalan real hisobda seed sarlavhasi yoki seed hisobda boshqa matn)
 *  - REAL: seed hisobi va seed matniga kirmaydigan haqiqiy e'lon
 */
function classifyDemoJob(job, seedSignatures = getSeedJobSignatures()) {
  const isSeedCreator =
    SEED_BUYER_IDS.has(job.buyerId) ||
    Boolean(job.buyerPhone && SEED_BUYER_PHONES.has(job.buyerPhone));
  const matchesSeedPayload = seedSignatures.has(`${job.title}\u0000${job.description}`);
  const hasHistory =
    (job.proposalsCount || 0) > 0 ||
    (job.contractsCount || 0) > 0 ||
    (job.offersCount || 0) > 0;

  if (isSeedCreator && matchesSeedPayload && (job.attachedImagesCount || 0) === 0) {
    return hasHistory ? 'PROTECTED_WITH_HISTORY' : 'PROVEN_DEMO';
  }
  if (isSeedCreator || matchesSeedPayload) {
    return 'UNKNOWN';
  }
  return 'REAL';
}

function classifyDemoService(service) {
  const isSeedCreator =
    SEED_SELLER_IDS.has(service.sellerId) ||
    Boolean(service.sellerPhone && SEED_SELLER_PHONES.has(service.sellerPhone));
  const matchesKnownService =
    KNOWN_TEST_SERVICE_IDS.has(service.id) ||
    KNOWN_SEED_SERVICE_TITLES.has(service.title);
  const hasHistory =
    (service.contractsCount || 0) > 0 ||
    (service.offersCount || 0) > 0;

  if (isSeedCreator && matchesKnownService) {
    return hasHistory ? 'PROTECTED_WITH_HISTORY' : 'PROVEN_DEMO';
  }
  if (isSeedCreator || matchesKnownService) {
    return 'UNKNOWN';
  }
  return 'REAL';
}

function classifyDemoSeller(seller) {
  const isSeedCreator =
    SEED_SELLER_IDS.has(seller.userId) ||
    Boolean(seller.phone && SEED_SELLER_PHONES.has(seller.phone));
  if (!isSeedCreator) {
    return 'REAL';
  }
  const hasHistory =
    (seller.contractsCount || 0) > 0 ||
    (seller.proposalsCount || 0) > 0 ||
    (seller.payoutsCount || 0) > 0 ||
    (seller.ledgerEntriesCount || 0) > 0;
  if (hasHistory) {
    return 'PROTECTED_WITH_HISTORY';
  }
  if (seller.hasNonSeedService) {
    return 'UNKNOWN';
  }
  return 'PROVEN_DEMO';
}

module.exports = {
  SEED_BUYER_IDS,
  SEED_BUYER_PHONES,
  SEED_SELLER_IDS,
  SEED_SELLER_PHONES,
  KNOWN_TEST_SERVICE_IDS,
  KNOWN_SEED_SERVICE_TITLES,
  assertNonProductionSeedAllowed,
  getSeedJobSignatures,
  classifyDemoJob,
  classifyDemoService,
  classifyDemoSeller,
};
