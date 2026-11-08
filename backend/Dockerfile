# Bobololadono backend — ko'p bosqichli Docker image.
#   target: build    → to'liq deps + kompilyatsiya (`npm run build`)
#   target: runtime  → faqat prod deps + dist/  (lean image, `node dist/main.js`)
#
# DIQQAT (Bosqich 12, bo'lim 45) — `prisma migrate deploy` bu image ICHIDA
# ISHLAMAYDI (na build, na runtime bosqichida). Migratsiya DEPLOY
# pipeline'ning ALOHIDA, image ishga tushishidan OLDINGI qadami
# (`DATABASE_MIGRATION_URL` — migrator rol, `docs/RUNBOOK.md` §12
# "Deployment ketma-ketligi") — runtime konteyner faqat `bobololadono_app`
# (kam huquqli) rol bilan ishlaydi, uning `DATABASE_URL`'ida DDL huquqi
# UMUMAN yo'q (A4).
#
# BUILD CONTEXT — `backend/`ning O'ZI (Bosqich 23-deploy tuzatishi):
# loyiha npm workspaces monorepo, lekin `backend/package-lock.json`
# ATAYLAB standalone (root lockfile'dan MUSTAQIL, `npm install
# --package-lock-only` alohida, izolyatsiyalangan papkada generatsiya
# qilingan) — backend HECH QANDAY workspace paketiga (`@bobololadono/
# contracts`) bog'liq EMAS, shuning uchun bu xavfsiz. Railway'da:
# `railway up backend --path-as-root --service backend` — `backend/`
# papkasi MUSTAQIL yuklanadi, shu Dockerfile uning ILDIZIDA topiladi
# (qo'shimcha "Dockerfile Path" sozlamasi SHART EMAS).

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# A3 — konteyner vaqti UTC (barcha timestamptz, hisobot ko'chirishda buzilmasin).
ENV TZ=UTC
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV TZ=UTC
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime -----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV TZ=UTC
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall (`prisma generate`) prisma CLI'ni talab qiladi — u devDep,
# shuning uchun --ignore-scripts; generatsiya qilingan client build'dan ko'chiriladi.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
