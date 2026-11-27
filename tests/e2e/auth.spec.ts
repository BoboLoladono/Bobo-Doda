import { test, expect } from "@playwright/test";
import { freshPhone, latestOtpFor, flushOtpCooldown, E2E_PASSWORD, startRegistration } from "./helpers";

/* Bosqich 21 — parol bilan login. SMS FAQAT ro'yxatdan o'tish va parolni
   tiklashda (telefon egaligini isbotlash) — oddiy login uchun SMS UMUMAN
   yuborilmaydi. Bu fayl `globalSetup`dagi saqlangan sessiyalardan
   foydalanmaydi — login/register/forgot-password ekranlarining o'zini
   sinaydi, shuning uchun ATAYLAB `storageState`siz ishlaydi. OTP so'rovlari
   soni ATAYLAB minimal ushlanadi (IP-soatlik chegara budjetini tejash
   uchun) — har bir test aniq nechta so'rov yuborishini yuqorida hisoblab
   qo'ying. */

test("login sahifasi telefon+parol bilan render bo'ladi, OTP formasi YO'Q @blocking", async ({ page }) => {
  await page.goto("/kirish");
  await expect(page.getByText("Tizimga kirish")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /^Kirish$/i })).toBeVisible();
  // Bosqich 20'dagi "Kod yuborish" tugmasi endi login sahifasida YO'Q.
  await expect(page.getByRole("button", { name: /Kod yuborish/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  await expect(page.getByText(/Telegram|Email/i)).toHaveCount(0);
});

test("register sahifasi to'g'ri render bo'ladi @blocking", async ({ page }) => {
  await page.goto("/royxatdan-otish");
  await expect(page.getByRole("button", { name: /Kod yuborish/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
  await expect(page.getByText(/Telegram|Email/i)).toHaveCount(0);
});

/* Bug fix regressiyasi — OTP input state HAR DOIM string (JS number emas):
   `/^\d{6}$/` validatsiyasi, bosh nolli kodlar buzilmaydi, stale xato
   to'g'ri kod kiritilgach darhol tozalanadi. SMS so'ralmaydi — sessionStorage
   to'g'ridan-to'g'ri to'ldiriladi (bu testlar faqat input/validatsiya
   xatti-harakatini sinaydi, real OTP round-trip emas). */
test.describe("OTP input validatsiyasi (bug fix — bosh nol, stale xato)", () => {
  async function gotoTasdiqlash(page: import("@playwright/test").Page): Promise<void> {
    const phone = freshPhone();
    await page.addInitScript((p) => window.sessionStorage.setItem("bd_register_otp_phone", p), phone);
    await page.goto("/royxatdan-otish/tasdiqlash");
    await page.waitForLoadState("networkidle");
  }

  test("olti xonali kod (345654) — input string sifatida to'g'ri saqlanadi, oldindan xato yo'q", async ({ page }) => {
    await gotoTasdiqlash(page);
    const input = page.locator("input").first();
    await input.fill("345654");
    await expect(input).toHaveValue("345654");
    await expect(page.locator("p[role='alert']")).toHaveCount(0);
  });

  test("bosh nolli kod (012345) — yetakchi nol YO'QOLMAYDI (JS Number emas)", async ({ page }) => {
    await gotoTasdiqlash(page);
    const input = page.locator("input").first();
    await input.fill("012345");
    await expect(input).toHaveValue("012345"); // "12345" EMAS
  });

  test("harf aralash (12a456) — harf olib tashlanadi, raqam bo'lmagan belgi saqlanib qolmaydi", async ({ page }) => {
    await gotoTasdiqlash(page);
    const input = page.locator("input").first();
    await input.fill("12a456");
    await expect(input).toHaveValue("12456"); // "a" olib tashlangan, 5 xonali qoladi
  });

  test("7 xonali kiritish (1234567) — 6 xonagacha kesiladi", async ({ page }) => {
    await gotoTasdiqlash(page);
    const input = page.locator("input").first();
    await input.fill("1234567");
    await expect(input).toHaveValue("123456");
  });

  test("stale xato: qisqa kod bilan yuborilgach, to'g'ri 6 xonaga tuzatilsa xato DARHOL yo'qoladi", async ({ page }) => {
    await gotoTasdiqlash(page);
    const input = page.locator("input").first();

    await input.fill("123");
    await page.getByRole("button", { name: /Tasdiqlash/i }).click();
    await expect(page.getByText("Kod 6 xonali raqam bo'lishi kerak")).toBeVisible();

    await input.fill("345654");
    // Muvaffaqiyatsiz urinishdan qolgan eski xato ENDI ko'rinmasligi kerak —
    // joriy qiymat valid bo'lishi bilanoq (bug: onChange xatoni tozalamas edi).
    await expect(page.getByText("Kod 6 xonali raqam bo'lishi kerak")).toHaveCount(0);
  });
});

/* Bosqich 22 — FORMAT xatosi ("Kod 6 xonali...") va SERVER tasdiqlash
   xatosi ("Kod noto'g'ri") ikki xil manba: birinchisi hech qanday so'rov
   yubormaydi (frontend `/^\d{6}$/`), ikkinchisi FAQAT backend haqiqatan
   chaqirilgandan keyin, `ApiError.message` (xom `INVALID_CODE` kodi)
   bo'yicha ko'rsatiladi. Ular hech qachon aralashmasligi kerak. */
test.describe("OTP tasdiqlash xato xaritalash (OTP_INVALID/format ajratilgan)", () => {
  test("format xatosi ('123') → 'Kod 6 xonali...' ko'rinadi, backend'ga verify-otp so'rovi UMUMAN ketmaydi", async ({
    page,
  }) => {
    const phone = freshPhone();
    await page.addInitScript((p) => window.sessionStorage.setItem("bd_register_otp_phone", p), phone);
    await page.goto("/royxatdan-otish/tasdiqlash");
    await page.waitForLoadState("networkidle");

    let verifyRequested = false;
    page.on("request", (req) => {
      if (req.url().includes("/auth/register/verify-otp")) verifyRequested = true;
    });

    await page.locator("input").first().fill("123");
    await page.getByRole("button", { name: /Tasdiqlash/i }).click();
    await expect(page.getByText("Kod 6 xonali raqam bo'lishi kerak")).toBeVisible();
    expect(verifyRequested).toBe(false);
  });

  test("olti xonali, lekin NOTO'G'RI OTP → so'rov ketadi, 'Kod noto'g'ri' ko'rsatiladi ('Kod 6 xonali...' EMAS)", async ({
    page,
  }) => {
    const phone = freshPhone();
    await startRegistration(page, phone);

    const realCode = latestOtpFor(phone);
    const wrongCode = realCode === "000000" ? "111111" : "000000";
    await page.locator("input").first().fill(wrongCode);
    await page.getByRole("button", { name: /Tasdiqlash/i }).click();

    await expect(page.getByText("Kod noto'g'ri")).toBeVisible();
    await expect(page.getByText("Kod 6 xonali raqam bo'lishi kerak")).toHaveCount(0);
    // Muvaffaqiyatsiz verify — hali tasdiqlash sahifasida qoladi, parol bosqichiga o'tmagan.
    expect(page.url()).toContain("/royxatdan-otish/tasdiqlash");
  });
});

test("REGISTER: telefon → SMS OTP → parol → hisob yaratiladi → rol tanlash → dashboard @blocking", async ({ page }) => {
  const phone = freshPhone();
  await startRegistration(page, phone);

  const code = latestOtpFor(phone);
  await page.locator("input").first().fill(code);
  // Bug fix regressiyasi: haqiqiy 6 xonali kod kiritilgandan keyin
  // "Kod 6 xonali raqam bo'lishi kerak" xatosi UMUMAN ko'rinmasligi kerak.
  await expect(page.getByText("Kod 6 xonali raqam bo'lishi kerak")).toHaveCount(0);
  await page.getByRole("button", { name: /Tasdiqlash/i }).click();
  await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });

  // Parol maydonlari — OTP kodi bu bosqichda QAYTA ISHLATILMAYDI.
  const passwordInputs = page.locator('input[type="password"]');
  await expect(passwordInputs).toHaveCount(2);
  await passwordInputs.nth(0).fill(E2E_PASSWORD);
  await passwordInputs.nth(1).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Hisob yaratish/i }).click();

  await page.waitForURL("**/rol-tanlash", { timeout: 10_000 });
  await page.getByText("Xaridor", { exact: false }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/xaridor"), { timeout: 10_000 });
});

test("LOGIN: mavjud telefon+parol → dashboard, OTP sahifasiga UMUMAN o'tilmaydi @blocking", async ({ page }) => {
  // 1-so'rov: to'liq REGISTER (fixture sifatida).
  const phone = freshPhone();
  await startRegistration(page, phone);
  await page.locator("input").first().fill(latestOtpFor(phone));
  await page.getByRole("button", { name: /Tasdiqlash/i }).click();
  await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });
  const regPasswordInputs = page.locator('input[type="password"]');
  await regPasswordInputs.nth(0).fill(E2E_PASSWORD);
  await regPasswordInputs.nth(1).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Hisob yaratish/i }).click();
  await page.waitForURL("**/rol-tanlash", { timeout: 10_000 });
  await page.getByText("Xaridor", { exact: false }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/xaridor"), { timeout: 10_000 });

  // Sessiyadan chiqamiz — endi MAVJUD telefon bilan haqiqiy telefon+parol
  // LOGIN oqimini sinaymiz (SMS SO'RALMAYDI, cooldown/IP budjetiga tegmaydi).
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());

  await page.goto("/kirish");
  await page.locator("input").first().fill(phone.replace("+998", ""));
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^Kirish$/i }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/xaridor"), { timeout: 10_000 });

  // Login sahifasidan hech qachon "tasdiqlash"/OTP marshrutiga o'tilmadi.
  expect(page.url()).not.toContain("tasdiqlash");
});

/* frontend-engineer topilmasi (bo'lim 25 findings-closure cross-review):
   bu test @blocking EMAS — chunki xato xaritalash (`app/(auth)/kirish/page.tsx`)
   404/tarmoq xatosini HAM umumiy "Telefon raqami yoki parol noto'g'ri"
   xabariga tushiradi. Ya'ni aynan 2026-09-20 insidenti paytida (login
   so'rovi 404 qaytarganda) bu test BARCHA uchta assertni "yashil"
   o'tkazib yuborardi — soxta xotirjamlik berardi. Haqiqiy prefiks/marshrut
   qoplamasi `@blocking` bilan belgilangan LOGIN happy-path va REGISTER/
   FORGOT PASSWORD to'liq oqimlaridan keladi (ular real backend javobiga
   bog'liq navigatsiyani talab qiladi). */
test("LOGIN: noto'g'ri parol/mavjud bo'lmagan telefon → generic xato, OTP sahifasi YO'Q", async ({ page }) => {
  await page.goto("/kirish");
  await page.locator("input").first().fill(freshPhone().replace("+998", ""));
  await page.locator('input[type="password"]').fill("AnyPassword1");
  await page.getByRole("button", { name: /^Kirish$/i }).click();
  await page.waitForTimeout(800);
  // Muvaffaqiyatsiz urinishdan keyin ham SHU (/kirish) sahifada qolishi kerak.
  expect(page.url()).toContain("/kirish");
  expect(page.url()).not.toContain("tasdiqlash");
  await expect(page.getByText(/noto'g'ri/i)).toBeVisible();
});

test("REGISTER: allaqachon mavjud telefon → parol bosqichida 'hisob allaqachon mavjud' CTA, Kirish tugmasi bor", async ({ page }) => {
  // 1-so'rov: REGISTER — hisob yaratiladi.
  const phone = freshPhone();
  await startRegistration(page, phone);
  await page.locator("input").first().fill(latestOtpFor(phone));
  await page.getByRole("button", { name: /Tasdiqlash/i }).click();
  await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });
  const inputs1 = page.locator('input[type="password"]');
  await inputs1.nth(0).fill(E2E_PASSWORD);
  await inputs1.nth(1).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Hisob yaratish/i }).click();
  await page.waitForURL("**/rol-tanlash", { timeout: 10_000 });

  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  // Bir xil telefon+REGISTER uchun cooldown'ni tozalaymiz (real 60s
  // kutmasdan) — production'da foydalanuvchi haqiqatan 60s kutgan bo'lardi.
  flushOtpCooldown(phone, "REGISTER");

  // 2-so'rov: REGISTER — bir xil (endi MAVJUD) telefon; OTP bosqichining
  // o'zi hali muvaffaqiyatli o'tadi (telefon egaligi tasdiqlanadi), lekin
  // parol bosqichida (`complete`) PHONE_EXISTS oshkor bo'ladi.
  await startRegistration(page, phone);
  await page.locator("input").first().fill(latestOtpFor(phone));
  await page.getByRole("button", { name: /Tasdiqlash/i }).click();
  await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });
  const inputs2 = page.locator('input[type="password"]');
  await inputs2.nth(0).fill("Boshqa1Parol!");
  await inputs2.nth(1).fill("Boshqa1Parol!");
  await page.getByRole("button", { name: /Hisob yaratish/i }).click();

  await expect(page.getByText(/hisob allaqachon mavjud/i)).toBeVisible({ timeout: 10_000 });
  const cta = page.getByRole("link", { name: /Kirish/i });
  await expect(cta).toBeVisible();
  await cta.click();
  await page.waitForURL("**/kirish", { timeout: 10_000 });
});

test("FORGOT PASSWORD: /kirish → Parolni unutdim → SMS OTP → yangi parol → eski parol ishlamaydi, yangisi ishlaydi @blocking", async ({ page }) => {
  // 1-so'rov: REGISTER — hisob yaratiladi (eski parol bilan).
  const phone = freshPhone();
  await startRegistration(page, phone);
  await page.locator("input").first().fill(latestOtpFor(phone));
  await page.getByRole("button", { name: /Tasdiqlash/i }).click();
  await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });
  const regInputs = page.locator('input[type="password"]');
  await regInputs.nth(0).fill(E2E_PASSWORD);
  await regInputs.nth(1).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Hisob yaratish/i }).click();
  await page.waitForURL("**/rol-tanlash", { timeout: 10_000 });
  await page.getByText("Xaridor", { exact: false }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/xaridor"), { timeout: 10_000 });
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());

  // /kirish → "Parolni unutdingizmi?" havolasi orqali forgot-password oqimiga.
  await page.goto("/kirish");
  await page.getByRole("link", { name: /Parolni unutdingizmi/i }).click();
  await page.waitForURL("**/parolni-unutdim", { timeout: 10_000 });

  // 2-so'rov: PASSWORD_RESET.
  await page.locator("input").first().fill(phone.replace("+998", ""));
  await page.getByRole("button", { name: /Kod yuborish/i }).click();
  await page.waitForURL("**/parolni-unutdim/tasdiqlash", { timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.locator("input").first().fill(latestOtpFor(phone));
  await page.getByRole("button", { name: /Tasdiqlash/i }).click();
  await page.waitForURL("**/parolni-unutdim/parol", { timeout: 10_000 });

  const newPassword = "YangiParol2!";
  const resetInputs = page.locator('input[type="password"]');
  await resetInputs.nth(0).fill(newPassword);
  await resetInputs.nth(1).fill(newPassword);
  await page.getByRole("button", { name: /Parolni yangilash/i }).click();

  // Sessiya AVTOMATIK ochilmaydi — /kirish'ga qaytariladi.
  await page.waitForURL("**/kirish", { timeout: 10_000 });

  // Eski parol ENDI ishlamaydi.
  await page.locator("input").first().fill(phone.replace("+998", ""));
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^Kirish$/i }).click();
  await page.waitForTimeout(800);
  expect(page.url()).toContain("/kirish");

  // Yangi parol ishlaydi.
  await page.locator('input[type="password"]').fill(newPassword);
  await page.getByRole("button", { name: /^Kirish$/i }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/xaridor"), { timeout: 10_000 });
});

/* Bosqich 22 — DEV-only OTP ko'rsatish. Lokal `backend/.env`da
   `DEV_EXPOSE_OTP=true` (SMS_PROVIDER sukut CONSOLE, NODE_ENV=development
   bilan birga) — shu sabab bu ikki test FAQAT shu sozlamada o'tadi
   (productionda/`DEV_EXPOSE_OTP=false` bo'lsa backend `devOtp`ni umuman
   qaytarmaydi, "DEV rejim" bloki ko'rinmaydi — frontend HECH QACHON o'zi
   kod o'ylab topmaydi, faqat backend javobini ko'rsatadi). */
test.describe("DEV-only OTP ko'rsatish (DEV_EXPOSE_OTP=true)", () => {
  test("REGISTER: request-otp devOtp qaytaradi → 'DEV rejim' bloki ko'rinadi → 'Kodni kiritish' bilan parol bosqichiga o'tiladi", async ({
    page,
  }) => {
    const phone = freshPhone();
    await startRegistration(page, phone);

    const realCode = latestOtpFor(phone);
    await expect(page.getByText("DEV rejim")).toBeVisible();
    await expect(page.getByText(realCode)).toBeVisible();

    // "Kodni kiritish" FAQAT to'ldiradi — avtomatik yubormaydi.
    await page.getByRole("button", { name: /Kodni kiritish/i }).click();
    await expect(page.locator("input").first()).toHaveValue(realCode);
    expect(page.url()).toContain("/royxatdan-otish/tasdiqlash");

    await page.getByRole("button", { name: /Tasdiqlash/i }).click();
    await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });
  });

  test("FORGOT PASSWORD: request-otp devOtp qaytaradi → 'Kodni kiritish' bilan yangi parol bosqichiga o'tiladi", async ({
    page,
  }) => {
    // Avval haqiqiy hisob kerak — parolni tiklash mavjud User talab qiladi.
    const phone = freshPhone();
    await startRegistration(page, phone);
    await page.locator("input").first().fill(latestOtpFor(phone));
    await page.getByRole("button", { name: /Tasdiqlash/i }).click();
    await page.waitForURL("**/royxatdan-otish/parol", { timeout: 10_000 });
    const regInputs = page.locator('input[type="password"]');
    await regInputs.nth(0).fill(E2E_PASSWORD);
    await regInputs.nth(1).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /Hisob yaratish/i }).click();
    await page.waitForURL("**/rol-tanlash", { timeout: 10_000 });
    await page.getByText("Xaridor", { exact: false }).first().click();
    await page.waitForURL((url) => url.pathname.startsWith("/xaridor"), { timeout: 10_000 });
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());

    await page.goto("/kirish");
    await page.getByRole("link", { name: /Parolni unutdingizmi/i }).click();
    await page.waitForURL("**/parolni-unutdim", { timeout: 10_000 });
    await page.locator("input").first().fill(phone.replace("+998", ""));
    await page.getByRole("button", { name: /Kod yuborish/i }).click();
    await page.waitForURL("**/parolni-unutdim/tasdiqlash", { timeout: 10_000 });
    await page.waitForTimeout(700);

    const realCode = latestOtpFor(phone);
    await expect(page.getByText("DEV rejim")).toBeVisible();
    await expect(page.getByText(realCode)).toBeVisible();

    await page.getByRole("button", { name: /Kodni kiritish/i }).click();
    await expect(page.locator("input").first()).toHaveValue(realCode);

    await page.getByRole("button", { name: /Tasdiqlash/i }).click();
    await page.waitForURL("**/parolni-unutdim/parol", { timeout: 10_000 });
  });
});
