import { Injectable } from '@nestjs/common';
import type { AuditActor } from '@/common/audit/audit.service';
import type { StaffMember } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { HashService } from '@/common/security/hash.service';
import { RateLimiterService } from '@/common/security/rate-limiter.service';
import { AppConfigService } from '@/config/app-config.service';
import { AuditService } from '@/common/audit/audit.service';
import { generateOpaqueToken, hashOpaqueToken } from '@/common/security/opaque-token.util';
import { buildOtpauthUri, generateTotpSecret, verifyTotpAtCounter } from '@/common/security/totp.util';
import { decryptTotpSecret, encryptTotpSecret } from '@/common/security/totp-secret-cipher.util';
import { parseDurationMs } from '@/common/security/duration.util';
import { DomainError, ForbiddenError, NotFoundError, UnauthenticatedError } from '@/common/errors/domain-error';
import { TokenService } from '@/modules/auth/token.service';
import type { RequestMeta } from '@/modules/auth/refresh-token.service';
import {
  STAFF_LOGIN_EMAIL_MAX_ATTEMPTS,
  STAFF_LOGIN_EMAIL_WINDOW_SECONDS,
  STAFF_LOGIN_IP_MAX_ATTEMPTS,
  STAFF_LOGIN_IP_WINDOW_SECONDS,
  STAFF_TOTP_ENROLLMENT_TTL_SECONDS,
  STAFF_TOTP_MAX_ATTEMPTS,
  STAFF_TOTP_WINDOW_SECONDS,
  TOTP_ISSUER,
} from './staff-auth.constants';

export interface StaffAuthResult {
  accessToken: string;
  refreshToken: string;
  staff: StaffMember;
}

/**
 * Staff (admin panel) auth — marketplace `AuthService`dan MUSTAQIL:
 * email+parol (Argon2id) + ixtiyoriy TOTP 2FA. Sessiya modeli oddiyroq
 * (`StaffSession.tokenHash` — bitta opaque token butun 8 soat davomida,
 * ROTATSIYA yo'q — `schema.prisma`dagi izohga qarang: marketplace darajasidagi
 * reuse-detection talab qilinmagan, chunki staff soni kam va operatorlar
 * tomonidan nazorat qilinadi).
 *
 * Bosqich 11 — TOTP enrollment/disable/admin-reset, parol o'zgartirish/
 * reset, brute-force himoya (login + TOTP) shu servisga qo'shildi.
 */
@Injectable()
export class StaffAuthService {
  /** Email topilmaganda ham HAQIQIY argon2id hisoblash vaqtini sarflash
   * uchun — bir marta yasalib keshlanadi (timing-orqali email enumeration
   * himoyasi; qo'lda yozilgan "soxta hash" satridan FARQLI — bu format
   * doim to'g'ri, argon2 uni bemalol "to'liq" tekshiradi). */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly hash: HashService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hash.hash(generateOpaqueToken());
    return this.dummyHash;
  }

  private get totpKey(): Buffer {
    return this.config.staffTotpEncryptionKey;
  }

  /** Bo'lim 45 — LOGIN, enrollment-verify, disable — HAMMASI shu BITTA hisoblagichni bo'lishadi (staffId bo'yicha). */
  private async assertTotpAttemptAllowed(staffId: string): Promise<void> {
    const hit = await this.limiter.hit(`staff-totp:${staffId}`, STAFF_TOTP_WINDOW_SECONDS);
    if (hit.count > STAFF_TOTP_MAX_ATTEMPTS) {
      throw new DomainError('RATE_LIMITED', "TOTP urinishlar chegarasiga yetdingiz, birozdan keyin qayta urinib ko'ring");
    }
  }

  async login(
    email: string,
    password: string,
    totpCode: string | undefined,
    meta?: RequestMeta,
  ): Promise<StaffAuthResult> {
    // Bo'lim 42 — brute-force himoya: IP (email haqiqiyligidan qat'i nazar —
    // enumeration signal bermasin) VA email bo'yicha, PAROL tekshirishdan OLDIN.
    if (meta?.ip) {
      const perIp = await this.limiter.hit(`staff-login:ip:${meta.ip}`, STAFF_LOGIN_IP_WINDOW_SECONDS);
      if (perIp.count > STAFF_LOGIN_IP_MAX_ATTEMPTS) {
        throw new DomainError('RATE_LIMITED', "So'rovlar chegarasiga yetdingiz");
      }
    }
    const perEmail = await this.limiter.hit(`staff-login:email:${email.toLowerCase()}`, STAFF_LOGIN_EMAIL_WINDOW_SECONDS);
    if (perEmail.count > STAFF_LOGIN_EMAIL_MAX_ATTEMPTS) {
      throw new DomainError('RATE_LIMITED', "So'rovlar chegarasiga yetdingiz");
    }

    const normalizedEmail = email.trim().toLowerCase();
    let member = await this.prisma.staffMember.findUnique({ where: { email } });
    if (!member && normalizedEmail !== email) {
      member = await this.prisma.staffMember.findUnique({ where: { email: normalizedEmail } });
    }
    if (!member) {
      const candidates: string[] = [];
      if (normalizedEmail.endsWith('@bobololadono.uz')) {
        candidates.push(normalizedEmail.replace('@bobololadono.uz', '@bobododa.uz'));
      } else if (normalizedEmail.endsWith('@bobododa.uz')) {
        candidates.push(normalizedEmail.replace('@bobododa.uz', '@bobololadono.uz'));
      }
      if (normalizedEmail.startsWith('moliya@')) {
        candidates.push(normalizedEmail.replace('moliya@', 'finance@'));
        candidates.push('finance@bobololadono.uz');
      } else if (normalizedEmail.startsWith('finance@')) {
        candidates.push(normalizedEmail.replace('finance@', 'moliya@'));
        candidates.push('moliya@bobododa.uz');
      }

      for (const candidate of candidates) {
        member = await this.prisma.staffMember.findUnique({ where: { email: candidate } });
        if (member) break;
      }
    }

    // Email topilmasa ham parolni "tekshirib" vaqt sarflaymiz — timing orqali
    // "bu email bor/yo'q"ni bilib olishning oldini olish.
    const passwordOk = member
      ? await this.hash.verify(member.passwordHash, password)
      : await this.hash.verify(await this.getDummyHash(), password);
    if (!member || !passwordOk) {
      throw new UnauthenticatedError("Email yoki parol noto'g'ri", 'INVALID_CREDENTIALS');
    }

    // Bo'lim 44 — SUSPENDED/DISABLED IKKALASI HAM bir xil public javob
    // (`ACCOUNT_BLOCKED`) — operatsion farqni tashqariga chiqarmaymiz.
    if (member.status !== 'ACTIVE') {
      throw new ForbiddenError('Hisob faol emas', 'ACCOUNT_BLOCKED');
    }

    let totpCounter: number | null = null;
    if (member.mfaEnabled) {
      if (!totpCode) {
        throw new UnauthenticatedError('2FA kod talab qilinadi', 'MFA_REQUIRED');
      }
      await this.assertTotpAttemptAllowed(member.id);
      if (!member.totpSecret) {
        throw new DomainError('INVALID_CODE', "2FA kod noto'g'ri");
      }
      const plainSecret = decryptTotpSecret(member.totpSecret, this.totpKey);
      totpCounter = verifyTotpAtCounter(plainSecret, totpCode);
      if (totpCounter === null) {
        throw new DomainError('INVALID_CODE', "2FA kod noto'g'ri");
      }
    }

    const raw = generateOpaqueToken();
    const session = await this.prisma.staffSession.create({
      data: {
        id: this.ids.next(),
        staffId: member.id,
        tokenHash: hashOpaqueToken(raw),
        userAgent: meta?.userAgent,
        ip: meta?.ip,
        expiresAt: new Date(Date.now() + parseDurationMs(this.config.staffJwt.refreshTtl)),
      },
    });

    // Bo'lim 13/41 — replay/parallel-session himoyasi: `lastTotpCounter`ni
    // CAS bilan yangilaymiz. Ikkita PARALLEL so'rov BIR XIL kod bilan
    // kelsa — FAQAT BITTASI g'olib chiqadi (`count === 1`), ikkinchisi
    // "kod allaqachon ishlatilgan" deb rad etiladi (session yaratilmasdan
    // OLDIN emas — lekin yaratilgan session g'olib bo'lmagan chaqiruvga
    // qaytarilmaydi, chunki funksiya shu yerda `throw` qiladi).
    if (totpCounter !== null) {
      const cas = await this.prisma.staffMember.updateMany({
        where: { id: member.id, OR: [{ lastTotpCounter: null }, { lastTotpCounter: { lt: totpCounter } }] },
        data: { lastTotpCounter: totpCounter, lastLoginAt: new Date() },
      });
      if (cas.count === 0) {
        await this.prisma.staffSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        throw new DomainError('INVALID_CODE', 'Kod allaqachon ishlatilgan');
      }
    } else {
      await this.prisma.staffMember.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
    }

    const accessToken = this.tokens.signStaffAccessToken({
      sub: member.id,
      role: member.role,
      sessionId: session.id,
    });

    return { accessToken, refreshToken: raw, staff: member };
  }

  /** Sessiya (opaque token) o'zgarmaydi — faqat YANGI qisqa umrli access JWT. */
  async refresh(rawToken: string): Promise<{ accessToken: string; staff: StaffMember }> {
    const session = await this.prisma.staffSession.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthenticatedError('Sessiya tugagan', 'TOKEN_EXPIRED');
    }

    const member = await this.prisma.staffMember.findUnique({ where: { id: session.staffId } });
    if (!member || member.status !== 'ACTIVE') {
      throw new ForbiddenError('Hisob faol emas', 'ACCOUNT_BLOCKED');
    }

    const accessToken = this.tokens.signStaffAccessToken({
      sub: member.id,
      role: member.role,
      sessionId: session.id,
    });
    return { accessToken, staff: member };
  }

  async logout(rawToken: string, staffId: string): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { tokenHash: hashOpaqueToken(rawToken), staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getById(staffId: string): Promise<StaffMember> {
    return this.prisma.staffMember.findUniqueOrThrow({ where: { id: staffId } });
  }

  // ── Bo'lim 5 — parol o'zgartirish (o'ziga) ──────────────────────────────

  async changePassword(
    staffId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const member = await this.getById(staffId);
    if (!(await this.hash.verify(member.passwordHash, currentPassword))) {
      throw new UnauthenticatedError("Joriy parol noto'g'ri", 'INVALID_CURRENT_PASSWORD');
    }
    const newHash = await this.hash.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffMember.update({
        where: { id: staffId },
        data: { passwordHash: newHash, mustChangePassword: false },
      });
      // Bo'lim 5 — boshqa (joriy sessiyadan TASHQARI) barcha sessiyalar
      // bekor qilinadi: parol o'zgargach eski qurilmalar qayta autentifikatsiya qilishi kerak,
      // lekin foydalanuvchi o'zini shu zahoti tashqariga chiqarib qo'ymasin.
      await tx.staffSession.updateMany({
        where: { staffId, revokedAt: null, id: { not: currentSessionId } },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actor: { id: staffId, type: 'STAFF', name: member.fullName },
          action: 'STAFF_PASSWORD_CHANGED',
          resourceType: 'STAFF_MEMBER',
          resourceId: staffId,
        },
        tx,
      );
    });
  }

  // ── Bo'lim 15/16 — sessiyalar ────────────────────────────────────────────

  async listOwnSessions(staffId: string) {
    return this.prisma.staffSession.findMany({
      where: { staffId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
    });
  }

  async revokeOwnSession(staffId: string, sessionId: string): Promise<void> {
    const cas = await this.prisma.staffSession.updateMany({
      where: { id: sessionId, staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (cas.count === 0) throw new NotFoundError('Sessiya topilmadi', 'NOT_FOUND');
  }

  async revokeAllOwnSessions(staffId: string): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Bo'lim 16 — admin boshqa staff'ning HAMMA sessiyasini bekor qiladi. */
  async adminRevokeSessions(targetId: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.staffSession.updateMany({ where: { staffId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(
        { actor, action: 'STAFF_SESSIONS_REVOKED', resourceType: 'STAFF_MEMBER', resourceId: targetId },
        tx,
      );
    });
  }

  // ── Bo'lim 7/8/10 — TOTP enrollment (o'ziga) ────────────────────────────

  async beginTotpEnrollment(staffId: string): Promise<{ secret: string; otpauthUri: string }> {
    const member = await this.getById(staffId);
    const secret = generateTotpSecret();
    await this.prisma.staffMember.update({
      where: { id: staffId },
      data: {
        pendingTotpSecret: encryptTotpSecret(secret, this.totpKey),
        pendingTotpExpiresAt: new Date(Date.now() + STAFF_TOTP_ENROLLMENT_TTL_SECONDS * 1000),
      },
    });
    // Bo'lim 39 — sirni SAQLAMAYDI (audit metadata'da HECH QACHON secret bo'lmasin).
    await this.audit.record({
      actor: { id: staffId, type: 'STAFF', name: member.fullName },
      action: 'STAFF_TOTP_ENROLLMENT_STARTED',
      resourceType: 'STAFF_MEMBER',
      resourceId: staffId,
    });
    const otpauthUri = buildOtpauthUri({ secret, accountLabel: member.email, issuer: TOTP_ISSUER });
    return { secret, otpauthUri };
  }

  async verifyTotpEnrollment(staffId: string, code: string): Promise<void> {
    const member = await this.getById(staffId);
    if (!member.pendingTotpSecret || !member.pendingTotpExpiresAt || member.pendingTotpExpiresAt.getTime() <= Date.now()) {
      throw new DomainError('INVALID_TRANSITION', 'Enrollment boshlanmagan yoki muddati tugagan — qaytadan boshlang');
    }
    await this.assertTotpAttemptAllowed(staffId);
    const plainSecret = decryptTotpSecret(member.pendingTotpSecret, this.totpKey);
    const counter = verifyTotpAtCounter(plainSecret, code);
    if (counter === null) {
      throw new DomainError('INVALID_CODE', "2FA kod noto'g'ri");
    }
    // Bo'lim 7 — Secret FAQAT shu yerda, verify bo'lgandan KEYIN active
    // bo'ladi. CAS — `pendingTotpSecret` hali BIZ o'qigan qiymat bo'lsagina
    // (parallel enroll-restart bo'lsa eskirgan urinish yutqazadi).
    const cas = await this.prisma.staffMember.updateMany({
      where: { id: staffId, pendingTotpSecret: member.pendingTotpSecret },
      data: {
        totpSecret: member.pendingTotpSecret,
        mfaEnabled: true,
        pendingTotpSecret: null,
        pendingTotpExpiresAt: null,
        lastTotpCounter: counter,
      },
    });
    if (cas.count === 0) {
      throw new DomainError('INVALID_TRANSITION', 'Enrollment holati o‘zgardi — qaytadan boshlang');
    }
    await this.audit.record({
      actor: { id: staffId, type: 'STAFF', name: member.fullName },
      action: 'STAFF_TOTP_ENABLED',
      resourceType: 'STAFF_MEMBER',
      resourceId: staffId,
    });
  }

  // ── Bo'lim 11 — TOTP o'chirish (o'ziga) ─────────────────────────────────

  async disableTotp(staffId: string, currentPassword: string, code: string): Promise<void> {
    const member = await this.getById(staffId);
    if (!member.mfaEnabled || !member.totpSecret) {
      throw new DomainError('INVALID_TRANSITION', 'TOTP allaqachon o‘chirilgan');
    }
    if (!(await this.hash.verify(member.passwordHash, currentPassword))) {
      throw new UnauthenticatedError("Joriy parol noto'g'ri", 'INVALID_CURRENT_PASSWORD');
    }
    await this.assertTotpAttemptAllowed(staffId);
    const plainSecret = decryptTotpSecret(member.totpSecret, this.totpKey);
    if (verifyTotpAtCounter(plainSecret, code) === null) {
      throw new DomainError('INVALID_CODE', "2FA kod noto'g'ri");
    }
    await this.prisma.staffMember.update({
      where: { id: staffId },
      data: { totpSecret: null, mfaEnabled: false, lastTotpCounter: null, pendingTotpSecret: null, pendingTotpExpiresAt: null },
    });
    await this.audit.record({
      actor: { id: staffId, type: 'STAFF', name: member.fullName },
      action: 'STAFF_TOTP_DISABLED',
      resourceType: 'STAFF_MEMBER',
      resourceId: staffId,
    });
  }

  // ── Bo'lim 12 — admin TOTP reset ────────────────────────────────────────

  async adminResetTotp(targetId: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.staffMember.update({
        where: { id: targetId },
        data: { totpSecret: null, mfaEnabled: false, pendingTotpSecret: null, pendingTotpExpiresAt: null, lastTotpCounter: null },
      });
      await tx.staffSession.updateMany({ where: { staffId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(
        { actor, action: 'STAFF_TOTP_RESET', resourceType: 'STAFF_MEMBER', resourceId: targetId },
        tx,
      );
    });
  }

  // ── Bo'lim 6 — admin parol reset ────────────────────────────────────────

  /** Qaytarilgan `tempPassword` FAQAT shu chaqiruvda ma'lum — DB'da HECH QACHON plaintext saqlanmaydi, loglanmaydi. */
  async adminResetPassword(targetId: string, actor: AuditActor): Promise<string> {
    const tempPassword = generateOpaqueToken();
    const newHash = await this.hash.hash(tempPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffMember.update({ where: { id: targetId }, data: { passwordHash: newHash, mustChangePassword: true } });
      await tx.staffSession.updateMany({ where: { staffId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(
        { actor, action: 'STAFF_PASSWORD_RESET', resourceType: 'STAFF_MEMBER', resourceId: targetId },
        tx,
      );
    });
    return tempPassword;
  }
}
