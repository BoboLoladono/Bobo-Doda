import { Logger } from '@nestjs/common';
import { TextUpTokenManager } from './textup-token-manager';

const CONFIG = {
  authUrl: 'https://api-auth.textup.uz/v1/login',
  smsUrl: 'https://sms-api.textup.uz/v1/send',
  email: 'test@textup.uz',
  password: 'test-password',
};

function loginResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('TextUpTokenManager', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('login URL/payload to‘g‘ri, accessToken/userId (runtime user.id) keshlanadi', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      loginResponse(200, { accessToken: 'access-abc', refreshToken: 'refresh-xyz', user: { id: 'runtime-user-1', status: 'active' } }),
    );
    global.fetch = fetchMock;

    const manager = new TextUpTokenManager(CONFIG);
    const token = await manager.getToken();

    expect(token).toEqual({ accessToken: 'access-abc', userId: 'runtime-user-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.authUrl);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ email: CONFIG.email, password: CONFIG.password });
  });

  it('ikkinchi getToken() qayta login QILMAYDI (keshdan qaytadi)', async () => {
    const fetchMock = jest.fn().mockImplementation(async () =>
      loginResponse(200, { accessToken: 'access-abc', user: { id: 'runtime-user-1' } }),
    );
    global.fetch = fetchMock;

    const manager = new TextUpTokenManager(CONFIG);
    await manager.getToken();
    await manager.getToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bo‘lim 6 — bir vaqtda kelgan ko‘p getToken() chaqiruvi BITTA login promise’ni baham ko‘radi', async () => {
    let resolveLogin!: (r: Response) => void;
    const fetchMock = jest.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    global.fetch = fetchMock;

    const manager = new TextUpTokenManager(CONFIG);
    // 10 ta bir vaqtli chaqiruv — hammasi in-flight login promise'ni kutadi.
    const calls = Array.from({ length: 10 }, () => manager.getToken());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveLogin(loginResponse(200, { accessToken: 'access-shared', user: { id: 'runtime-user-1' } }));

    const results = await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r).toEqual({ accessToken: 'access-shared', userId: 'runtime-user-1' });
    }
  });

  it('invalidate() dan keyin qayta login qiladi', async () => {
    const fetchMock = jest.fn().mockImplementation(async () =>
      loginResponse(200, { accessToken: 'access-abc', user: { id: 'runtime-user-1' } }),
    );
    global.fetch = fetchMock;

    const manager = new TextUpTokenManager(CONFIG);
    await manager.getToken();
    manager.invalidate();
    await manager.getToken();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('login muvaffaqiyatsiz bo‘lsa — in-flight promise tozalanadi, keyingi chaqiruv QAYTA urinadi', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(loginResponse(200, { accessToken: 'access-abc', user: { id: 'runtime-user-1' } }));
    global.fetch = fetchMock;

    const manager = new TextUpTokenManager(CONFIG);
    await expect(manager.getToken()).rejects.toThrow();
    const token = await manager.getToken();
    expect(token).toEqual({ accessToken: 'access-abc', userId: 'runtime-user-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('TEXTUP_EXPECTED_USER_ID berilmasa — tekshiruvsiz o‘tadi', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginResponse(200, { accessToken: 'a', user: { id: 'any-user' } }));
    const manager = new TextUpTokenManager(CONFIG);
    await expect(manager.getToken()).resolves.toEqual({ accessToken: 'a', userId: 'any-user' });
  });

  it('TEXTUP_EXPECTED_USER_ID sozlangan va mos kelsa — o‘tadi', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginResponse(200, { accessToken: 'a', user: { id: 'expected-1' } }));
    const manager = new TextUpTokenManager({ ...CONFIG, expectedUserId: 'expected-1' });
    await expect(manager.getToken()).resolves.toEqual({ accessToken: 'a', userId: 'expected-1' });
  });

  it('TEXTUP_EXPECTED_USER_ID sozlangan va runtime user.id number bo‘lsa ham mos kelsa — o‘tadi', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginResponse(200, { accessToken: 'a', user: { id: 82852 as unknown as string } }));
    const manager = new TextUpTokenManager({ ...CONFIG, expectedUserId: '82852' });
    await expect(manager.getToken()).resolves.toEqual({ accessToken: 'a', userId: '82852' });
  });

  it('TEXTUP_EXPECTED_USER_ID sozlangan lekin runtime user.id bilan mos kelmasa — fail closed', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginResponse(200, { accessToken: 'a', user: { id: 'DIFFERENT-USER' } }));
    const manager = new TextUpTokenManager({ ...CONFIG, expectedUserId: 'expected-1' });
    await expect(manager.getToken()).rejects.toThrow(/mos emas/);
  });

  it('401 (login) — xato tashlanadi', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const manager = new TextUpTokenManager(CONFIG);
    await expect(manager.getToken()).rejects.toThrow();
  });

  it('malformed login javobi (accessToken/user.id yo‘q) — xato tashlanadi', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginResponse(200, { foo: 'bar' }));
    const manager = new TextUpTokenManager(CONFIG);
    await expect(manager.getToken()).rejects.toThrow(/accessToken/);
  });

  it('malformed login javobi (JSON emas) — xato tashlanadi', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('not json{{{', { status: 200 }));
    const manager = new TextUpTokenManager(CONFIG);
    await expect(manager.getToken()).rejects.toThrow(/JSON/);
  });

  it('tarmoq xatosi/timeout — xato tashlanadi', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const manager = new TextUpTokenManager(CONFIG);
    await expect(manager.getToken()).rejects.toThrow();
  });

  it('email/parol/accessToken/refreshToken hech qachon loglanmaydi', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    global.fetch = jest.fn().mockResolvedValue(
      loginResponse(200, { accessToken: 'super-secret-token', refreshToken: 'super-secret-refresh', user: { id: 'DIFFERENT' } }),
    );

    const manager = new TextUpTokenManager({ ...CONFIG, expectedUserId: 'expected-1' });
    await manager.getToken().catch(() => undefined);

    const allLoggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();
    for (const arg of allLoggedArgs) {
      const serialized = JSON.stringify(arg);
      expect(serialized).not.toContain(CONFIG.password);
      expect(serialized).not.toContain('super-secret-token');
      expect(serialized).not.toContain('super-secret-refresh');
    }
  });
});
