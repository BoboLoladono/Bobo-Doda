import { Logger } from '@nestjs/common';
import type { SmsProvider, SmsSendResult } from '../../sms-provider.interface';
import type { TextUpConfig, TextUpSendResponse } from './textup.types';
import { TextUpTokenManager } from './textup-token-manager';
import { toTextUpDestination } from './textup-phone.util';
import { renderTextUpText, deriveTextUpSmsName, deriveTextUpTemplateId } from './textup-text.util';
import { normalizePhone } from '@/common/security/phone.util';

/** SMS so'rovi uchun aniq chegara. */
const REQUEST_TIMEOUT_MS = 10_000;

type SendAttempt =
  | { kind: 'success'; smsId?: string }
  | { kind: 'http-error'; status: number; errorBody?: string }
  | { kind: 'network-error' };

/**
 * Bosqich 23 (v4) — TextUp SMS API, Bobololadono'ning o'z hisobi uchun.
 * `SmsProvider` interfeysini BUZMAYDI — `OtpService`/`OutboxWorkerService`
 * TextUp-specific ID (templateId/nicknameId/userId)ni BILMAYDI, faqat
 * generic `params.purpose` beriladi (bo'lim 15) — TANLASH shu klass
 * ichida bo'ladi.
 *
 * **Auth oqimi**: email/parol bilan login qilinadi, natijadagi
 * `accessToken` + runtime `user.id` (`TextUpTokenManager`da keshlanadi,
 * bir vaqtli chaqiruvlar BITTA login promise'ni baham ko'radi) SMS
 * so'roviga biriktiriladi. 401 kelsa — token BIR MARTA yangilanadi
 * (invalidate → qayta login → qayta urinish); ikkinchi 401 —
 * muvaffaqiyatsiz, cheksiz aylanma YO'Q. Hujjatlashtirilmagan refresh
 * endpoint O'YLAB TOPILMAGAN.
 *
 * **Shablon/nickname hozircha IXTIYORIY** (bo'lim 10/12/14 — bobololadono
 * alpha-nom va ikkala OTP shabloni "Tekshirilmoqda"): konfiguratsiya
 * bo'lmasa `templateId`/`nicknameId` so'rovdan BUTUNLAY chiqarib
 * tashlanadi (`null`/`""` YUBORILMAYDI) — xom `message` bilan, qisqa
 * raqamdan yuboriladi.
 *
 * **Xato tasnifi**: 401 yuqorida alohida ishlanadi (auth). 400 va boshqa
 * hujjatlashtirilmagan 4xx — standart REST konvensiyasi bo'yicha
 * PERMANENT. 5xx/tarmoq xatosi/timeout — RETRYABLE (sukut). Timeout'da
 * ko'r-ko'rona qayta yuborish YO'Q (bo'lim 20) — OTP navbatining o'zi
 * bounded retry siyosatiga qaror qiladi.
 */
export class TextUpProvider implements SmsProvider {
  private readonly logger = new Logger(TextUpProvider.name);
  private readonly tokenManager: TextUpTokenManager;

  constructor(private readonly config: TextUpConfig) {
    this.tokenManager = new TextUpTokenManager(config);
  }

  async send(
    phone: string,
    template: string,
    params: Record<string, string>,
    // `options.reference` TextUp so'rov sxemasida ISHLATILMAYDI.
    _options?: { reference?: string },
  ): Promise<SmsSendResult> {
    const destination = toTextUpDestination(normalizePhone(phone));
    const message = renderTextUpText(template, params);
    const name = deriveTextUpSmsName(template, params);
    const templateId = deriveTextUpTemplateId(template, params, this.config);

    let token;
    try {
      token = await this.tokenManager.getToken();
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'TextUp: login muvaffaqiyatsiz');
      return { success: false, errorMessage: 'SMS provider avtorizatsiyasi xato', permanent: true };
    }

    let attempt = await this.attemptSend(token.accessToken, token.userId, destination, message, name, templateId);

    if (attempt.kind === 'http-error' && attempt.status === 401) {
      // Bo'lim 7 — token eskirgan bo'lishi mumkin: BIR MARTA invalidate + qayta login + qayta urinish.
      this.tokenManager.invalidate();
      try {
        token = await this.tokenManager.getToken();
      } catch (err) {
        this.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'TextUp: qayta login muvaffaqiyatsiz');
        return { success: false, errorMessage: 'SMS provider avtorizatsiyasi xato', permanent: true };
      }
      attempt = await this.attemptSend(token.accessToken, token.userId, destination, message, name, templateId);
      if (attempt.kind === 'http-error' && attempt.status === 401) {
        // Ikkinchi 401 — muvaffaqiyatsiz, cheksiz aylanma YO'Q (bo'lim 7).
        this.logger.error('TextUp: qayta login’dan keyin ham 401 — sozlama tekshirilsin');
        return { success: false, errorMessage: 'SMS provider avtorizatsiyasi xato', permanent: true };
      }
    }

    if (attempt.kind === 'success') {
      return { success: true, providerMessageId: attempt.smsId };
    }
    if (attempt.kind === 'network-error') {
      return { success: false, errorMessage: 'SMS provider bilan bog‘lanib bo‘lmadi' };
    }
    if (attempt.status >= 500) {
      this.logger.warn({ status: attempt.status, errorBody: attempt.errorBody }, 'TextUp: provider server xatosi');
      return { success: false, errorMessage: `SMS provider HTTP ${attempt.status}` };
    }
    this.logger.warn({ status: attempt.status, errorBody: attempt.errorBody }, 'TextUp: xato javob');
    const reason = attempt.errorBody ? ` (${attempt.errorBody})` : '';
    return { success: false, errorMessage: `SMS provider rad etdi (HTTP ${attempt.status})${reason}`, permanent: true };
  }

  private async attemptSend(
    accessToken: string,
    userId: string,
    destination: string,
    message: string,
    name: string,
    templateId: string | undefined,
  ): Promise<SendAttempt> {
    // `recipients` — telefon-raqamlar massivi. `templateId`/`nicknameId`
    // FAQAT sozlangan/tanlangan bo'lsa qo'shiladi (bo'lim 12 — null/"" hech
    // qachon yuborilmaydi).
    const body: Record<string, unknown> = { message, userId, name, recipients: [destination] };
    if (templateId) {
      body.templateId = templateId;
    }
    if (this.config.nicknameId) {
      body.nicknameId = this.config.nicknameId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(this.config.smsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'TextUp: tarmoq xatosi/timeout');
      return { kind: 'network-error' };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {}
      this.logger.warn({ status: response.status, errorBody }, 'TextUp SMS yuborishda xato javob berdi');
      return { kind: 'http-error', status: response.status, errorBody };
    }

    let smsId: string | undefined;
    try {
      const parsed = (await response.json()) as Partial<TextUpSendResponse>;
      if (typeof parsed.smsId === 'string') smsId = parsed.smsId;
    } catch {
      // Status 2xx bo'lsa ham javob JSON emas/smsId yo'q — baribir
      // MUVAFFAQIYAT (HTTP status manba), faqat kuzatuv ID'si yo'qoladi.
    }
    return { kind: 'success', smsId };
  }
}
