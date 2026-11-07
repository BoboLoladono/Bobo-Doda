import { Prisma, type User } from '@prisma/client';
import { AuthService } from './auth.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { IdFactory } from '@/common/id/id.factory';
import type { HashService } from '@/common/security/hash.service';
import type { RateLimiterService } from '@/common/security/rate-limiter.service';
import type { AuditService } from '@/common/audit/audit.service';
import type { OtpService } from './otp.service';
import type { AuthGrantService } from './auth-grant.service';
import type { TokenService } from './token.service';
import type { RefreshTokenService } from './refresh-token.service';

/**
 * Bosqich 21 — parol bilan login. Bu fayl `AuthService`ning O'Z filial
 * mantig'ini real Postgres/Redis'siz sinaydi: `OtpService`/`AuthGrantService`
 * FAKE qilinadi (ular allaqachon o'zlarining chegaralarida — bo'lsa —
 * sinaladi), `HashService` esa deterministik fake (tez, real argon2id emas)
 * — haqiqiy kriptografik xossalar `common/security/*.spec.ts` va real e2e
 * darajasida tekshiriladi.
 */

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    phone: '+998901234567',
    passwordHash: 'hashed:correct-password',
    fullName: null,
    roleChosen: false,
    profileDone: false,
    lastActiveRole: null,
    status: 'ACTIVE',
    suspendedUntil: null,
    ...overrides,
  } as unknown as User;
}

function fakeHash(): HashService {
  return {
    hash: jest.fn(async (plain: string) => `hashed:${plain}`),
    verify: jest.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
  };
}

function buildService(opts: {
  findUniqueResult?: User | null;
  createImpl?: () => Promise<User>;
  otpRequestImpl?: () => Promise<{ devOtp?: string }>;
  otpVerifyImpl?: () => Promise<{ phone: string }>;
  grantIssueImpl?: () => Promise<string>;
  grantConsumeImpl?: () => Promise<{ phone: string; userId: string | null }>;
  hitImpl?: (key: string) => Promise<{ count: number }>;
} = {}) {
  const findUnique = jest.fn(async () => opts.findUniqueResult ?? null);
  const create = jest.fn(opts.createImpl ?? (async () => fakeUser()));
  const update = jest.fn(async () => fakeUser());
  const updateMany = jest.fn(async () => ({ count: 1 }));
  const txUser = { update };
  const txRefreshToken = { updateMany: jest.fn(async () => ({ count: 0 })) };
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ user: txUser, refreshToken: txRefreshToken }),
  );
  const prisma = {
    user: { findUnique, create, update, updateMany },
    $transaction,
  } as unknown as PrismaService;

  const ids = { next: jest.fn(() => 'new-id') } as unknown as IdFactory;
  const hash = fakeHash();
  const hit = jest.fn(opts.hitImpl ?? (async () => ({ count: 1 })));
  const limiter = { hit, cooldown: jest.fn(async () => true) } as unknown as RateLimiterService;
  const auditRecord = jest.fn(async () => undefined);
  const audit = { record: auditRecord } as unknown as AuditService;
  const otp = {
    requestOtp: jest.fn(opts.otpRequestImpl ?? (async () => ({}))),
    verifyOtp: jest.fn(opts.otpVerifyImpl ?? (async () => ({ phone: '+998901234567' }))),
  } as unknown as OtpService;
  const grants = {
    issue: jest.fn(opts.grantIssueImpl ?? (async () => 'grant-raw-token')),
    consume: jest.fn(opts.grantConsumeImpl ?? (async () => ({ phone: '+998901234567', userId: null }))),
  } as unknown as AuthGrantService;
  const tokens = { signAccessToken: jest.fn(() => 'access-token') } as unknown as TokenService;
  const refreshTokens = {
    issue: jest.fn(async (params: { activeRole: string | null }) => ({
      raw: 'refresh-raw',
      record: { familyId: 'fam-1', activeRole: params.activeRole },
    })),
  } as unknown as RefreshTokenService;

  const service = new AuthService(prisma, ids, hash, limiter, audit, otp, grants, tokens, refreshTokens);
  return { service, prisma, hash, limiter, audit, otp, grants, findUnique, create, update, hit, auditRecord, txRefreshToken };
}

describe('AuthService — parol bilan login (Bosqich 21)', () => {
  describe('register', () => {
    it('requestRegisterOtp — OtpService.requestOtp REGISTER maqsadi bilan chaqiriladi', async () => {
      const { service, otp } = buildService();
      await service.requestRegisterOtp('+998901234567', '1.2.3.4');
      expect(otp.requestOtp).toHaveBeenCalledWith('+998901234567', 'REGISTER', { ip: '1.2.3.4' });
    });

    it('requestRegisterOtp — OtpService devOtp qaytarsa, chaqiruvchiga shu holicha uzatiladi', async () => {
      const { service } = buildService({ otpRequestImpl: async () => ({ devOtp: '532123' }) });
      const res = await service.requestRegisterOtp('+998901234567', '1.2.3.4');
      expect(res).toEqual({ devOtp: '532123' });
    });

    it('requestRegisterOtp — OtpService devOtp qaytarmasa (production/PLAYMOBILE), bo‘sh natija', async () => {
      const { service } = buildService({ otpRequestImpl: async () => ({}) });
      const res = await service.requestRegisterOtp('+998901234567', '1.2.3.4');
      expect(res).toEqual({});
    });

    it('verifyRegisterOtp — OTP valid bo‘lsa grant chiqaradi, User YARATILMAYDI', async () => {
      const { service, grants, create } = buildService();
      const result = await service.verifyRegisterOtp('+998901234567', '123456');
      expect(result.registrationToken).toBe('grant-raw-token');
      expect(grants.issue).toHaveBeenCalledWith('REGISTER', '+998901234567');
      expect(create).not.toHaveBeenCalled();
    });

    it('completeRegistration — grant+parol mos bo‘lsa User yaratiladi, sessiya ochiladi', async () => {
      const created = fakeUser({ id: 'new-id' });
      const { service, create } = buildService({ createImpl: async () => created });

      const result = await service.completeRegistration('grant-token', 'Passw0rd!', 'Passw0rd!');

      expect(result.isNewUser).toBe(true);
      expect(result.activeRole).toBeNull();
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ phone: '+998901234567', passwordHash: 'hashed:Passw0rd!', verified: true }),
      });
    });

    it('completeRegistration — parollar mos emas bo‘lsa VALIDATION, grant iste’mol qilinmaydi', async () => {
      const { service, grants } = buildService();
      await expect(service.completeRegistration('grant-token', 'Passw0rd!', 'Boshqa!')).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      expect(grants.consume).not.toHaveBeenCalled();
    });

    it('completeRegistration — grant eskirgan/noto‘g‘ri bo‘lsa TOKEN_EXPIRED, User yaratilmaydi', async () => {
      const { service, create } = buildService({
        grantConsumeImpl: async () => {
          throw Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED' });
        },
      });
      await expect(service.completeRegistration('bad-token', 'Passw0rd!', 'Passw0rd!')).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    });

    it('completeRegistration — telefon allaqachon mavjud (P2002) → PHONE_EXISTS', async () => {
      const { service, create } = buildService({
        createImpl: async () => {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        },
      });
      await expect(service.completeRegistration('grant-token', 'Passw0rd!', 'Passw0rd!')).rejects.toMatchObject({
        code: 'PHONE_EXISTS',
      });
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('login', () => {
    it('to‘g‘ri telefon+parol — sessiya qaytaradi, SMS/OTP HECH QACHON chaqirilmaydi', async () => {
      const existing = fakeUser({ roleChosen: true, lastActiveRole: 'BUYER', passwordHash: 'hashed:Passw0rd!' });
      const { service, otp, hit } = buildService({ findUniqueResult: existing });

      const result = await service.login('+998901234567', 'Passw0rd!', { ip: '1.2.3.4' });

      expect(result.isNewUser).toBe(false);
      expect(result.activeRole).toBe('BUYER');
      expect(otp.requestOtp).not.toHaveBeenCalled();
      expect(otp.verifyOtp).not.toHaveBeenCalled();
      expect(hit).toHaveBeenCalledWith('login:ip:1.2.3.4', expect.any(Number));
      expect(hit).toHaveBeenCalledWith('login:phone:+998901234567', expect.any(Number));
    });

    it('login — prefikssiz telefon (901234567) normallashtirilib foydalanuvchi topiladi', async () => {
      const existing = fakeUser({ roleChosen: true, lastActiveRole: 'BUYER', passwordHash: 'hashed:Passw0rd!' });
      const { service, findUnique } = buildService({ findUniqueResult: existing });
      const result = await service.login('901234567', 'Passw0rd!');
      expect(result.accessToken).toBe('access-token');
      expect(findUnique).toHaveBeenCalledWith({ where: { phone: '+998901234567' } });
    });

    it('noto‘g‘ri parol — INVALID_CREDENTIALS', async () => {
      const existing = fakeUser({ passwordHash: 'hashed:Passw0rd!' });
      const { service } = buildService({ findUniqueResult: existing });
      await expect(service.login('+998901234567', 'Wrong!', {})).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('mavjud bo‘lmagan telefon — HAM INVALID_CREDENTIALS (enumeration-safe), dummy hash bilan tekshiriladi', async () => {
      const { service, hash } = buildService({ findUniqueResult: null });
      await expect(service.login('+998900000000', 'AnyPass1', {})).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      // Telefon topilmasa ham `hash.verify` chaqirilishi SHART — timing-parity.
      expect(hash.verify).toHaveBeenCalled();
    });

    it('legacy foydalanuvchi (passwordHash=null) — INVALID_CREDENTIALS, dummy hash bilan', async () => {
      const legacy = fakeUser({ passwordHash: null });
      const { service, hash } = buildService({ findUniqueResult: legacy });
      await expect(service.login('+998901234567', 'AnyPass1', {})).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(hash.verify).toHaveBeenCalled();
    });

    it('bloklangan hisob — to‘g‘ri parol bo‘lsa ham ACCOUNT_BLOCKED', async () => {
      const blocked = fakeUser({ passwordHash: 'hashed:Passw0rd!', status: 'BLOCKED' });
      const { service } = buildService({ findUniqueResult: blocked });
      await expect(service.login('+998901234567', 'Passw0rd!', {})).rejects.toMatchObject({
        code: 'ACCOUNT_BLOCKED',
      });
    });

    it('vaqtincha cheklangan (SUSPENDED, muddati o‘tmagan) — ACCOUNT_SUSPENDED', async () => {
      const suspended = fakeUser({
        passwordHash: 'hashed:Passw0rd!',
        status: 'SUSPENDED',
        suspendedUntil: new Date(Date.now() + 60_000),
      });
      const { service } = buildService({ findUniqueResult: suspended });
      await expect(service.login('+998901234567', 'Passw0rd!', {})).rejects.toMatchObject({
        code: 'ACCOUNT_SUSPENDED',
      });
    });

    it('vaqtincha cheklangan, muddati O‘TGAN — avtomatik ACTIVE, login o‘tadi', async () => {
      const expired = fakeUser({
        passwordHash: 'hashed:Passw0rd!',
        status: 'SUSPENDED',
        suspendedUntil: new Date(Date.now() - 60_000),
      });
      const { service } = buildService({ findUniqueResult: expired });
      const result = await service.login('+998901234567', 'Passw0rd!', {});
      expect(result.accessToken).toBe('access-token');
    });

    it('login rate limit — telefon oynasi to‘lsa RATE_LIMITED, parol UMUMAN tekshirilmaydi', async () => {
      const { service, hash } = buildService({ hitImpl: async () => ({ count: 999 }) });
      await expect(service.login('+998901234567', 'AnyPass1', { ip: '1.2.3.4' })).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(hash.verify).not.toHaveBeenCalled();
    });
  });

  describe('password reset', () => {
    it('requestPasswordResetOtp — mavjud foydalanuvchi uchun skipDelivery=false', async () => {
      const { service, otp } = buildService({ findUniqueResult: fakeUser() });
      await service.requestPasswordResetOtp('+998901234567', '1.2.3.4');
      expect(otp.requestOtp).toHaveBeenCalledWith('+998901234567', 'PASSWORD_RESET', {
        ip: '1.2.3.4',
        skipDelivery: false,
      });
    });

    it('requestPasswordResetOtp — OtpService devOtp qaytarsa, chaqiruvchiga shu holicha uzatiladi', async () => {
      const { service } = buildService({
        findUniqueResult: fakeUser(),
        otpRequestImpl: async () => ({ devOtp: '841920' }),
      });
      const res = await service.requestPasswordResetOtp('+998901234567', '1.2.3.4');
      expect(res).toEqual({ devOtp: '841920' });
    });

    it('requestPasswordResetOtp — noma’lum telefon uchun skipDelivery=true (SMS tejash), javob bir xil', async () => {
      const { service, otp } = buildService({ findUniqueResult: null });
      await service.requestPasswordResetOtp('+998900000000');
      expect(otp.requestOtp).toHaveBeenCalledWith('+998900000000', 'PASSWORD_RESET', {
        ip: undefined,
        skipDelivery: true,
      });
    });

    it('requestPasswordResetOtp — prefikssiz telefon (901234567) normallashtirilib izlanadi va skipDelivery=false bo‘ladi', async () => {
      const { service, otp } = buildService({ findUniqueResult: fakeUser() });
      await service.requestPasswordResetOtp('901234567', '1.2.3.4');
      expect(otp.requestOtp).toHaveBeenCalledWith('+998901234567', 'PASSWORD_RESET', {
        ip: '1.2.3.4',
        skipDelivery: false,
      });
    });

    it('requestPasswordResetOtp — noto‘g‘ri formatdagi telefon uchun ham OtpService ga skipDelivery=true bilan uzatiladi', async () => {
      const { service, otp } = buildService({ findUniqueResult: null });
      await service.requestPasswordResetOtp('invalid-phone', '1.2.3.4');
      expect(otp.requestOtp).toHaveBeenCalledWith('invalid-phone', 'PASSWORD_RESET', {
        ip: '1.2.3.4',
        skipDelivery: true,
      });
    });

    it('verifyPasswordResetOtp — OTP valid + User mavjud → grant userId bilan chiqariladi', async () => {
      const user = fakeUser({ id: 'user-42' });
      const { service, grants } = buildService({ findUniqueResult: user });
      const result = await service.verifyPasswordResetOtp('+998901234567', '123456');
      expect(result.resetToken).toBe('grant-raw-token');
      expect(grants.issue).toHaveBeenCalledWith('PASSWORD_RESET', '+998901234567', 'user-42');
    });

    it('completePasswordReset — parol yangilanadi, BARCHA sessiya bekor qilinadi, audit yoziladi', async () => {
      const { service, txRefreshToken, auditRecord } = buildService({
        grantConsumeImpl: async () => ({ phone: '+998901234567', userId: 'user-1' }),
      });
      await service.completePasswordReset('reset-token', 'NewPass1!', 'NewPass1!');
      expect(txRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_PASSWORD_RESET', resourceId: 'user-1' }),
        expect.anything(),
      );
    });

    it('completePasswordReset — parollar mos emas bo‘lsa VALIDATION, grant iste’mol qilinmaydi', async () => {
      const { service, grants } = buildService();
      await expect(service.completePasswordReset('reset-token', 'A1234567', 'B1234567')).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      expect(grants.consume).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('logout — rawRefreshToken bilan refreshTokens.revokeByRawToken chaqiriladi (userIdsiz)', async () => {
      const { service } = buildService();
      const revokeSpy = jest.fn(async () => undefined);
      (service as unknown as { refreshTokens: { revokeByRawToken: typeof revokeSpy } }).refreshTokens.revokeByRawToken = revokeSpy;
      await service.logout('raw-token-123');
      expect(revokeSpy).toHaveBeenCalledWith('raw-token-123', undefined);
    });

    it('logout — userId berilganda ham refreshTokens.revokeByRawToken ga uzatiladi', async () => {
      const { service } = buildService();
      const revokeSpy = jest.fn(async () => undefined);
      (service as unknown as { refreshTokens: { revokeByRawToken: typeof revokeSpy } }).refreshTokens.revokeByRawToken = revokeSpy;
      await service.logout('raw-token-123', 'user-456');
      expect(revokeSpy).toHaveBeenCalledWith('raw-token-123', 'user-456');
    });
  });
});
