import { OTP_SMS_TEMPLATE } from '@/modules/auth/constants/otp.constants';
import { DomainError } from '@/common/errors/domain-error';
import type { TextUpConfig } from './textup.types';

/**
 * Bo'lim 11 — matn TextUp moderatsiyasida HAQIQATDA tasdiqlangan matn
 * bilan ANIQ mos kelishi SHART. **2026-09-17: `GET /v1/templates` orqali
 * tasdiqlangan (bo'lim: real API javobi) — bizning DASTLABKI taxmin
 * ("bobololadono tasdiqlash kodi: ...") moderatsiya tomonidan RAD ETILGAN
 * ("Rad etildi: Yo'riqnomadagi Punkt 2 dan foydalanib yozib bering."),
 * o'rniga UZUNROQ, boshqacha ibora tasdiqlangan** — shu YERDA taxmin
 * emas, `status:"active"` shablonning haqiqiy `content`/`verifiedContent`
 * maydonidan olingan. Qisqa (bitta SMS segmenti), parol/JWT/shaxsiy
 * ma'lumot/havola YO'Q.
 */
export function renderTextUpText(template: string, params: Record<string, string>): string {
  if (template === OTP_SMS_TEMPLATE) {
    const code = params.code;
    if (!code) {
      throw new DomainError('INVALID_INPUT', 'OTP SMS uchun "code" parametri yo‘q');
    }
    return params.purpose === 'PASSWORD_RESET'
      ? `BOBODODA saytida parolni tiklash uchun tasdiqlash kodi: ${code}`
      : `BOBODODA saytida ro'yxatdan o'tish uchun tasdiqlash kodi: ${code}`;
  }
  const message = params.message;
  if (!message) {
    throw new DomainError('INVALID_INPUT', `"${template}" uchun "message" parametri yo‘q`);
  }
  return message;
}

/**
 * Bo'lim 16 — TextUp `send` so'rovidagi `name` maydoni: ICHKI operatsion
 * yorliq (kampaniya/partiya nomi).
 */
export function deriveTextUpSmsName(template: string, params: Record<string, string>): string {
  if (template === OTP_SMS_TEMPLATE) {
    return params.purpose === 'PASSWORD_RESET' ? 'BOBODODA Password Reset OTP' : 'BOBODODA Registration OTP';
  }
  return template;
}

/**
 * Bo'lim 10 — IKKITA alohida shablon ID (bitta umumiy EMAS): moderatsiya
 * ro'yxatdan o'tgan har bir SMS matni uchun ALOHIDA tasdiqlanadi. Ikkalasi
 * ham 2026-09-17'da `status:"active"` (tasdiqlangan, `GET /v1/templates`
 * orqali tekshirilgan) — lekin config'da BERILMASA (masalan sandbox/test
 * muhitida) `templateId` so'rovdan BUTUNLAY chiqarib tashlanadi (xom
 * `message` bilan yuboriladi, bo'lim 14) — bu ham TextUp hujjatiga ko'ra
 * TO'G'RI ishlaydi.
 */
export function deriveTextUpTemplateId(
  template: string,
  params: Record<string, string>,
  config: Pick<TextUpConfig, 'registrationTemplateId' | 'passwordResetTemplateId'>,
): string | undefined {
  if (template !== OTP_SMS_TEMPLATE) return undefined;
  return params.purpose === 'PASSWORD_RESET' ? config.passwordResetTemplateId : config.registrationTemplateId;
}
