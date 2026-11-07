import { Logger } from '@nestjs/common';
import { TextUpProvider } from './textup.provider';
import { OTP_SMS_TEMPLATE } from '@/modules/auth/constants/otp.constants';

const CONFIG = {
  authUrl: 'https://api-auth.textup.uz/v1/login',
  smsUrl: 'https://sms-api.textup.uz/v1/send',
  email: 'test@textup.uz',
  password: 'test-password',
};

const LOGIN_OK = () =>
  new Response(JSON.stringify({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1', user: { id: 'runtime-user-1' } }), {
    status: 200,
  });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** `fetch` chaqiruvlarini navbat bo'yicha javob qaytaradigan mock qurish uchun. */
function fetchSequence(...responses: Array<Response | (() => Response)>): jest.Mock {
  let i = 0;
  return jest.fn().mockImplementation(async () => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return typeof next === 'function' ? next() : next;
  });
}

describe('TextUpProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('muvaffaqiyatli yuborish — login + Bearer + runtime userId + to‘g‘ri send tanasi, smsId qaytadi', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(200, { smsId: 'sms-abc-1' }));
    global.fetch = fetchMock;

    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', OTP_SMS_TEMPLATE, { code: '111222', purpose: 'REGISTER' });

    expect(result).toEqual({ success: true, providerMessageId: 'sms-abc-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [loginUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe(CONFIG.authUrl);

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe(CONFIG.smsUrl);
    expect(sendInit.headers).toMatchObject({ Authorization: 'Bearer access-token-1', 'Content-Type': 'application/json' });
    const body = JSON.parse(sendInit.body as string);
    // userId — runtime login javobidan (user.id), config'dan EMAS.
    expect(body.userId).toBe('runtime-user-1');
    expect(body.recipients).toEqual(['+998901234567']);
    expect(body.message).toBe("BOBODODA saytida ro'yxatdan o'tish uchun tasdiqlash kodi: 111222");
    expect(body.name).toBe('BOBODODA Registration OTP');
    expect(body.templateId).toBeUndefined();
    expect(body.nicknameId).toBeUndefined();
  });

  it('purpose=PASSWORD_RESET — mos matn va name yuboriladi', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(200, { smsId: 'sms-2' }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    await provider.send('+998901234567', OTP_SMS_TEMPLATE, { code: '999888', purpose: 'PASSWORD_RESET' });
    const [, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(sendInit.body as string);
    expect(body.message).toBe('BOBODODA saytida parolni tiklash uchun tasdiqlash kodi: 999888');
    expect(body.name).toBe('BOBODODA Password Reset OTP');
  });

  it('moderatsiya tasdiqlangach: registrationTemplateId sozlangan bo‘lsa — templateId qo‘shiladi', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(200, { smsId: 'sms-3' }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider({ ...CONFIG, registrationTemplateId: 'reg-tpl-1', passwordResetTemplateId: 'pwd-tpl-1' });
    await provider.send('+998901234567', OTP_SMS_TEMPLATE, { code: '1', purpose: 'REGISTER' });
    const [, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(sendInit.body as string);
    expect(body.templateId).toBe('reg-tpl-1');
  });

  it('moderatsiya tasdiqlangach: passwordResetTemplateId sozlangan bo‘lsa — mos templateId qo‘shiladi', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(200, { smsId: 'sms-4' }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider({ ...CONFIG, registrationTemplateId: 'reg-tpl-1', passwordResetTemplateId: 'pwd-tpl-1' });
    await provider.send('+998901234567', OTP_SMS_TEMPLATE, { code: '1', purpose: 'PASSWORD_RESET' });
    const [, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(sendInit.body as string);
    expect(body.templateId).toBe('pwd-tpl-1');
  });

  it('TEXTUP_NICKNAME_ID sozlangan bo‘lsa — nicknameId qo‘shiladi', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(200, { smsId: 'sms-5' }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider({ ...CONFIG, nicknameId: 'approved-nick-1' });
    await provider.send('+998901234567', 'X', { message: 'test' });
    const [, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(sendInit.body as string);
    expect(body.nicknameId).toBe('approved-nick-1');
  });

  it('ikkinchi send() chaqiruvi qayta login QILMAYDI (token keshlanadi)', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(200, { smsId: 's1' }), jsonResponse(200, { smsId: 's2' }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    await provider.send('+998901234567', 'X', { message: 'a' });
    await provider.send('+998901234567', 'X', { message: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 login + 2 send
  });

  it('login muvaffaqiyatsiz (401) — permanent:true, send chaqirilmaydi', async () => {
    const fetchMock = fetchSequence(new Response('unauthorized', { status: 401 }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result).toEqual({ success: false, errorMessage: 'SMS provider avtorizatsiyasi xato', permanent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('send 401 — invalidate + qayta login + BIR MARTA qayta urinish, ikkinchisi muvaffaqiyatli', async () => {
    const fetchMock = fetchSequence(
      LOGIN_OK, // 1-login
      new Response('token expired', { status: 401 }), // 1-send -> 401
      LOGIN_OK, // 2-login (qayta)
      jsonResponse(200, { smsId: 'sms-retry-ok' }), // 2-send -> muvaffaqiyat
    );
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result).toEqual({ success: true, providerMessageId: 'sms-retry-ok' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('ikkinchi 401 ham kelsa — muvaffaqiyatsiz, cheksiz aylanma YO‘Q (jami 4 chaqiruv)', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, new Response('', { status: 401 }), LOGIN_OK, new Response('', { status: 401 }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result).toEqual({ success: false, errorMessage: 'SMS provider avtorizatsiyasi xato', permanent: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('400 (Bad Request) — permanent:true', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, jsonResponse(400, { error: 'invalid recipients' }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result.success).toBe(false);
    expect(result.permanent).toBe(true);
  });

  it('5xx — RETRYABLE (permanent berilmaydi)', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, new Response('internal error', { status: 500 }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result.success).toBe(false);
    expect(result.permanent).toBeUndefined();
  });

  it('send timeout/tarmoq xatosi — RETRYABLE (permanent berilmaydi), qayta yuborilmaydi', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(LOGIN_OK())
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result.success).toBe(false);
    expect(result.permanent).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // login + BITTA send urinish (timeout'da qayta yuborilmadi)
  });

  it('malformed send javobi (200 lekin JSON emas/smsId yo‘q) — hali ham success:true', async () => {
    const fetchMock = fetchSequence(LOGIN_OK, new Response('not json{{{', { status: 200 }));
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    const result = await provider.send('+998901234567', 'X', { message: 'test' });
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBeUndefined();
  });

  it('yaroqsiz qabul qiluvchi (UZ formatiga mos emas) — HTTP chaqiruvisiz DomainError', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const provider = new TextUpProvider(CONFIG);
    await expect(provider.send('+77012345678', 'X', { message: 'test' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parol/accessToken/refreshToken/Authorization hech qachon loglanmaydi', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const fetchMock = fetchSequence(LOGIN_OK, new Response('unauthorized', { status: 401 }), LOGIN_OK, new Response('', { status: 401 }));
    global.fetch = fetchMock;

    const provider = new TextUpProvider(CONFIG);
    await provider.send('+998901234567', 'X', { message: 'test' });

    const allLoggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();
    for (const arg of allLoggedArgs) {
      const serialized = JSON.stringify(arg);
      expect(serialized).not.toContain(CONFIG.password);
      expect(serialized).not.toContain('access-token-1');
      expect(serialized).not.toContain('refresh-token-1');
      expect(serialized).not.toContain('Bearer');
    }
  });
});
