import { Injectable } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { HashService } from '@/common/security/hash.service';
import { RateLimiterService } from '@/common/security/rate-limiter.service';
import { AuditService } from '@/common/audit/audit.service';
import { generateOpaqueToken } from '@/common/security/opaque-token.util';
import { normalizePhone } from '@/common/security/phone.util';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationDomainError,
} from '@/common/errors/domain-error';
import { OtpService } from './otp.service';
import { AuthGrantService } from './auth-grant.service';
import { TokenService } from './token.service';
import { RefreshTokenService, type RequestMeta } from './refresh-token.service';
import type { AccessTokenPayload } from './types/token-payload';
import {
  LOGIN_IP_MAX_ATTEMPTS,
  LOGIN_IP_WINDOW_SECONDS,
  LOGIN_PHONE_MAX_ATTEMPTS,
  LOGIN_PHONE_WINDOW_SECONDS,
  OTP_VERIFY_IP_MAX_ATTEMPTS,
  OTP_VERIFY_IP_WINDOW_SECONDS,
} from './constants/otp.constants';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  activeRole: Role | null;
  roleChosen: boolean;
  profileDone: boolean;
  isNewUser: boolean;
}

function assertPasswordsMatch(password: string, confirmPassword: string): void {
  if (password !== confirmPassword) {
    throw new ValidationDomainError({ confirmPassword: 'Parollar mos emas' });
  }
}

/**
 * Marketplace auth orkestratori — Bosqich 21: telefon+PAROL bilan login
 * (SMS ishtirok etmaydi), SMS FAQAT ro'yxatdan o'tish va parolni tiklashda
 * (telefon egaligini isbotlash). `OtpService` (kod haqiqiyligi),
 * `AuthGrantService` (OTP-dan-keyingi qisqa umrli grant),
 * `RefreshTokenService` (sessiya/rotatsiya) va `TokenService` (JWT)ni
 * birlashtiradi.
 */
@Injectable()
export class AuthService {
  /** Telefon topilmaganda ham HAQIQIY argon2id hisoblash vaqtini sarflash
      uchun — bir marta yasalib keshlanadi (timing-orqali enumeration
      himoyasi, `StaffAuthService`dagi bilan bir xil naqsh). */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly hash: HashService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly grants: AuthGrantService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hash.hash(generateOpaqueToken());
    return this.dummyHash;
  }

  /** OTP verify security hardening — `login()`dagi IP-chegara bilan bir xil
      naqsh, DB'ga tegishdan OLDIN (`otp.constants.ts`dagi izohga qarang:
      ataylab IP bo'yicha, telefon bo'yicha EMAS). */
  private async enforceVerifyOtpIpLimit(ip?: string): Promise<void> {
    if (!ip) return;
    const perIp = await this.limiter.hit(`otp:verify:ip:${ip}`, OTP_VERIFY_IP_WINDOW_SECONDS);
    if (perIp.count > OTP_VERIFY_IP_MAX_ATTEMPTS) {
      throw new DomainError('RATE_LIMITED', "So'rovlar chegarasiga yetdingiz");
    }
  }

  /* ── REGISTER — telefon → SMS OTP → grant → parol → User ────────────── */

  async requestRegisterOtp(phone: string, ip?: string): Promise<{ devOtp?: string }> {
    return this.otp.requestOtp(phone, 'REGISTER', { ip });
  }

  /** OTP valid bo'lsa User DARHOL yaratilmaydi — o'rniga qisqa umrli
      `registrationToken` (bo'lim 4). */
  async verifyRegisterOtp(rawPhone: string, code: string, ip?: string): Promise<{ registrationToken: string }> {
    await this.enforceVerifyOtpIpLimit(ip);
    const { phone } = await this.otp.verifyOtp(rawPhone, code, 'REGISTER');
    const registrationToken = await this.grants.issue('REGISTER', phone);
    return { registrationToken };
  }

  /**
   * Bo'lim 5 — grant valid, parol mos bo'lsa ATOMIK: User yaratiladi +
   * parol hash'lanadi + sessiya ochiladi. Telefon allaqachon ro'yxatdan
   * o'tgan bo'lsa `PHONE_EXISTS` (frontend "Kirishni xohlaysizmi?" CTA'sini
   * shu bilan ko'rsatadi) — YANGI User yaratilmaydi. Race-safe: to'g'ridan-
   * to'g'ri `create` (avval `findUnique` emas), DB `User.phone` UNIQUE
   * cheklovi P2002 orqali ushlanadi — bir xil telefon uchun bir nechta
   * PARALLEL `complete` (har biri O'Z grant'i bilan) FAQAT bitta qator
   * yaratadi (bo'lim 23).
   */
  async completeRegistration(
    registrationToken: string,
    password: string,
    confirmPassword: string,
    meta?: RequestMeta,
  ): Promise<AuthResult> {
    assertPasswordsMatch(password, confirmPassword);
    const { phone } = await this.grants.consume(registrationToken, 'REGISTER');
    const passwordHash = await this.hash.hash(password);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          id: this.ids.next(),
          phone,
          passwordHash,
          roles: [],
          // OTP — telefon egaligini isbotlaydi (Telegram/Google'ning o'rnini
          // bosadi — frontend'dagi "verified" bosqichi shu).
          verified: true,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        throw new ConflictError('PHONE_EXISTS', 'Bu raqam bilan hisob allaqachon mavjud');
      }
      throw err;
    }

    return this.issueSession(user.id, null, {
      roleChosen: false,
      profileDone: false,
      isNewUser: true,
      meta,
    });
  }

  /* ── LOGIN — telefon + PAROL, SMS YO'Q ───────────────────────────────── */

  /**
   * Bo'lim 9/10/11 — asosiy invariant: bu metod `OtpService`ni HECH QACHON
   * chaqirmaydi (SMS soni = 0). Noto'g'ri telefon va noto'g'ri parol bir
   * xil generic `INVALID_CREDENTIALS`ga tushadi (enumeration-safe) — telefon
   * topilmasa ham argon2id vaqti sarflanadi (`getDummyHash`), timing orqali
   * "bu raqam bor/yo'q"ni bilib bo'lmaydi.
   */
  async login(rawPhone: string, password: string, meta?: RequestMeta): Promise<AuthResult> {
    let phone = rawPhone.trim();
    try {
      phone = normalizePhone(rawPhone);
    } catch {
      // Format noto'g'ri bo'lsa xom trim bilan davom etadi (timing-safe dummy hash ishlaydi)
    }

    // Bo'lim 12 — brute-force himoya: IP (telefon haqiqiyligidan qat'i
    // nazar — enumeration signal bermasin) VA telefon bo'yicha, PAROL
    // tekshirishdan OLDIN.
    if (meta?.ip) {
      const perIp = await this.limiter.hit(`login:ip:${meta.ip}`, LOGIN_IP_WINDOW_SECONDS);
      if (perIp.count > LOGIN_IP_MAX_ATTEMPTS) {
        throw new DomainError('RATE_LIMITED', "So'rovlar chegarasiga yetdingiz");
      }
    }
    const perPhone = await this.limiter.hit(`login:phone:${phone}`, LOGIN_PHONE_WINDOW_SECONDS);
    if (perPhone.count > LOGIN_PHONE_MAX_ATTEMPTS) {
      throw new DomainError('RATE_LIMITED', "So'rovlar chegarasiga yetdingiz");
    }

    const user = await this.prisma.user.findUnique({ where: { phone } });
    // `passwordHash` NULL — hali register/reset qilinmagan eski hisob
    // (bo'lim 25/26): xuddi "topilmadi"dek ko'rinadi, `Parolni unutdim`
    // orqali tiklanadi.
    const passwordOk =
      user?.passwordHash != null
        ? await this.hash.verify(user.passwordHash, password)
        : await this.hash.verify(await this.getDummyHash(), password);
    if (!user || !passwordOk) {
      throw new UnauthenticatedError("Telefon raqami yoki parol noto'g'ri", 'INVALID_CREDENTIALS');
    }

    // Bo'lim 13 — to'g'ri parol bo'lsa ham bloklangan/vaqtincha cheklangan
    // hisob kirolmaydi (`AccountStatusGuard` bilan bir xil siyosat — u
    // faqat POST-auth marshrutlarda ishlaydi, login esa undan OLDIN).
    if (user.status === 'BLOCKED') {
      throw new ForbiddenError('Hisob bloklangan', 'ACCOUNT_BLOCKED');
    }
    if (user.status === 'SUSPENDED') {
      const expired = user.suspendedUntil !== null && user.suspendedUntil <= new Date();
      if (!expired) {
        throw new ForbiddenError('Hisob vaqtincha cheklangan', 'ACCOUNT_SUSPENDED');
      }
      await this.prisma.user.updateMany({
        where: { id: user.id, status: 'SUSPENDED', suspendedUntil: user.suspendedUntil },
        data: { status: 'ACTIVE', suspendedUntil: null, statusReason: null, statusChangedAt: new Date() },
      });
    }

    const activeRole = user.roleChosen ? (user.lastActiveRole ?? null) : null;
    return this.issueSession(user.id, activeRole, {
      roleChosen: user.roleChosen,
      profileDone: user.profileDone,
      isNewUser: false,
      meta,
      expectedPasswordHash: user.passwordHash!,
    });
  }

  /* ── FORGOT PASSWORD — telefon → SMS OTP → grant → yangi parol ──────── */

  /**
   * Bo'lim 15/16 — enumeration-safe VA SMS-tejamkor: noma'lum telefon
   * uchun HAM bir xil javob, lekin haqiqiy SMS yuborilmaydi (`skipDelivery`)
   * — rate-limit esa baribir TO'LIQ qo'llanadi (`OtpService.requestOtp`
   * ichida, mavjudlikdan qat'i nazar), aks holda "cheklovga tegmayapti"
   * o'zi signal bo'lardi.
   */
  async requestPasswordResetOtp(rawPhone: string, ip?: string): Promise<{ devOtp?: string }> {
    let phone: string;
    try {
      phone = normalizePhone(rawPhone);
    } catch {
      return this.otp.requestOtp(rawPhone, 'PASSWORD_RESET', { ip, skipDelivery: true });
    }
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    return this.otp.requestOtp(phone, 'PASSWORD_RESET', { ip, skipDelivery: !user });
  }

  /** OTP valid bo'lsa User TOPILISHI SHART (aks holda `skipDelivery` tufayli
      real OTP qatori umuman yaratilmagan bo'lardi — bu holat `verifyOtp`
      darajasida allaqachon INVALID_CODE bilan yopiladi). */
  async verifyPasswordResetOtp(rawPhone: string, code: string, ip?: string): Promise<{ resetToken: string }> {
    await this.enforceVerifyOtpIpLimit(ip);
    const { phone } = await this.otp.verifyOtp(rawPhone, code, 'PASSWORD_RESET');
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      // Kamdan-kam holat: OTP so'ralgandan keyin hisob o'chirilgan. Boshqa
      // har qanday xato bilan bir xil generic javob.
      throw new UnauthenticatedError('Muddati tugagan yoki noto‘g‘ri so‘rov — qaytadan boshlang', 'TOKEN_EXPIRED');
    }
    const resetToken = await this.grants.issue('PASSWORD_RESET', phone, user.id);
    return { resetToken };
  }

  /**
   * Bo'lim 20 — ATOMIK: parol yangilanadi + BARCHA mavjud refresh
   * sessiyalar bekor qilinadi (eski telefon/laptop faol qolmasin) + audit
   * yozuvi — bitta tranzaksiyada. Grant CAS-iste'moli allaqachon
   * `consume()`da bo'lgan (tranzaksiyadan TASHQARIDA, chunki u o'z
   * CAS-shartiga ega — lekin muvaffaqiyatsiz tranzaksiya grant'ni
   * "yoqib" qo'ygan bo'lsa ham xavfsiz, chunki natija baribir "qaytadan
   * so'rang").
   */
  async completePasswordReset(resetToken: string, password: string, confirmPassword: string): Promise<void> {
    assertPasswordsMatch(password, confirmPassword);
    const { userId } = await this.grants.consume(resetToken, 'PASSWORD_RESET');
    if (!userId) {
      throw new UnauthenticatedError('Muddati tugagan yoki noto‘g‘ri so‘rov — qaytadan boshlang', 'TOKEN_EXPIRED');
    }
    const passwordHash = await this.hash.hash(password);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actor: { id: userId, type: 'USER', name: user.fullName ?? user.phone },
          action: 'USER_PASSWORD_RESET',
          resourceType: 'USER',
          resourceId: userId,
        },
        tx,
      );
    });
  }

  /**
   * Bosqich 21, bo'lim 44 — logged-in foydalanuvchi uchun (joriy parolni
   * bilgan holda) parol almashtirish. `Parolni unutdim` (recovery)dan
   * FARQLI — hozirgi sessiya (va boshqa qurilmalar) BEKOR QILINMAYDI,
   * chunki foydalanuvchi allaqachon autentifikatsiyalangan va bu yerda
   * shubhali "kompromess" belgisi yo'q.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const currentOk = user.passwordHash
      ? await this.hash.verify(user.passwordHash, currentPassword)
      : await this.hash.verify(await this.getDummyHash(), currentPassword);
    if (!currentOk) {
      throw new UnauthenticatedError("Joriy parol noto'g'ri", 'INVALID_CURRENT_PASSWORD');
    }
    const passwordHash = await this.hash.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  /* ── Sessiya (o'zgarmagan) ────────────────────────────────────────────── */

  async refresh(rawRefreshToken: string, meta?: RequestMeta): Promise<AuthResult> {
    const { raw, record } = await this.refreshTokens.rotate(rawRefreshToken, meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    if (user.status === 'BLOCKED') {
      throw new ForbiddenError('Hisob bloklangan', 'ACCOUNT_BLOCKED');
    }
    const accessToken = this.tokens.signAccessToken({
      sub: record.userId,
      activeRole: record.activeRole,
      familyId: record.familyId,
    });
    return {
      accessToken,
      refreshToken: raw,
      activeRole: record.activeRole,
      roleChosen: user.roleChosen,
      profileDone: user.profileDone,
      isNewUser: false,
    };
  }

  async logout(rawRefreshToken: string, userId?: string): Promise<void> {
    await this.refreshTokens.revokeByRawToken(rawRefreshToken, userId);
  }

  async logoutAllDevices(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  /** `POST /me/roles/choose` — FAQAT birinchi marta. */
  async chooseRole(current: AccessTokenPayload, role: Role): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.sub } });
    if (user.roleChosen) {
      throw new DomainError('BAD_STATE', "Siz allaqachon rol tanlagansiz. Rolni o'zgartirish mumkin emas");
    }

    const claimed = await this.prisma.user.updateMany({
      where: { id: current.sub, roleChosen: false },
      data: { roles: [role], roleChosen: true, lastActiveRole: role },
    });
    if (claimed.count !== 1) {
      throw new DomainError('BAD_STATE', "Siz allaqachon rol tanlagansiz. Rolni o'zgartirish mumkin emas");
    }

    // Onboarding (rol-tanlanmagan) sessiyasini yopamiz — endi kerak emas.
    await this.refreshTokens.revokeFamily(current.familyId);

    return this.issueSession(user.id, role, {
      roleChosen: true,
      profileDone: user.profileDone,
      isNewUser: false,
      meta: undefined,
    });
  }

  /** `POST /me/roles/switch` — foydalanuvchi ALLAQACHON ega bo'lgan rolga. Eski sessiya BEKOR QILINMAYDI (parallel kabinet). */
  async switchRole(current: AccessTokenPayload, role: Role, meta?: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.sub } });
    if (!user.roles.includes(role)) {
      throw new ForbiddenError("Bu rolga ega emassiz", 'NOT_ALLOWED');
    }

    await this.prisma.user.update({
      where: { id: current.sub },
      data: { lastActiveRole: role },
    });

    return this.issueSession(user.id, role, {
      roleChosen: true,
      profileDone: user.profileDone,
      isNewUser: false,
      meta,
    });
  }

  private async issueSession(
    userId: string,
    activeRole: Role | null,
    opts: { roleChosen: boolean; profileDone: boolean; isNewUser: boolean; meta?: RequestMeta; expectedPasswordHash?: string },
  ): Promise<AuthResult> {
    const { raw, record } = await this.refreshTokens.issue({ userId, activeRole, meta: opts.meta, expectedPasswordHash: opts.expectedPasswordHash });
    const accessToken = this.tokens.signAccessToken({
      sub: userId,
      activeRole: record.activeRole,
      familyId: record.familyId,
    });
    return {
      accessToken,
      refreshToken: raw,
      activeRole: record.activeRole,
      roleChosen: opts.roleChosen,
      profileDone: opts.profileDone,
      isNewUser: opts.isNewUser,
    };
  }
}
