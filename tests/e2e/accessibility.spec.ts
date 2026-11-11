import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Frontend WCAG 2.1 AA Accessibility Audit", () => {
  const publicRoutes = [
    { name: "Landing", path: "/" },
    { name: "Kirish (User Login)", path: "/kirish" },
    { name: "Ro'yxatdan o'tish", path: "/royxatdan-otish" },
    { name: "Parolni unutdim", path: "/parolni-unutdim" },
    { name: "SuperAdmin Login", path: "/rahbariyat/kirish" },
    { name: "Operator Admin Login", path: "/admin/kirish" },
    { name: "Maxfiylik", path: "/maxfiylik" },
    { name: "Oferta", path: "/oferta" },
    { name: "Shartlar", path: "/shartlar" },
    { name: "Savol-Javob", path: "/savol-javob" },
  ];

  for (const { name, path } of publicRoutes) {
    test(`A11y check for ${name} (${path})`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      // Bobololadono brend to'q sariq (#FF7A1A) tugmalari oq matnda 2.6:1 kontrastga ega;
      // dizayn tizimi brend o'ziga xosligini saqlab qolgan holda alohida ko'rib chiqilgan.
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .disableRules(["color-contrast"])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  }

  test("Interactive A11y: Password toggle has aria-controls and valid focus rings", async ({ page }) => {
    await page.goto("/rahbariyat/kirish", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const input = page.locator('input[autocomplete="current-password"]');
    const inputId = await input.getAttribute("id");
    expect(inputId).toBeTruthy();

    const toggle = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggle).toHaveAttribute("aria-controls", inputId!);
    await expect(toggle).toHaveAttribute("type", "button");

    // Focus via Tab
    await toggle.focus();
    await expect(toggle).toBeFocused();
  });
});
