import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import {
  API_BASE,
  E2E_PASSWORD,
  chooseRole,
  flushStaffLoginRateLimit,
  freshPhone,
  loginViaUi,
  registerViaUi,
} from "./helpers";
import {
  ADMIN_API_BASE,
  E2E_STAFF_PASSWORD,
  SUPER_ADMIN_EMAIL,
} from "./admin-helpers";

const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || SUPER_ADMIN_EMAIL;
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD || E2E_STAFF_PASSWORD;
const EFFECTIVE_API = process.env.E2E_API_URL || process.env.E2E_ADMIN_API_URL || API_BASE;
const DB_URL = (
  process.env.E2E_DB_URL ||
  "postgresql://bobololadono_app:app@127.0.0.1:55433/bobololadono_e2e"
).replace(/\?schema=[^&]+/, "");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function approvePendingSellerViaStaffApi(sellerPhone: string): Promise<void> {
  flushStaffLoginRateLimit();
  const base = EFFECTIVE_API || ADMIN_API_BASE;
  const loginRes = await fetch(`${base}/staff/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`Staff login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const userId = execSync(
    `PGPASSWORD=app psql "${DB_URL}" -tAc "SELECT id FROM users WHERE phone='${sellerPhone}'"`,
  )
    .toString()
    .trim();
  if (!userId) throw new Error(`Seller user not found for phone ${sellerPhone}`);

  const appsRes = await fetch(`${base}/staff/seller-applications?status=PENDING&perPage=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!appsRes.ok) {
    throw new Error(`Staff seller-applications list failed: ${appsRes.status}`);
  }
  const appsBody = (await appsRes.json()) as { items: Array<{ id: string; userId: string }> };
  const target = appsBody.items.find((a) => a.userId === userId);
  if (!target) {
    throw new Error(`Pending seller application not found for userId ${userId}`);
  }

  const approveRes = await fetch(`${base}/staff/seller-applications/${target.id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!approveRes.ok) {
    throw new Error(`Staff approve failed: ${approveRes.status} ${await approveRes.text()}`);
  }
}

async function logoutViaUi(page: Page): Promise<void> {
  const logoutBtn = page.getByRole("button", { name: /Chiqish|Выйти|Log out/i }).first();
  await logoutBtn.click();
  await page.waitForURL("**/kirish", { timeout: 10_000 });
}

test.describe("First Release Marketplace Full UI E2E (Buyer, Specialist, Admin)", () => {
  test("End-to-end 100,000 UZS lifecycle -> 10% commission -> manual bank inflow -> revision -> 60,000 manual payout -> persistence", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const suffix = `FR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const jobTitle = `Birinchi Reliz Loyiha ${suffix}`;
    const jobDesc = `Ushbu ${suffix} loyihasi uchun landing sahifa dizayni, frontend maket va mobil ko'rinish kerak.`;
    const sellerName = `Mutaxassis ${suffix}`;
    const coverLetter = `Salom! ${suffix} vazifasini kelishilgan mezon bo'yicha 5 kunda topshiraman.`;
    const deliverableSummary = `To'liq Next.js maket va mobil ko'rinish (${suffix})`;
    const acceptanceCriteria = `Barcha sahifalar xatosiz ishlaydi, tekshiruvdan o'tadi (${suffix})`;
    const bankInRef = `BANK-IN-${suffix}`;
    const bankOutRef = `BANK-OUT-${suffix}`;

    // 1. Isolated Context A (Buyer) & Context B (Specialist) & Context C (Admin)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const buyerPhone = freshPhone();

    await registerViaUi(pageA, buyerPhone);
    await chooseRole(pageA, "Xaridor");
    await pageA.waitForURL("**/xaridor**", { timeout: 15_000 });

    // Buyer creates job via UI wizard (100,000 UZS)
    await pageA.goto("/xaridor/my-jobs/yangi", { waitUntil: "networkidle" });
    await pageA.locator("main button").first().click();
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    await pageA.locator("main input").first().fill(jobTitle);
    await pageA.locator("main textarea").first().fill(jobDesc);
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    const tagInput = pageA.locator("main input").first();
    await tagInput.fill("Next.js");
    await tagInput.press("Enter");
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    const numberInputs = pageA.locator('main input[type="number"]');
    await numberInputs.nth(0).fill("100000");
    await numberInputs.nth(1).fill("100000");
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    await pageA.getByRole("button", { name: /E'lon qilish/i }).click();
    await pageA.waitForURL(/\/xaridor\/my-jobs\/[0-9a-f-]+/i, { timeout: 15_000 });
    const jobId = pageA.url().match(/\/xaridor\/my-jobs\/([0-9a-f-]+)/i)![1];

    // 2. Specialist B registers, onboards, gets staff-approved, finds job, submits 100,000 proposal
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const sellerPhone = freshPhone();

    await registerViaUi(pageB, sellerPhone);
    await chooseRole(pageB, "Mutaxassis");
    await pageB.waitForURL("**/mutaxassis/settings/royxat**", { timeout: 15_000 });

    const royxatInputs = pageB.locator("form input");
    await royxatInputs.nth(0).fill(sellerName);
    await royxatInputs.nth(1).fill(sellerName);
    await royxatInputs.nth(2).fill(sellerName);
    await pageB.locator("form textarea").first().fill("Tajribali mutaxassis, React va dizayn bo'yicha mutaxassis.");
    await pageB.getByRole("button", { name: /Ariza yuborish|Yuborish/i }).click();
    await expect(pageB.getByText(/ko'rib chiqilmoqda|Tekshirilmoqda/i)).toBeVisible({ timeout: 10_000 });

    await approvePendingSellerViaStaffApi(sellerPhone);
    await pageB.reload({ waitUntil: "networkidle" });

    await pageB.goto("/bozor?tab=jobs", { waitUntil: "networkidle" });
    await pageB.locator('input[type="search"], input[placeholder*="Qidir"]').first().fill(suffix);
    await expect(pageB.getByRole("heading", { name: jobTitle })).toBeVisible({ timeout: 15_000 });
    await pageB.getByRole("heading", { name: jobTitle }).click();
    await pageB.waitForURL(`**/bozor/ish-elonlari/${jobId}`, { timeout: 10_000 });

    await pageB.getByRole("link", { name: /Taklif yuborish/i }).click();
    await pageB.waitForURL(`**/bozor/ish-elonlari/${jobId}/taklif`, { timeout: 10_000 });

    const propNums = pageB.locator('form input[type="number"]');
    await propNums.nth(0).fill("100000");
    await propNums.nth(1).fill("5");
    await pageB.locator("form textarea").first().fill(coverLetter);
    await pageB.getByRole("button", { name: /Taklif yuborish/i }).click();
    await pageB.waitForURL("**/mutaxassis/applications", { timeout: 15_000 });

    // 3. Buyer reloads job page, opens hire terms page, defines immutable terms snapshot & hires -> PENDING_SELLER
    await pageA.reload({ waitUntil: "networkidle" });
    await pageA.getByRole("button", { name: /^Yollash$/i }).first().click();
    await pageA.waitForURL(/\/xaridor\/my-jobs\/[^/]+\/yollash\/[^/]+/i, { timeout: 10_000 });

    await pageA.getByPlaceholder(/Tayyor web ilova kodi/i).fill(deliverableSummary);
    await pageA.getByPlaceholder(/Ish qaysi mezon asosida/i).fill(acceptanceCriteria);
    // Verify 10% fee preview on hire page (10,000 so'm)
    await expect(pageA.getByText(/10%/).first()).toBeVisible();
    await expect(pageA.getByText(/10\s*000/).first()).toBeVisible();

    await pageA.getByRole("button", { name: /^Yollash$/i }).click();
    await pageA.waitForURL(/\/xaridor\/contracts\/[0-9a-f-]+/i, { timeout: 15_000 });
    const contractId = pageA.url().match(/\/xaridor\/contracts\/([0-9a-f-]+)/i)![1];

    // Before Specialist confirms: must show waiting for specialist, NOT signed/funded
    await expect(pageA.getByText(deliverableSummary)).toBeVisible();
    await expect(pageA.getByText(acceptanceCriteria)).toBeVisible();
    await expect(pageA.getByText(/Mutaxassis tasdig'i kutilmoqda/i).first()).toBeVisible();

    // 4. Specialist sees contract, verifies exact shared terms, accepts -> ACTIVE
    await pageB.goto(`/mutaxassis/contracts/${contractId}`, { waitUntil: "networkidle" });
    await expect(pageB.getByText(deliverableSummary)).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(acceptanceCriteria)).toBeVisible();
    await pageB.getByRole("button", { name: /Qabul qilish/i }).first().click();
    await expect(pageB.getByText(/Xaridor to'lovi kutilmoqda/i).first()).toBeVisible({ timeout: 15_000 });

    // 5. Buyer reloads contract -> sees unique BD-... code & official test bank details -> uploads PNG receipt -> PENDING_REVIEW
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.getByText(/BD-/).first()).toBeVisible({ timeout: 15_000 });

    const receiptUploadPromise = pageA.waitForResponse(
      (res) => res.url().includes("/uploads") && res.request().method() === "POST",
    );
    await pageA.locator('input[type="file"]').setInputFiles({
      name: "bank-chek.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    const receiptUploadRes = await receiptUploadPromise;
    expect(receiptUploadRes.ok()).toBeTruthy();
    const receiptUploadJson = (await receiptUploadRes.json()) as { url: string };
    const receiptDownloadUrl = receiptUploadJson.url.startsWith("http")
      ? receiptUploadJson.url
      : `${EFFECTIVE_API.replace(/\/api\/v1\/?$/, "")}${receiptUploadJson.url}`;

    await expect(pageA.getByText(/Yuklandi: bank-chek\.png/i)).toBeVisible({ timeout: 10_000 });
    await pageA.getByPlaceholder(/To'lov topshiriqnomasi/i).fill(`To'lov ${suffix}`);
    await pageA.getByRole("button", { name: /Chekni tekshirishga yuborish/i }).click();
    await expect(pageA.getByText(/Chek tekshirilmoqda/i)).toBeVisible({ timeout: 10_000 });

    // Unauthenticated direct access to buyer's receipt upload must be denied (401)
    const unauthContext = await browser.newContext();
    const unauthReceiptRes = await unauthContext.request.get(receiptDownloadUrl);
    expect(unauthReceiptRes.status()).toBe(401);
    await unauthContext.close();

    // 6. Isolated Context C (Admin) logs into /rahbariyat/kirish, downloads private receipt, & verifies bank proof -> Contract funded!
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    flushStaffLoginRateLimit();
    await pageC.goto("/rahbariyat/kirish", { waitUntil: "networkidle" });
    await pageC.getByLabel(/Korporativ email/i).fill(STAFF_EMAIL);
    await pageC.locator('input[type="password"]').fill(STAFF_PASSWORD);
    await pageC.getByRole("button", { name: /Xavfsiz kirish/i }).click();
    await pageC.waitForURL((url) => !url.pathname.includes("/kirish"), { timeout: 15_000 });
    await pageC.goto("/admin/tolovlar", { waitUntil: "networkidle" });

    // Bank kirim cheklari tab is default; find our job title row and test protected download + Tekshirish
    const proofRow = pageC.locator("tr", { hasText: jobTitle }).first();
    await expect(proofRow).toBeVisible({ timeout: 15_000 });
    const receiptDownloadPromise = pageC.waitForEvent("download");
    await proofRow.getByRole("button", { name: /Chek fayli/i }).click();
    const receiptDownload = await receiptDownloadPromise;
    expect(receiptDownload.suggestedFilename()).toContain(".png");

    await proofRow.getByRole("button", { name: /Tekshirish/i }).click();

    await pageC.getByLabel(/Unikal bank operatsiya raqami/i).fill(bankInRef);
    await pageC.getByRole("button", { name: /^Tasdiqlash$/i }).click();
    await expect(pageC.getByText(bankInRef)).toBeVisible({ timeout: 15_000 });

    // 7. Buyer reloads contract -> sees funded status; Specialist uploads work v1
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.getByText(/Mablag'langan/i).first()).toBeVisible({ timeout: 15_000 });

    await pageB.reload({ waitUntil: "networkidle" });
    await pageB.getByRole("button", { name: /Ishni topshirish/i }).first().click();
    await pageB.getByPlaceholder("https://drive.google.com/...").fill("https://example.com/v1");
    await pageB.locator('div[role="dialog"] textarea').fill(`1-versiya natija (${suffix})`);
    await pageB.locator('div[role="dialog"] input[type="file"]').setInputFiles({
      name: "hisobot-v1.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`Deliverable report ${suffix}`, "utf-8"),
    });
    await expect(pageB.getByText(/Yuklandi: hisobot-v1\.txt/i).first()).toBeVisible({ timeout: 10_000 });
    await pageB.getByRole("button", { name: /Ish topshirildi/i }).click();
    await expect(pageB.getByText(`1-versiya natija (${suffix})`).first()).toBeVisible({ timeout: 15_000 });

    // 8. Buyer reloads -> sees v1 + requests 1 revision -> Specialist sees revision reason & resubmits v2 -> Buyer accepts!
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.getByText(`1-versiya natija (${suffix})`).first()).toBeVisible({ timeout: 15_000 });

    await pageA.getByRole("button", { name: /O'zgartirish so'rash/i }).first().click();
    await pageA.locator('div[role="dialog"] textarea').fill(`Sarlavhani kattalashtiring (${suffix})`);
    await pageA.locator('div[role="dialog"]').getByRole("button", { name: /O'zgartirish so'rash/i }).click();
    await expect(pageA.getByText(/O'zgartirish so'raldi/i).first()).toBeVisible({ timeout: 15_000 });

    await pageB.reload({ waitUntil: "networkidle" });
    await expect(pageB.getByText(`Sarlavhani kattalashtiring (${suffix})`).first()).toBeVisible({ timeout: 15_000 });
    await pageB.getByRole("button", { name: /Qayta topshirish/i }).first().click();
    await pageB.getByPlaceholder("https://drive.google.com/...").fill("https://example.com/v2");
    await pageB.locator('div[role="dialog"] textarea').fill(`2-versiya tuzatildi (${suffix})`);
    await pageB.getByRole("button", { name: /Ish topshirildi/i }).click();
    await expect(pageB.getByText(`2-versiya tuzatildi (${suffix})`).first()).toBeVisible({ timeout: 15_000 });

    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.getByText(`2-versiya tuzatildi (${suffix})`).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText(/Topshirishlar tarixi \(2\)/i)).toBeVisible();

    await pageA.getByRole("button", { name: /Qabul qilish/i }).first().click();
    await pageA.locator('div[role="dialog"]').getByRole("button", { name: /Qabul qilish/i }).click();
    await expect(pageA.getByText(/Yakunlangan/i).first()).toBeVisible({ timeout: 15_000 });

    // 9. Specialist opens /mutaxassis/billing -> verifies 100k gross / 10k (10%) commission / 90k net available -> adds masked card -> MUST wait for finance staff verification!
    await pageB.goto("/mutaxassis/billing", { waitUntil: "networkidle" });
    await expect(pageB.getByText(/90\s*000/).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(/10\s*000/).first()).toBeVisible();

    await pageB.getByRole("button", { name: /\+ Rekvizit qo'shish/i }).click();
    await pageB.getByPlaceholder("8600 0000 0000 0000").fill("8600123456789012");
    await pageB.getByPlaceholder("ALISHER VALIYEV").fill(sellerName.toUpperCase());
    await pageB.locator('div[role="dialog"]').getByRole("button", { name: /^Saqlash$/i }).click();
    await expect(pageB.getByText(/9012/).first()).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(/Tekshiruvda/i).first()).toBeVisible();

    // Opening withdraw modal while unverified MUST keep submit disabled and show pending notice
    await pageB.getByRole("button", { name: /Mablag'ni yechish/i }).click();
    await expect(pageB.getByRole("button", { name: /So'rov yuborish/i })).toBeDisabled();
    await pageB.locator('div[role="dialog"]').getByRole("button", { name: /Bekor qilish/i }).click();

    // Admin verifies recipient in "Oluvchilarni tekshirish" tab and links bankRecipientId
    const bankRecipientId = `CORP-BEN-${suffix}`;
    await pageC.getByRole("button", { name: /Oluvchilarni tekshirish/i }).click();
    const destRow = pageC.locator("tr", { hasText: sellerName }).first();
    await expect(destRow).toBeVisible({ timeout: 15_000 });
    await destRow.getByRole("button", { name: /Oluvchini tasdiqlash/i }).click();
    await pageC.getByLabel(/Bank kabinetidagi saqlangan oluvchi ID/i).fill(bankRecipientId);
    await pageC.getByLabel(/Egalik va bank tekshiruvi izohi/i).fill(`KYC va bank kabineti bilan solishtirildi (${suffix})`);
    await pageC.locator('div[role="dialog"]').getByRole("button", { name: /Oluvchini tasdiqlash/i }).click();
    await expect(pageC.getByText(bankRecipientId).first()).toBeVisible({ timeout: 15_000 });

    // Specialist reloads -> sees Tasdiqlangan + Bank oluvchi ID -> requests 60,000 payout
    await pageB.reload({ waitUntil: "networkidle" });
    await expect(pageB.getByText(/Tasdiqlangan/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(bankRecipientId).first()).toBeVisible();

    await pageB.getByRole("button", { name: /Mablag'ni yechish/i }).click();
    await pageB.locator('div[role="dialog"] input[type="number"]').fill("60000");
    await pageB.getByRole("button", { name: /So'rov yuborish/i }).click();

    await expect(pageB.getByText(/30\s*000/).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(/60\s*000/).first()).toBeVisible();

    // 10. Admin processes 60,000 payout manually: Ishlovga olish -> Bank orqali o'tkazildi
    await pageC.getByRole("button", { name: /Pul yechish/i }).click();
    const payoutRow = pageC.locator("tr", { hasText: "60 000" }).first();
    await expect(payoutRow).toBeVisible({ timeout: 15_000 });

    await payoutRow.getByRole("button", { name: /Ishlovga olish/i }).click();
    await expect(payoutRow.getByRole("button", { name: /Bank orqali o'tkazildi/i })).toBeVisible({ timeout: 15_000 });
    await payoutRow.getByRole("button", { name: /Bank orqali o'tkazildi/i }).click();

    await pageC.getByLabel(/Bank operatsiya/i).fill(bankOutRef);
    await pageC.getByRole("button", { name: /Qayd etish \(SUCCEEDED\)/i }).click();
    await expect(pageC.getByText(bankOutRef).first()).toBeVisible({ timeout: 15_000 });

    // 11. Specialist reloads /mutaxassis/billing & re-logins to verify 60,000 paid + 30,000 remaining persists
    await pageB.reload({ waitUntil: "networkidle" });
    await expect(pageB.getByText(/60\s*000/).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(/30\s*000/).first()).toBeVisible();
    await expect(pageB.getByText(bankOutRef).first()).toBeVisible();

    await logoutViaUi(pageB);
    await loginViaUi(pageB, sellerPhone, E2E_PASSWORD);
    await pageB.goto("/mutaxassis/billing", { waitUntil: "networkidle" });
    await expect(pageB.getByText(/30\s*000/).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(/60\s*000/).first()).toBeVisible();

    await contextA.close();
    await contextB.close();
    await contextC.close();
  });
});
