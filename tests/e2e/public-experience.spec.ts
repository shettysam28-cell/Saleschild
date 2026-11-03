import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("public homepage tells the product story without internal material", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/Saleschild/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Knowledge.");
  await expect(
    page.getByText("Where Knowledge Grows Into Performance.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Start growing/ })).toHaveAttribute(
    "href",
    "/register",
  );
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/AGENTS\.md|service_role|SKILLS\.md/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test("sample knowledge search, sources, learning, and analytics respond to input", async ({
  page,
}) => {
  await page.goto("/demo");
  await expect(page.getByText("ILLUSTRATIVE DEMO", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Ask the sample knowledge base" })
    .fill("What is our review policy?");
  await page.getByRole("button", { name: "Search sample knowledge" }).click();
  await expect(
    page.getByText("Every published resource has an owner.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Knowledge quality handbook/ }).click();
  await expect(page.getByText(/authored sample source/)).toBeVisible();
  await page.getByRole("tab", { name: /Build the capability/ }).click();
  await page.getByRole("button", { name: "Try a sample lesson" }).click();
  await expect(page.getByText("1 of 3 lessons explored")).toBeVisible();
  await page.getByRole("button", { name: "Complete next lesson" }).click();
  await page.getByRole("button", { name: "Complete next lesson" }).click();
  await expect(page.getByText(/Sample path complete/)).toBeVisible();
  await page.getByRole("tab", { name: /See the progress/ }).click();
  await page.getByLabel("Sample analytics period").selectOption("Last month");
  await expect(page.getByText("72", { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("workspace routes deny access without configured authentication", async ({ page }) => {
  for (const path of ["/app", "/app/knowledge", "/app/analytics", "/onboarding"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Welcome back/ })).toBeDisabled();
  await expect(page.getByText(/Customer access is being prepared/)).toBeVisible();
});
test("registration and recovery are honest about integration readiness", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "It starts with you." })).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("minlength", "12");
  await expect(page.getByRole("button", { name: /Create your account/ })).toBeDisabled();
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Find your way back." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send reset link/ })).toBeDisabled();
});
test("internal instructions and configuration cannot be downloaded", async ({ request }) => {
  for (const path of [
    "/AGENTS.md",
    "/SALESCHILD_SKILLS.md",
    "/skills.md",
    "/docs/internal/PRODUCT.md",
    "/.env",
    "/.git/config",
    "/.codex-attachments/anything",
    "/supabase/migrations/test.sql",
    "/scripts/security-check.mjs",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).not.toContain("PRIVATE DEVELOPMENT MATERIAL");
  }
});
test("auth responses prevent caching and framing", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});
test("public pages meet automated accessibility checks", async ({ page }) => {
  for (const path of [
    "/",
    "/platform",
    "/knowledge-gateway",
    "/ai-learning",
    "/intelligence",
    "/solutions",
    "/pricing",
    "/about",
    "/contact",
    "/demo",
    "/login",
    "/register",
    "/privacy",
  ]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
      path,
    ).toEqual([]);
  }
});
test("navigation supports keyboard and mobile menu", async ({ page, isMobile }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  if (isMobile) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "The platform" }).click();
    await expect(nav).toBeHidden();
  }
  await page.goto("/demo");
  await page.getByRole("tab", { name: /Find the answer/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Build the capability/ })).toBeFocused();
  await expect(page.getByRole("tab", { name: /Build the capability/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
test("reduced motion preserves readable content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Neither should/ })).toBeVisible();
  await expect(page.locator("[data-cinematic]")).toHaveAttribute("data-cinematic", "false");
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
});

test("layouts reflow at narrow, tablet, and wide widths", async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/demo", "/login"]) {
      await page.goto(path);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${path} at ${width}px`,
      ).toBe(true);
      const heading = page.getByRole("heading", { level: 1 });
      expect(
        await heading.evaluate((el) => el.scrollWidth <= el.clientWidth),
        `Heading at ${width}px`,
      ).toBe(true);
    }
    if (width === 768) {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    }
  }
});
test("capture review screenshots", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
  await page.goto("/demo");
  await page.screenshot({ path: info.outputPath("demo.png"), fullPage: true });
  await page.goto("/login");
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
});
