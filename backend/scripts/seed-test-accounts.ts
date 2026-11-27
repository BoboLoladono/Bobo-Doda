#!/usr/bin/env node
/**
 * Bobololadono — 9 Ta Rasmiy Test Hisoblarini Yaratish / Upsert Qilish Skripti
 *
 * 1. 3 Xaridor (Buyer):
 *    - +998901110001 (Akmal Ikromov / TechCorp)
 *    - +998901110002 (Nilufar Jalilova / ArtStudio)
 *    - +998901110003 (Sardor Rahmonov / Zamona Logistics)
 * 2. 3 Mutaxassis (Specialist — profileDone: true, bio, skills, services, portfolio):
 *    - +998901110004 (Bekzod Olimov — Full-Stack Web Dasturlash va API)
 *    - +998901110005 (Madina Yoqubova — UI/UX & Mobil Ilova Dizayni)
 *    - +998901110006 (Otabek Mansurov — Target Reklama va SMM)
 * 3. 3 Admin (Boshqaruv):
 *    - superadmin@bobololadono.uz (+998901110007) — Superadmin
 *    - moderator@bobololadono.uz (+998901110008) — Moderator
 *    - finance@bobololadono.uz (+998901110009) — Moliyaviy Nazoratchi
 *
 * Yagona Parol: TestPass2026! (Argon2id)
 * Idempotent: Qayta ishga tushirish xavfsiz (upsert).
 */

import * as argon2 from 'argon2';
import { uuidv7 } from 'uuidv7';
import { assertNonProductionSeedAllowed } from './lib/seed-safety.cjs';
import {
  PrismaClient,
  Role,
  UserStatus,
  SellerStatus,
  SellerApplicationStatus,
  ServiceStatus,
  StaffRole,
  StaffPermission,
  StaffStatus,
} from '@prisma/client';

assertNonProductionSeedAllowed('seed-test-accounts.ts');

const UNIFIED_PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD || 'TestPass2026!';

interface BuyerSpec {
  code: string;
  phone: string;
  fullName: string;
  email: string;
  companyName: string;
  industry: string;
  location: string;
  bio: string;
}

const BUYER_SPECS: BuyerSpec[] = [
  {
    code: 'BUYER-01',
    phone: '+998901110001',
    fullName: 'Akmal Ikromov (TechCorp)',
    email: 'buyer1@bobololadono.uz',
    companyName: 'TechCorp Tashkent MChJ',
    industry: 'Axborot texnologiyalari',
    location: 'Toshkent shahri',
    bio: 'IT, mobil ilovalar va backend tizimlar buyurtmachisi. Tezkor va sifatli ijrochilarni qidiramiz.',
  },
  {
    code: 'BUYER-02',
    phone: '+998901110002',
    fullName: 'Nilufar Jalilova (ArtStudio)',
    email: 'buyer2@bobololadono.uz',
    companyName: 'ArtSoft Studios MCHJ',
    industry: 'Dizayn va Media',
    location: 'Samarqand',
    bio: 'Brending, grafika, video montaj va kontent tayyorlash bo‘yicha loyihalar beruvchi.',
  },
  {
    code: 'BUYER-03',
    phone: '+998901110003',
    fullName: 'Sardor Rahmonov (Zamona Logistics)',
    email: 'buyer3@bobololadono.uz',
    companyName: 'Zamona Logistics MCHJ',
    industry: 'Logistika va Savdo',
    location: 'Buxoro',
    bio: 'Internet do‘konlar, to‘lov tizimlari va CRM integratsiyalari uchun buyurtmalar beruvchi.',
  },
];

interface SpecialistSpec {
  code: string;
  phone: string;
  fullName: string;
  email: string;
  location: string;
  bio: string;
  appLegalName: string;
  appDisplayName: string;
  appDescription: string;
  service: {
    categorySlug: string;
    title: string;
    description: string;
    priceTiyin: bigint;
    deliveryDays: number;
  };
}

const SPECIALIST_SPECS: SpecialistSpec[] = [
  {
    code: 'SPECIALIST-01',
    phone: '+998901110004',
    fullName: 'Bekzod Olimov',
    email: 'specialist1@bobololadono.uz',
    location: 'Toshkent shahri',
    bio: 'Senior Full-stack dasturchi (Node.js, NestJS, Next.js, PostgreSQL). 6+ yillik tijoriy tajriba. Murakkab veb-saytlar va APIlar ishlab chiqaman.',
    appLegalName: 'Bekzod Olimov',
    appDisplayName: 'Bekzod Olimov (Full-Stack)',
    appDescription: 'Senior Full-stack dasturchi (Node.js, NestJS, Next.js, PostgreSQL).',
    service: {
      categorySlug: 'dasturlash',
      title: 'Full-Stack Web Dasturlash va API ishlab chiqish',
      description: 'Sizning biznesingiz uchun yuqori sifatli veb-sayt yoki REST/GraphQL API ishlab chiqaman. Tezkor, xavfsiz va toza arxitektura.',
      priceTiyin: BigInt(500000000), // 5 000 000 UZS
      deliveryDays: 7,
    },
  },
  {
    code: 'SPECIALIST-02',
    phone: '+998901110005',
    fullName: 'Madina Yoqubova',
    email: 'specialist2@bobololadono.uz',
    location: 'Samarqand',
    bio: 'Senior UI/UX dizayner va Art Director. Figma, mobil ilovalar, veb platformalar va brend identikasi dizayni bo‘yicha 5+ yillik tajriba.',
    appLegalName: 'Madina Yoqubova',
    appDisplayName: 'Madina Yoqubova (UI/UX Pro)',
    appDescription: 'Senior UI/UX dizayner va Art Director.',
    service: {
      categorySlug: 'dizayn',
      title: 'Mobil Ilova va Veb-sayt uchun Zamonaviy UI/UX Dizayn',
      description: 'Foydalanuvchilar uchun qulay, konversiyasi yuqori bo‘lgan zamonaviy UI/UX dizayn. Figma komponentlari va to‘liq interaktiv prototip.',
      priceTiyin: BigInt(350000000), // 3 500 000 UZS
      deliveryDays: 5,
    },
  },
  {
    code: 'SPECIALIST-03',
    phone: '+998901110006',
    fullName: 'Otabek Mansurov',
    email: 'specialist3@bobololadono.uz',
    location: 'Farg‘ona',
    bio: 'Raqamli marketing, maqsadli (target) reklama, kontekst reklama va SMM mutaxassisi. Savdo hajmini 3 barobargacha oshirish bo‘yicha keyslar mavjud.',
    appLegalName: 'Otabek Mansurov',
    appDisplayName: 'Otabek Mansurov (Target & SMM)',
    appDescription: 'Raqamli marketing va target reklama mutaxassisi.',
    service: {
      categorySlug: 'marketing',
      title: 'To‘liq Target Reklama va Ijtimoiy Tarmoqlarda SMM Boshqaruvi',
      description: 'Instagram, Facebook va Telegram kanallaringiz uchun professional target reklama sozlash, auditoriyani segmentlash va byudjet optimallashtirish.',
      priceTiyin: BigInt(250000000), // 2 500 000 UZS
      deliveryDays: 10,
    },
  },
];

const ALL_STAFF_PERMISSIONS = Object.values(StaffPermission);

interface AdminSpec {
  code: string;
  email: string;
  aliases?: string[];
  phone: string;
  fullName: string;
  title: string;
  role: StaffRole;
  permissions: StaffPermission[];
  portal: string;
}

const ADMIN_SPECS: AdminSpec[] = [
  {
    code: 'ADMIN-01',
    email: 'superadmin@bobololadono.uz',
    aliases: ['superadmin@bobododa.uz'],
    phone: '+998901110007',
    fullName: 'Boshqaruvchi Superadmin',
    title: 'Chief Platform Super Administrator',
    role: StaffRole.SUPER_ADMIN,
    permissions: ALL_STAFF_PERMISSIONS,
    portal: '/rahbariyat/kirish',
  },
  {
    code: 'ADMIN-02',
    email: 'moderator@bobololadono.uz',
    aliases: ['moderator@bobododa.uz'],
    phone: '+998901110008',
    fullName: 'Moderator Nazoratchi',
    title: 'Bosh Kontent va Foydalanuvchilar Moderatori',
    role: StaffRole.ADMIN,
    permissions: [
      StaffPermission.DASHBOARD,
      StaffPermission.USERS,
      StaffPermission.SERVICES,
      StaffPermission.JOBS,
      StaffPermission.KYC,
      StaffPermission.REPORTS,
      StaffPermission.APPEALS,
      StaffPermission.REVIEWS,
      StaffPermission.SUPPORT,
      StaffPermission.CATEGORIES,
      StaffPermission.AUDIT,
    ],
    portal: '/admin/kirish',
  },
  {
    code: 'ADMIN-03',
    email: 'finance@bobololadono.uz',
    aliases: ['finance@bobododa.uz', 'moliya@bobododa.uz'],
    phone: '+998901110009',
    fullName: 'Moliyaviy Nazoratchi',
    title: 'Moliya va To‘lovlar Nazoratchisi',
    role: StaffRole.ADMIN,
    permissions: [
      StaffPermission.DASHBOARD,
      StaffPermission.ORDERS,
      StaffPermission.DISPUTES,
      StaffPermission.PAYMENTS,
      StaffPermission.REPORTS,
      StaffPermission.AUDIT,
    ],
    portal: '/admin/kirish',
  },
];

export async function seedTestAccounts(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    console.log('==========================================================');
    console.log('🚀 BOBOLOLADONO — 9 TA TEST HISOBI SEED QILINMOQDA');
    console.log('==========================================================');

    console.log('\n[1/4] Argon2id parolini hashlash...');
    const passwordHash = await argon2.hash(UNIFIED_PASSWORD, { type: argon2.argon2id });
    console.log(`✅ Parol muvaffaqiyatli hashlandi: ${UNIFIED_PASSWORD}`);

    // Kategoriya xaritasini olish
    const categories = await prisma.category.findMany();
    const categoryMap = new Map(categories.map((c) => [c.slug, c.id]));

    // ─────────────────────────────────────────────────────────────
    // [2/4] XARIDOR (BUYER) HISOB-LARI
    // ─────────────────────────────────────────────────────────────
    console.log('\n[2/4] Xaridor (Buyer) hisoblarini yaratish/yangilash...');
    for (const b of BUYER_SPECS) {
      const existing = await prisma.user.findUnique({ where: { phone: b.phone } });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            fullName: b.fullName,
            email: b.email,
            passwordHash,
            roles: [Role.BUYER],
            roleChosen: true,
            lastActiveRole: Role.BUYER,
            profileDone: true,
            verified: true,
            status: UserStatus.ACTIVE,
            sellerStatus: SellerStatus.NOT_APPLIED,
            companyName: b.companyName,
            industry: b.industry,
            location: b.location,
            bio: b.bio,
          },
        });
        console.log(`  ✓ [BUYER] ${b.code} (${b.phone} / ${b.email}): yangilandi.`);
      } else {
        await prisma.user.create({
          data: {
            id: uuidv7(),
            phone: b.phone,
            fullName: b.fullName,
            email: b.email,
            passwordHash,
            roles: [Role.BUYER],
            roleChosen: true,
            lastActiveRole: Role.BUYER,
            profileDone: true,
            verified: true,
            status: UserStatus.ACTIVE,
            sellerStatus: SellerStatus.NOT_APPLIED,
            companyName: b.companyName,
            industry: b.industry,
            location: b.location,
            bio: b.bio,
          },
        });
        console.log(`  ✓ [BUYER] ${b.code} (${b.phone} / ${b.email}): yaratildi.`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // [3/4] MUTAXASSIS (SELLER/SPECIALIST) HISOB-LARI
    // ─────────────────────────────────────────────────────────────
    console.log('\n[3/4] Mutaxassis (Specialist) hisoblarini yaratish/yangilash...');
    for (const s of SPECIALIST_SPECS) {
      let userId: string;
      const existing = await prisma.user.findUnique({
        where: { phone: s.phone },
        include: { sellerApplications: true },
      });

      if (existing) {
        userId = existing.id;
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            fullName: s.fullName,
            email: s.email,
            passwordHash,
            roles: [Role.SELLER],
            roleChosen: true,
            lastActiveRole: Role.SELLER,
            profileDone: true,
            verified: true,
            status: UserStatus.ACTIVE,
            sellerStatus: SellerStatus.APPROVED,
            location: s.location,
            bio: s.bio,
          },
        });

        if (existing.sellerApplications.length === 0) {
          await prisma.sellerApplication.create({
            data: {
              id: uuidv7(),
              userId: existing.id,
              legalName: s.appLegalName,
              displayName: s.appDisplayName,
              description: s.appDescription,
              status: SellerApplicationStatus.APPROVED,
              submittedAt: new Date(),
              reviewedAt: new Date(),
            },
          });
        }
        console.log(`  ✓ [MUTAXASSIS] ${s.code} (${s.phone} / ${s.email}): yangilandi (APPROVED).`);
      } else {
        userId = uuidv7();
        await prisma.user.create({
          data: {
            id: userId,
            phone: s.phone,
            fullName: s.fullName,
            email: s.email,
            passwordHash,
            roles: [Role.SELLER],
            roleChosen: true,
            lastActiveRole: Role.SELLER,
            profileDone: true,
            verified: true,
            status: UserStatus.ACTIVE,
            sellerStatus: SellerStatus.APPROVED,
            location: s.location,
            bio: s.bio,
          },
        });
        await prisma.sellerApplication.create({
          data: {
            id: uuidv7(),
            userId,
            legalName: s.appLegalName,
            displayName: s.appDisplayName,
            description: s.appDescription,
            status: SellerApplicationStatus.APPROVED,
            submittedAt: new Date(),
            reviewedAt: new Date(),
          },
        });
        console.log(`  ✓ [MUTAXASSIS] ${s.code} (${s.phone} / ${s.email}): yaratildi (APPROVED).`);
      }

      // Pre-seed faol xizmat (Service)
      const categoryId = categoryMap.get(s.service.categorySlug);
      if (categoryId) {
        const existingService = await prisma.service.findFirst({
          where: { sellerId: userId, title: s.service.title },
        });
        if (!existingService) {
          await prisma.service.create({
            data: {
              id: uuidv7(),
              sellerId: userId,
              categoryId,
              title: s.service.title,
              description: s.service.description,
              lang: 'uz',
              price: s.service.priceTiyin,
              currency: 'UZS',
              deliveryDays: s.service.deliveryDays,
              status: ServiceStatus.ACTIVE,
              publishedAt: new Date(),
              submittedAt: new Date(),
              reviewedAt: new Date(),
            },
          });
          console.log(`    ↳ Faol xizmat yaratildi: "${s.service.title}"`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // [4/4] ADMIN HISOB-LARI (StaffMember)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[4/4] Admin (Boshqaruv) hisoblarini yaratish/yangilash...');
    for (const a of ADMIN_SPECS) {
      // User qaydini ham yaratish/bog'lash
      let staffUserId: string | undefined;
      const existingUser = await prisma.user.findUnique({ where: { phone: a.phone } });
      if (existingUser) {
        staffUserId = existingUser.id;
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            fullName: a.fullName,
            email: a.email,
            passwordHash,
            status: UserStatus.ACTIVE,
            roleChosen: true,
            profileDone: true,
            verified: true,
          },
        });
      } else {
        staffUserId = uuidv7();
        await prisma.user.create({
          data: {
            id: staffUserId,
            phone: a.phone,
            fullName: a.fullName,
            email: a.email,
            passwordHash,
            roles: [Role.BUYER],
            roleChosen: true,
            lastActiveRole: Role.BUYER,
            profileDone: true,
            verified: true,
            status: UserStatus.ACTIVE,
          },
        });
      }

      // Asosiy email
      const allEmails = [a.email, ...(a.aliases || [])];
      for (const email of allEmails) {
        const existingStaff = await prisma.staffMember.findUnique({ where: { email } });
        if (existingStaff) {
          await prisma.staffMember.update({
            where: { email },
            data: {
              fullName: a.fullName,
              title: a.title,
              role: a.role,
              permissions: a.permissions,
              status: StaffStatus.ACTIVE,
              mustChangePassword: false,
              mfaEnabled: false,
              passwordHash,
              userId: email === a.email ? staffUserId : undefined,
            },
          });
          console.log(`  ✓ [ADMIN] ${a.code} (${email}): yangilandi (${a.role}).`);
        } else {
          await prisma.staffMember.create({
            data: {
              id: uuidv7(),
              email,
              fullName: a.fullName,
              title: a.title,
              role: a.role,
              permissions: a.permissions,
              status: StaffStatus.ACTIVE,
              mustChangePassword: false,
              mfaEnabled: false,
              passwordHash,
              userId: email === a.email ? staffUserId : undefined,
            },
          });
          console.log(`  ✓ [ADMIN] ${a.code} (${email}): yaratildi (${a.role}).`);
        }
      }
    }

    console.log('\n==========================================================');
    console.log('✅ BARCHA 9 TA TEST HISOBI MUVAFFAQIYATLI SEED QILINDI!');
    console.log('==========================================================');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedTestAccounts().catch((err) => {
    console.error('FATAL ERROR IN SEED SCRIPT:', err);
    process.exit(1);
  });
}
