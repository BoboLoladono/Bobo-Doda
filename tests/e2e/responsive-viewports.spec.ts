import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "320px (iPhone SE narrow)", width: 320, height: 568 },
  { name: "360px (Android small)", width: 360, height: 640 },
  { name: "390px (iPhone 12/13/14)", width: 390, height: 844 },
  { name: "430px (iPhone 14/15 Pro Max)", width: 430, height: 932 },
  { name: "768px (iPad portrait)", width: 768, height: 1024 },
  { name: "1024px (iPad landscape / small laptop)", width: 1024, height: 768 },
  { name: "1366px (Standard laptop)", width: 1366, height: 768 },
  { name: "1440px (Desktop HD)", width: 1440, height: 900 },
  { name: "1920px (Full HD monitor)", width: 1920, height: 1080 },
];

const PAGES_TO_TEST = [
  { path: "/rahbariyat/kirish", name: "SuperAdmin Login" },
  { path: "/admin/kirish", name: "Operator Admin Login" },
  { path: "/kirish", name: "User/Buyer/Seller Login" },
  { path: "/royxatdan-otish", name: "Registration Step 1" },
  { path: "/parolni-unutdim", name: "Forgot Password Step 1" },
  { path: "/", name: "Landing Page" },
  { path: "/savol-javob", name: "FAQ Page" },
];

test.describe("Cross-Device Responsive Viewport Audit (320px - 1920px)", () => {
  for (const vp of VIEWPORTS) {
    test.describe(`Viewport: ${vp.name}`, () => {
      for (const p of PAGES_TO_TEST) {
        test(`${p.name} (${p.path}) has no horizontal overflow and renders properly`, async ({
          page,
        }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(p.path, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(100);

          // 1. Check no horizontal overflow
          const overflow = await page.evaluate(() => {
            const docWidth = document.documentElement.clientWidth;
            const scrollWidth = document.documentElement.scrollWidth;
            return {
              hasOverflow: scrollWidth > docWidth,
              scrollWidth,
              docWidth,
            };
          });

          expect(
            overflow.hasOverflow,
            `Page ${p.path} has horizontal scroll on ${vp.width}px! scrollWidth: ${overflow.scrollWidth}, clientWidth: ${overflow.docWidth}`
          ).toBe(false);

          // 2. Check main container is visible
          const main = page.locator("main, [role='main'], form").first();
          await expect(main).toBeVisible();
        });
      }
    });
  }
});
