import { test, expect } from "@playwright/test";

test.describe("Password Visibility Toggle Suite", () => {
  test("SuperAdmin login (/rahbariyat/kirish) has accessible and working password toggle", async ({
    page,
  }) => {
    const consoleLogs: string[] = [];
    page.on("console", (msg) => consoleLogs.push(msg.text()));

    await page.goto("/rahbariyat/kirish", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const passwordInput = page.locator('input[autocomplete="current-password"]');
    await expect(passwordInput).toBeVisible();

    // 1. Password hidden initially
    await expect(passwordInput).toHaveAttribute("type", "password");

    // 2. Eye button exists
    const toggleButton = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggleButton).toBeVisible();
    await expect(toggleButton).toHaveAttribute("type", "button");

    // Enter test password
    const testSecret = "SuperSecret123!";
    await passwordInput.fill(testSecret);

    // 3. Eye button reveals value
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute("type", "text");
    await expect(passwordInput).toHaveValue(testSecret);
    await expect(page.locator('button[aria-label="Parolni yashirish"]')).toBeVisible();

    // 4. Second click hides it
    await page.locator('button[aria-label="Parolni yashirish"]').click();
    await expect(passwordInput).toHaveAttribute("type", "password");
    await expect(passwordInput).toHaveValue(testSecret);
    await expect(toggleButton).toBeVisible();

    // 5. Button click does not submit form (still on same URL, no error trigger)
    expect(page.url()).toContain("/rahbariyat/kirish");

    // 7. Password remains unchanged
    expect(await passwordInput.inputValue()).toBe(testSecret);

    // 9. Keyboard accessible
    await toggleButton.focus();
    await page.keyboard.press("Space");
    await expect(passwordInput).toHaveAttribute("type", "text");
    await page.keyboard.press("Enter");
    await expect(passwordInput).toHaveAttribute("type", "password");

    // 11. No password in console/logs
    for (const log of consoleLogs) {
      expect(log).not.toContain(testSecret);
    }
  });

  test("Operator admin login (/admin/kirish) has working password toggle", async ({
    page,
  }) => {
    await page.goto("/admin/kirish", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const passwordInput = page.locator('input[autocomplete="current-password"]');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute("type", "password");

    const toggleButton = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggleButton).toBeVisible();

    await passwordInput.fill("OperatorPass456!");
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute("type", "text");
    await expect(page.locator('button[aria-label="Parolni yashirish"]')).toBeVisible();

    await page.locator('button[aria-label="Parolni yashirish"]').click();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("Buyer/User login (/kirish) has working password toggle", async ({ page }) => {
    await page.goto("/kirish", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const passwordInput = page.locator('input[autocomplete="current-password"]');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute("type", "password");

    const toggleButton = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggleButton).toBeVisible();

    await passwordInput.fill("UserPassword789!");
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute("type", "text");
    await expect(page.locator('button[aria-label="Parolni yashirish"]')).toBeVisible();

    await page.locator('button[aria-label="Parolni yashirish"]').click();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("Enter key on password input submits the form correctly (Requirement 6)", async ({ page }) => {
    await page.goto("/rahbariyat/kirish", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const emailInput = page.locator('input').first();
    const passwordInput = page.locator('input[autocomplete="current-password"]');

    await emailInput.fill("admin@bobololadono.uz");
    await passwordInput.fill("WrongPassword123!");

    // Focus password input and press Enter
    await passwordInput.focus();
    await page.keyboard.press("Enter");

    // Form submit triggered -> error message or loading is displayed
    await expect(
      page.locator('p[role="alert"], button[type="submit"][aria-busy="true"]')
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Registration password form (/royxatdan-otish/parol) has independent toggles for password and confirmation", async ({
    page,
  }) => {
    // Seed registration token into sessionStorage before navigating
    await page.addInitScript(() => {
      window.sessionStorage.setItem("bd_registration_token", "test-reg-token-e2e");
    });

    await page.goto("/royxatdan-otish/parol", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const passwordInputs = page.locator('input[type="password"], input[autocomplete="new-password"]');
    await expect(passwordInputs).toHaveCount(2);

    const firstInput = passwordInputs.nth(0);
    const secondInput = passwordInputs.nth(1);

    // Both hidden initially
    await expect(firstInput).toHaveAttribute("type", "password");
    await expect(secondInput).toHaveAttribute("type", "password");
    await expect(firstInput).toHaveAttribute("autocomplete", "new-password");
    await expect(secondInput).toHaveAttribute("autocomplete", "new-password");

    const toggleButtons = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggleButtons).toHaveCount(2);

    await firstInput.fill("NewPass12345!");
    await secondInput.fill("ConfirmPass12345!");

    // Toggle only the first password
    await toggleButtons.nth(0).click();
    await expect(firstInput).toHaveAttribute("type", "text");
    await expect(secondInput).toHaveAttribute("type", "password"); // second remains hidden!

    // Toggle the second password
    await page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]').click();
    await expect(firstInput).toHaveAttribute("type", "text");
    await expect(secondInput).toHaveAttribute("type", "text");

    // Hide first password again
    const hideButtons = page.locator('button[aria-label="Parolni yashirish"]');
    await hideButtons.nth(0).click();
    await expect(firstInput).toHaveAttribute("type", "password");
    await expect(secondInput).toHaveAttribute("type", "text");
  });

  test("Password reset form (/parolni-unutdim/parol) has independent toggles for new and confirm password", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("bd_reset_token", "test-reset-token-e2e");
    });

    await page.goto("/parolni-unutdim/parol", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const passwordInputs = page.locator('input[autocomplete="new-password"]');
    await expect(passwordInputs).toHaveCount(2);

    const toggleButtons = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggleButtons).toHaveCount(2);

    await passwordInputs.nth(0).fill("ResetSecret987!");
    await toggleButtons.nth(0).click();
    await expect(passwordInputs.nth(0)).toHaveAttribute("type", "text");
    await expect(passwordInputs.nth(1)).toHaveAttribute("type", "password");
  });

  test("Admin forced password change (/admin/parolni-almashtirish) has 3 independent toggles", async ({
    page,
  }) => {
    // Seed staff account and session with mustChangePassword = true
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "bd_staff_account",
        JSON.stringify({
          id: "admin-1",
          fullName: "Test Admin",
          email: "admin@bobololadono.uz",
          role: "operator",
          title: "Operator",
          permissions: ["moderation"],
          mustChangePassword: true,
        })
      );
      window.localStorage.setItem(
        "bd_staff_session",
        JSON.stringify({
          adminId: "admin-1",
          role: "operator",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
      );
    });

    await page.route("**/staff/auth/refresh", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "header." + btoa(JSON.stringify({ sub: "admin-1" })) + ".sig",
          role: "operator",
        }),
      });
    });

    await page.goto("/admin/parolni-almashtirish", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    const inputs = page.locator('input[type="password"]');
    await expect(inputs).toHaveCount(3);

    const currentPass = page.locator('input[autocomplete="current-password"]');
    const newPassInputs = page.locator('input[autocomplete="new-password"]');
    await expect(currentPass).toHaveCount(1);
    await expect(newPassInputs).toHaveCount(2);

    const toggleButtons = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
    await expect(toggleButtons).toHaveCount(3);

    // Toggle 2nd input (yangi parol)
    await newPassInputs.nth(0).fill("BrandNewPassword123!");
    await toggleButtons.nth(1).click();
    await expect(newPassInputs.nth(0)).toHaveAttribute("type", "text");
    await expect(currentPass).toHaveAttribute("type", "password");
    await expect(newPassInputs.nth(1)).toHaveAttribute("type", "password");
  });

  test("Mobile responsive viewports render password toggle properly", async ({
    page,
  }) => {
    const mobileWidths = [320, 360, 390, 430];

    for (const width of mobileWidths) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/rahbariyat/kirish", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      const toggleButton = page.locator('button[aria-label="Parolni ko\'rsatish"], button[aria-label="Parolni ko‘rsatish"]');
      await expect(toggleButton).toBeVisible();

      const box = await toggleButton.boundingBox();
      expect(box).not.toBeNull();
      // Ensure button is within viewport bounds
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }
  });
});
