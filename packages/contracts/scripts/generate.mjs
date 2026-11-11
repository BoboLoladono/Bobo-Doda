#!/usr/bin/env node
/**
 * @bobololadono/contracts — generatsiya.
 *
 *   npm run generate:contracts   (root'dan)
 *
 * Uch bosqich:
 *   1. Backend'dan OpenAPI hujjatini oladi  → openapi.json
 *      (`backend/scripts/emit-openapi.ts` — Nest app'ni ko'taradi, lekin
 *       DB/Redis ga ULANMAYDI: faqat route metadata'sidan Swagger doc quriladi.)
 *   2. openapi-typescript                    → src/openapi-types.ts
 *   3. Prisma schema enum bloklari           → src/enums.ts
 *   4. Barre fayl                            → src/index.ts
 *
 * QO'LDA YOZILGAN KOD YO'Q. Hammasi shu skript natijasi. `lib/api/wire-enums.ts`
 * (frontend, Bosqich 2) shu paketdan import qiladi — `Record<BackendEnum,
 * FrontendEnum>` exhaustive tekshiruvi backend enum ro'yxatiga tayanadi.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const backendRoot = join(repoRoot, 'backend');
const srcDir = join(pkgRoot, 'src');
const openapiPath = join(pkgRoot, 'openapi.json');

if (!existsSync(srcDir)) mkdirSync(srcDir, { recursive: true });

const log = (msg) => console.log(`[contracts] ${msg}`);

// ── 1. OpenAPI hujjati ──────────────────────────────────────────────────────
log('OpenAPI hujjatini backend\'dan olish…');
execFileSync(
  process.execPath,
  [
    '--require',
    'ts-node/register/transpile-only',
    '--require',
    'tsconfig-paths/register',
    join('scripts', 'emit-openapi.ts'),
    openapiPath,
  ],
  {
    cwd: backendRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_NODE_PROJECT: join(backendRoot, 'tsconfig.json'),
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Dummy — Zod validatsiyasi o'tsin; hech qanday ulanish qilinmaydi.
      DATABASE_URL: 'postgresql://contracts:contracts@127.0.0.1:5432/contracts?schema=public',
      DATABASE_MIGRATION_URL:
        'postgresql://contracts:contracts@127.0.0.1:5432/contracts?schema=public',
      REDIS_URL: 'redis://127.0.0.1:6379',
      // Bosqich 2 — MAJBURIY (≥32 belgi). Refresh sirlar yo'q (opaque token,
      // JWT emas — `backend/src/common/security/opaque-token.util.ts`).
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_STAFF_ACCESS_SECRET: 'z'.repeat(32),
      STAFF_TOTP_ENCRYPTION_KEY: process.env.STAFF_TOTP_ENCRYPTION_KEY || '2'.repeat(64),
    },
  },
);
if (!existsSync(openapiPath)) {
  throw new Error(`emit-openapi openapi.json yaratmadi: ${openapiPath}`);
}
log(`openapi.json yozildi (${(readFileSync(openapiPath, 'utf8').length / 1024).toFixed(1)} KB)`);

// ── 2. openapi-typescript ───────────────────────────────────────────────────
log('openapi-typescript → src/openapi-types.ts');
execFileSync(
  process.execPath,
  [
    join(repoRoot, 'node_modules', 'openapi-typescript', 'bin', 'cli.js'),
    openapiPath,
    '--output',
    join(srcDir, 'openapi-types.ts'),
  ],
  { cwd: pkgRoot, stdio: 'inherit' },
);

// ── 3. Prisma enum'lari → src/enums.ts ──────────────────────────────────────
log('Prisma schema enum bloklari → src/enums.ts');
const schema = readFileSync(join(backendRoot, 'prisma', 'schema.prisma'), 'utf8');
const enumBlocks = [...schema.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)].map(([, name, body]) => ({
  name,
  values: [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*$/gm)].map((m) => m[1]),
}));
if (enumBlocks.length === 0) throw new Error('schema.prisma da enum topilmadi');

const enumsFile = [
  '// ─────────────────────────────────────────────────────────────────────────',
  '// GENERATSIYA QILINGAN — QO\'LDA TAHRIR QILINMANG.',
  '// Manba: backend/prisma/schema.prisma  ·  npm run generate:contracts',
  '// ─────────────────────────────────────────────────────────────────────────',
  '',
  ...enumBlocks.flatMap(({ name, values }) => [
    `export const ${name} = {`,
    ...values.map((v) => `  ${v}: '${v}',`),
    '} as const;',
    `export type ${name} = (typeof ${name})[keyof typeof ${name}];`,
    `export const ${name}Values = [${values.map((v) => `'${v}'`).join(', ')}] as const;`,
    '',
  ]),
].join('\n');
writeFileSync(join(srcDir, 'enums.ts'), enumsFile);
log(`  ${enumBlocks.length} enum: ${enumBlocks.map((e) => e.name).join(', ')}`);

// ── 4. Barre fayl ──────────────────────────────────────────────────────────
writeFileSync(
  join(srcDir, 'index.ts'),
  [
    '// GENERATSIYA QILINGAN — QO\'LDA TAHRIR QILINMANG. npm run generate:contracts',
    "export * from './enums';",
    "export type { paths, components, operations } from './openapi-types';",
    '',
  ].join('\n'),
);

log('tayyor ✓');
