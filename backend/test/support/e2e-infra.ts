import { execFileSync, spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { assertIsolatedTestInfra } from './test-safety';

/**
 * E2E infratuzilma manzillari.
 *
 * CI'da Postgres/Redis **GitHub Actions service konteynerlari** sifatida
 * ko'tariladi (Testcontainers EMAS — u ba'zi runner'larda Redis ulanishini
 * "Connection is closed" bilan yiqitardi). Lokal'da: `docker compose up -d
 * postgres redis` yoki nix-shell ichidagi throwaway klaster; superuser
 * URL'ini `E2E_SUPERUSER_URL` bilan bering.
 */
export const E2E_SUPERUSER_URL =
  process.env.E2E_SUPERUSER_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379';

const BACKEND_ROOT = `${__dirname}/../..`;

const withConnectTimeout = (url: string, seconds: number): string =>
  url.includes('connect_timeout=')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}connect_timeout=${seconds}`;

/** DB nomini almashtiradi: `.../postgres?x` → `.../<name>?x`. */
export const withDatabase = (url: string, name: string): string =>
  url.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);

/** `postgresql://u:p@host:port/db` → `host:port`. */
export const hostOf = (url: string): string =>
  new URL(url.replace(/^[a-z]+:\/\//i, 'http://')).host;

/** Infra yetib bo'lmasa test o'zini o'tkazib yuboradi (lokal, xizmatlarsiz). */
export async function pgReachable(): Promise<boolean> {
  assertIsolatedTestInfra(E2E_SUPERUSER_URL, E2E_REDIS_URL);
  const client = new PrismaClient({ datasourceUrl: withConnectTimeout(E2E_SUPERUSER_URL, 3) });
  try {
    await client.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

/**
 * F2 — infra yo'qligini SKIP bilan jimgina yutib yubormaslik uchun: agar
 * `CI_REQUIRE_E2E=true` bo'lsa (backend-ci.yml integration job'ida
 * o'rnatiladi) va Postgres yetib bo'lmasa — suite TASHLAYDI (CI qizil
 * bo'ladi), "infra topilmadi" jimgina yashil belgiga aylanib qolmaydi.
 * Lokal'da (flag yo'q) — eskicha skip.
 */
export async function requireInfraOrSkip(label: string): Promise<boolean> {
  if (await pgReachable()) return true;
  if (process.env.CI_REQUIRE_E2E === 'true') {
    throw new Error(
      `[${label}] CI_REQUIRE_E2E=true — Postgres infra KUTILGAN edi, topilmadi: ${hostOf(E2E_SUPERUSER_URL)}`,
    );
  }
  process.stderr.write(`[${label}] Postgres yetib bo'lmadi — suite o'tkazib yuborildi\n`);
  return false;
}

/**
 * OTP rate-limit hisoblagichlari (`RateLimiterService`, Bosqich 2) Redis'da
 * saqlanadi — `npm run test:e2e` BUTUN yugurish davomida bitta jarayon,
 * bitta Redis. Bir nechta e2e fayl OTP so'rasa (Bosqich 3'dan boshlab —
 * `auth`, `staff-auth`, `profile-account`, `seller-onboarding`,
 * `marketplace`), ular BIR XIL loopback IP'dan chaqiradi va soatlik IP
 * limitini (`OTP_IP_HOURLY_LIMIT`) BIRGALIKDA to'ldiradi — birinchi fayl
 * o'z ichida to'g'ri ishlagan bo'lsa ham, KEYINGI fayl allaqachon
 * `RATE_LIMITED` bilan boshlanadi. Har OTP-ishlatuvchi spec faylining
 * `beforeAll`'i shu funksiyani `provisionDb()` bilan BIRGA chaqiradi.
 */
export async function flushRedis(): Promise<void> {
  assertIsolatedTestInfra(E2E_SUPERUSER_URL, E2E_REDIS_URL);
  const client = new Redis(E2E_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    await client.flushall();
  } finally {
    client.disconnect();
  }
}

/** Toza DB yaratadi (qayta ishga tushirishga chidamli). Superuser URL qaytaradi. */
export async function recreateDatabase(name: string): Promise<string> {
  assertIsolatedTestInfra(E2E_SUPERUSER_URL, E2E_REDIS_URL, name);
  const admin = new PrismaClient({ datasourceUrl: E2E_SUPERUSER_URL });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
  return withDatabase(E2E_SUPERUSER_URL, name);
}

export async function dropDatabase(name: string): Promise<void> {
  assertIsolatedTestInfra(E2E_SUPERUSER_URL, E2E_REDIS_URL, name);
  const admin = new PrismaClient({ datasourceUrl: E2E_SUPERUSER_URL });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
  await admin.$disconnect();
}

export interface ProvisionedDb {
  /** Superuser (`postgres`) — DB'ni yaratish/o'chirish uchun. */
  superuserUrl: string;
  /** Migrator roli — faqat `prisma migrate deploy`. */
  migratorUrl: string;
  /** App roli — runtime, F1 shuni tekshiradi. */
  appUrl: string;
  appRole: string;
  migratorRole: string;
}

export interface ProvisionDbOptions {
  /** T1 isboti uchun: sukut `bobololadono_app`/`bobololadono_migrator` dan boshqa nom. */
  appRole?: string;
  migratorRole?: string;
}

/** Postgres kvotalanmagan identifikatori — `env.schema.ts`dagi DB_APP_ROLE bilan bir xil qoida. */
const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;

function assertSafeIdentifier(value: string, label: string): void {
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new Error(`e2e-infra: "${label}" xavfsiz identifikator emas: "${value}"`);
  }
}

/**
 * `prisma/sql/roles.sql` ekvivalenti (test uchun) + migratsiya. Toza `name`
 * DB'sini yaratadi, rollarni (global, mavjud bo'lmasa) sozlaydi, `bobololadono.
 * app_role` GUC'ini o'rnatadi (T1 — migratsiya buni o'qiydi, sukut yo'liga
 * emas, HAQIQIY GUC yo'liga tayanish uchun) va migrator roli bilan
 * `prisma migrate deploy` qiladi — natijada `appUrl` A4 (append-only) va F1
 * (rol tekshiruvi) ikkalasini ham qondiradi.
 *
 * `name`/`appRole`/`migratorRole` — bu yerda test kodi konstantalari (hech
 * qachon tashqi/foydalanuvchi kirishi emas), lekin baribir
 * `assertSafeIdentifier` bilan tekshiriladi — prod kodidagi (`roles.sql`,
 * migratsiya) `format('%I', …)` qoidasi bilan bir xil intizom.
 */
export async function provisionDb(name: string, opts: ProvisionDbOptions = {}): Promise<ProvisionedDb> {
  const appRole = opts.appRole ?? 'bobololadono_app';
  const migratorRole = opts.migratorRole ?? 'bobololadono_migrator';
  assertSafeIdentifier(name, 'name');
  assertSafeIdentifier(appRole, 'appRole');
  assertSafeIdentifier(migratorRole, 'migratorRole');

  const superuserUrl = await recreateDatabase(name);
  const host = hostOf(superuserUrl);
  const migratorUrl = `postgresql://${migratorRole}:migrator@${host}/${name}?schema=public`;
  const appUrl = `postgresql://${appRole}:app@${host}/${name}?schema=public`;

  const su = new PrismaClient({ datasourceUrl: superuserUrl });
  try {
    for (const stmt of [
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${migratorRole}') THEN
           CREATE ROLE ${migratorRole} LOGIN PASSWORD 'migrator';
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${appRole}') THEN
           CREATE ROLE ${appRole} LOGIN PASSWORD 'app';
         END IF;
       END $$;`,
      `GRANT CONNECT ON DATABASE "${name}" TO ${migratorRole}, ${appRole}`,
      `GRANT CREATE ON DATABASE "${name}" TO ${migratorRole}`,
      `GRANT CREATE, USAGE ON SCHEMA public TO ${migratorRole}`,
      `GRANT USAGE ON SCHEMA public TO ${appRole}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${migratorRole} IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`,
      // T1 — migratsiya shu GUC'ni o'qiydi (`current_setting('bobololadono.app_role', true)`).
      // Sukut yo'lga (COALESCE fallback) emas, HAQIQIY GUC yo'liga tayanamiz.
      `ALTER DATABASE "${name}" SET bobololadono.app_role = '${appRole}'`,
    ]) {
      await su.$executeRawUnsafe(stmt);
    }
  } finally {
    await su.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: appUrl, DATABASE_MIGRATION_URL: migratorUrl },
    stdio: 'inherit',
  });

  return { superuserUrl, migratorUrl, appUrl, appRole, migratorRole };
}

export interface BootCheckResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * `scripts/boot-check.ts` ni ALOHIDA PROCESSDA ishga tushiradi — F1'ning
 * "noto'g'ri rol bilan ilova ko'tarilmaydi" da'vosini jest module-cache
 * emas, haqiqiy process-darajasidagi boot bilan isbotlaydi.
 */
export function bootCheck(env: NodeJS.ProcessEnv): BootCheckResult {
  const res = spawnSync(
    process.execPath,
    [
      '--require',
      'ts-node/register/transpile-only',
      '--require',
      'tsconfig-paths/register',
      'scripts/boot-check.ts',
    ],
    {
      cwd: BACKEND_ROOT,
      env: { ...process.env, TS_NODE_PROJECT: `${BACKEND_ROOT}/tsconfig.json`, ...env },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}
