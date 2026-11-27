import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  API_BASE,
  E2E_PASSWORD,
  chooseRole,
  freshPhone,
  loginViaUi,
  registerViaUi,
} from "./helpers";

const STATE_FILE = process.env.STAGE1_STATE_FILE || "/tmp/stage1-e2e-state.json";
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || "super@e2e.test";
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD || "E2eTest#2026Pass";
const DB_URL = (
  process.env.E2E_DB_URL ||
  "postgresql://bobololadono_app:app@127.0.0.1:55433/bobololadono_e2e"
).replace(/\?schema=[^&]+/, "");

interface Stage1State {
  buyerPhone: string;
  sellerPhone: string;
  sellerName: string;
  jobTitle: string;
  jobId: string;
  bidAmount: number;
  deliveryDays: number;
  coverLetter: string;
}

async function approvePendingSellerViaStaffApi(sellerPhone: string): Promise<void> {
  const loginRes = await fetch(`${API_BASE}/staff/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`Staff login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  const userId = execSync(
    `psql "${DB_URL}" -tAc "SELECT id FROM users WHERE phone='${sellerPhone}'"`
  )
    .toString()
    .trim();
  if (!userId) throw new Error(`Seller user not found for phone ${sellerPhone}`);

  const appsRes = await fetch(`${API_BASE}/staff/seller-applications?status=PENDING&perPage=100`, {
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

  const approveRes = await fetch(`${API_BASE}/staff/seller-applications/${target.id}/approve`, {
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

test.describe("Stage 1: Two-User Job & Proposal Flow (Real Backend + Postgres)", () => {
  test("Phase 1 (A, B, C, E, G): Buyer posts job, Specialist finds and submits proposal with error/retry & dedup, Buyer verifies", async ({
    browser,
  }) => {
    test.skip(process.env.STAGE1_PHASE === "verify-after-restart", "Running post-restart verification phase only");
    test.setTimeout(120_000);

    const uniqueSuffix = `S1-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const jobTitle = `Noyob Stage1 Loyiha ${uniqueSuffix}`;
    const jobDesc = `Bobo-Doda birinchi bosqich integratsiya sinovi uchun batafsil loyiha tavsifi ${uniqueSuffix}.`;
    const bidAmount = 750000;
    const deliveryDays = 6;
    const coverLetter = `Assalomu alaykum! Men ushbu ${uniqueSuffix} loyihasini ${deliveryDays} kunda sifatli bajarib beraman.`;
    const sellerName = `Mutaxassis ${uniqueSuffix}`;

    // Context A: Independent browser context for Buyer A
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const buyerPhone = freshPhone();

    await registerViaUi(pageA, buyerPhone);
    await chooseRole(pageA, "Xaridor");
    await pageA.waitForURL("**/xaridor**", { timeout: 15_000 });

    // A: Buyer creates a uniquely named job via UI wizard
    await pageA.goto("/xaridor/my-jobs/yangi", { waitUntil: "networkidle" });
    await pageA.getByRole("button", { name: /Dasturlash/i }).click();
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    await pageA.locator("main input").first().fill(jobTitle);
    await pageA.locator("main textarea").first().fill(jobDesc);
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    // Skills tag input
    const tagInput = pageA.locator("main input").first();
    await tagInput.fill("TypeScript");
    await tagInput.press("Enter");
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    // Budget min & max
    const numberInputs = pageA.locator('main input[type="number"]');
    await numberInputs.nth(0).fill("500000");
    await numberInputs.nth(1).fill("1200000");
    await pageA.getByRole("button", { name: /Keyingi/i }).click();

    // Review & Publish
    await pageA.getByRole("button", { name: /E'lon qilish/i }).click();
    await pageA.waitForURL(/\/xaridor\/my-jobs\/[0-9a-f-]+/i, { timeout: 15_000 });
    const jobUrlMatch = pageA.url().match(/\/xaridor\/my-jobs\/([0-9a-f-]+)/i);
    if (!jobUrlMatch) throw new Error(`Expected job detail URL, got ${pageA.url()}`);
    const jobId = jobUrlMatch[1];

    await expect(pageA.getByRole("heading", { name: jobTitle })).toBeVisible();

    // Context B: Completely isolated browser context (separate cookies & storage) for Specialist B
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const sellerPhone = freshPhone();

    await registerViaUi(pageB, sellerPhone);
    await chooseRole(pageB, "Mutaxassis");
    await pageB.waitForURL("**/mutaxassis/settings/royxat**", { timeout: 15_000 });

    // Submit seller onboarding application via UI
    const royxatInputs = pageB.locator("form input");
    await royxatInputs.nth(0).fill(sellerName);
    await royxatInputs.nth(1).fill(sellerName);
    await royxatInputs.nth(2).fill(sellerName);
    await pageB.locator("form textarea").first().fill("Tajribali full-stack dasturchi, PostgreSQL va Next.js mutaxassisi.");
    await pageB.getByRole("button", { name: /Ariza yuborish|Yuborish/i }).click();
    await expect(pageB.getByText(/ko'rib chiqilmoqda|Tekshirilmoqda/i)).toBeVisible({ timeout: 10_000 });

    // Real Staff Admin approves Specialist B via /staff/seller-applications/:id/approve
    await approvePendingSellerViaStaffApi(sellerPhone);
    await pageB.reload({ waitUntil: "networkidle" });
    await expect(pageB.getByRole("button", { name: /Kabinetga|Boshqaruv/i })).toBeVisible({ timeout: 10_000 });

    // B: Specialist navigates to /bozor, finds A's job via UI search, and opens detail page
    await pageB.goto("/bozor?tab=jobs", { waitUntil: "networkidle" });
    const searchBox = pageB.locator('input[type="search"], input[placeholder*="Qidir"]').first();
    await searchBox.fill(uniqueSuffix);
    await expect(pageB.getByRole("heading", { name: jobTitle })).toBeVisible({ timeout: 15_000 });

    await pageB.getByRole("heading", { name: jobTitle }).click();
    await pageB.waitForURL(`**/bozor/ish-elonlari/${jobId}`, { timeout: 10_000 });
    await expect(pageB.getByRole("heading", { name: jobTitle })).toBeVisible();

    // Open proposal form via UI CTA
    await pageB.getByRole("link", { name: /Taklif yuborish/i }).click();
    await pageB.waitForURL(`**/bozor/ish-elonlari/${jobId}/taklif`, { timeout: 10_000 });

    // Fill proposal form (bid, deliveryDays, coverLetter)
    const propNumberInputs = pageB.locator('form input[type="number"]');
    await propNumberInputs.nth(0).fill(String(bidAmount));
    await propNumberInputs.nth(1).fill(String(deliveryDays));
    await pageB.locator("form textarea").first().fill(coverLetter);

    // G: Simulate server/network error on first submit attempt -> must NOT show fake success & must preserve inputs
    let interceptOnce = true;
    await pageB.route(`**/jobs/${jobId}/proposals`, async (route) => {
      if (interceptOnce && route.request().method() === "POST") {
        interceptOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SERVICE_UNAVAILABLE", message: "Simulated server failure" }),
        });
        return;
      }
      await route.continue();
    });

    await pageB.getByRole("button", { name: /Taklif yuborish/i }).click();
    await expect(pageB.locator('form [role="alert"]')).toBeVisible({ timeout: 10_000 });
    expect(pageB.url()).toContain(`/bozor/ish-elonlari/${jobId}/taklif`);
    // Verify form values preserved
    await expect(propNumberInputs.nth(0)).toHaveValue(String(bidAmount));
    await expect(propNumberInputs.nth(1)).toHaveValue(String(deliveryDays));
    await expect(pageB.locator("form textarea").first()).toHaveValue(coverLetter);

    // Retry submit (and guard against second rapid click) -> succeeds cleanly and creates exactly 1 row in DB
    const submitBtn = pageB.getByRole("button", { name: /Taklif yuborish/i });
    await submitBtn.click();
    await submitBtn.click({ force: true }).catch(() => {});
    await pageB.waitForURL("**/mutaxassis/applications", { timeout: 15_000 });

    // C (Specialist B side): Specialist sees submitted proposal in /mutaxassis/applications
    await expect(pageB.getByText(jobTitle)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(coverLetter)).toBeVisible();
    await expect(pageB.getByText(/750\s*000/).first()).toBeVisible();
    await expect(pageB.getByText(`${deliveryDays} kun`, { exact: true })).toBeVisible();

    // C (Buyer A side): Buyer reloads /xaridor/my-jobs/[id] and sees B's exact price, days, cover letter, and name
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.getByText(sellerName).first()).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByText(/750\s*000/).first()).toBeVisible();
    await expect(pageA.getByText(`${deliveryDays} kun`, { exact: true })).toBeVisible();
    await expect(pageA.getByText(coverLetter)).toBeVisible();

    // E: Verify DB has exactly 1 proposal row for (jobId, sellerB)
    const propCount = execSync(
      `psql "${DB_URL}" -tAc "SELECT count(*) FROM job_proposals WHERE \\"jobId\\"='${jobId}'"`
    )
      .toString()
      .trim();
    expect(propCount).toBe("1");

    // Log out both users via UI before server restart test
    await logoutViaUi(pageA);
    await logoutViaUi(pageB);

    const state: Stage1State = {
      buyerPhone,
      sellerPhone,
      sellerName,
      jobTitle,
      jobId,
      bidAmount,
      deliveryDays,
      coverLetter,
    };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    await contextA.close();
    await contextB.close();
  });

  test("Phase 2 (D): After logout and server restart, both users re-login and see persisted job & proposal", async ({
    browser,
  }) => {
    test.skip(process.env.STAGE1_PHASE !== "verify-after-restart", "Only runs in post-restart verification phase");
    test.setTimeout(90_000);
    if (!existsSync(STATE_FILE)) {
      throw new Error(`Missing state file ${STATE_FILE} from Phase 1`);
    }
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Stage1State;

    // Context A: Fresh browser context, Buyer logs in again
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await loginViaUi(pageA, state.buyerPhone, E2E_PASSWORD);
    await pageA.goto(`/xaridor/my-jobs/${state.jobId}`, { waitUntil: "networkidle" });
    await expect(pageA.getByRole("heading", { name: state.jobTitle })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText(state.sellerName).first()).toBeVisible();
    await expect(pageA.getByText(/750\s*000/).first()).toBeVisible();
    await expect(pageA.getByText(`${state.deliveryDays} kun`, { exact: true })).toBeVisible();
    await expect(pageA.getByText(state.coverLetter)).toBeVisible();

    // Context B: Fresh browser context, Specialist logs in again
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await loginViaUi(pageB, state.sellerPhone, E2E_PASSWORD);
    await pageB.goto("/mutaxassis/applications", { waitUntil: "networkidle" });
    await expect(pageB.getByText(state.jobTitle)).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(state.coverLetter)).toBeVisible();
    await expect(pageB.getByText(/750\s*000/).first()).toBeVisible();
    await expect(pageB.getByText(`${state.deliveryDays} kun`, { exact: true })).toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
