import { renderTextUpText, deriveTextUpSmsName, deriveTextUpTemplateId } from './textup-text.util';
import { OTP_SMS_TEMPLATE } from '@/modules/auth/constants/otp.constants';
import { DomainError } from '@/common/errors/domain-error';

describe('renderTextUpText', () => {
  it('purpose=REGISTER (yoki berilmasa) — HAQIQATDA tasdiqlangan ("active") shablon matni', () => {
    expect(renderTextUpText(OTP_SMS_TEMPLATE, { code: '123456', purpose: 'REGISTER' })).toBe(
      "BOBODODA saytida ro'yxatdan o'tish uchun tasdiqlash kodi: 123456",
    );
    expect(renderTextUpText(OTP_SMS_TEMPLATE, { code: '123456' })).toBe(
      "BOBODODA saytida ro'yxatdan o'tish uchun tasdiqlash kodi: 123456",
    );
  });

  it('purpose=PASSWORD_RESET — HAQIQATDA tasdiqlangan ("active") shablon matni', () => {
    expect(renderTextUpText(OTP_SMS_TEMPLATE, { code: '654321', purpose: 'PASSWORD_RESET' })).toBe(
      'BOBODODA saytida parolni tiklash uchun tasdiqlash kodi: 654321',
    );
  });

  it('code yo‘q bo‘lsa DomainError', () => {
    expect(() => renderTextUpText(OTP_SMS_TEMPLATE, {})).toThrow(DomainError);
  });

  it('boshqa shablon (Outbox) — tayyor message qatorini qaytaradi', () => {
    expect(renderTextUpText('some_event', { message: 'tayyor matn' })).toBe('tayyor matn');
  });

  it('boshqa shablon, message yo‘q — DomainError', () => {
    expect(() => renderTextUpText('some_event', {})).toThrow(DomainError);
  });
});

describe('deriveTextUpSmsName', () => {
  it('OTP, purpose=REGISTER (yoki berilmasa) — "BOBODODA Registration OTP"', () => {
    expect(deriveTextUpSmsName(OTP_SMS_TEMPLATE, { code: '1', purpose: 'REGISTER' })).toBe('BOBODODA Registration OTP');
    expect(deriveTextUpSmsName(OTP_SMS_TEMPLATE, { code: '1' })).toBe('BOBODODA Registration OTP');
  });

  it('OTP, purpose=PASSWORD_RESET — "BOBODODA Password Reset OTP"', () => {
    expect(deriveTextUpSmsName(OTP_SMS_TEMPLATE, { code: '1', purpose: 'PASSWORD_RESET' })).toBe('BOBODODA Password Reset OTP');
  });

  it('boshqa shablon (Outbox) — hodisa turi nomi', () => {
    expect(deriveTextUpSmsName('some_event', { message: 'x' })).toBe('some_event');
  });
});

describe('deriveTextUpTemplateId', () => {
  const config = { registrationTemplateId: 'reg-tpl-1', passwordResetTemplateId: 'pwd-tpl-1' };

  it('OTP, purpose=REGISTER — registrationTemplateId', () => {
    expect(deriveTextUpTemplateId(OTP_SMS_TEMPLATE, { code: '1', purpose: 'REGISTER' }, config)).toBe('reg-tpl-1');
  });

  it('OTP, purpose=PASSWORD_RESET — passwordResetTemplateId', () => {
    expect(deriveTextUpTemplateId(OTP_SMS_TEMPLATE, { code: '1', purpose: 'PASSWORD_RESET' }, config)).toBe('pwd-tpl-1');
  });

  it('OTP, config bo‘sh (masalan sandbox) — undefined', () => {
    expect(deriveTextUpTemplateId(OTP_SMS_TEMPLATE, { code: '1', purpose: 'REGISTER' }, {})).toBeUndefined();
  });

  it('boshqa shablon (Outbox) — har doim undefined', () => {
    expect(deriveTextUpTemplateId('some_event', { message: 'x' }, config)).toBeUndefined();
  });
});
