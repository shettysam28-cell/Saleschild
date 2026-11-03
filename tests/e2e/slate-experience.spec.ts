import { test, expect } from "@playwright/test";
test("public page routes, truthful pricing, metadata, and private contact address", async ({
  page,
  request,
}) => {
  for (const path of [
    "/platform",
    "/knowledge-gateway",
    "/ai-learning",
    "/intelligence",
    "/solutions",
    "/pricing",
    "/about",
    "/contact",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{30}/);
    expect(await page.content()).not.toContain("private-contact@gmail.com");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.goto("/pricing");
  await expect(
    page.getByText(/Commercial plans and pricing have not been announced/),
  ).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/\$\d|£\d|\/month/i);
  const image = await request.get("/opengraph-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});
test("contact preview preserves text and never pretends to send", async ({ page }) => {
  let submissions = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/__forms.html")) submissions++;
  });
  await page.goto("/contact");
  await page.getByLabel("Your name").fill("Sample Visitor");
  await page.getByLabel("Work email").fill("visitor@example.test");
  await page
    .getByLabel("What would you like to make possible?")
    .fill("A fictional inquiry for a local contact form test.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send your message" }).click();
  await expect(page.locator(".m-contact-form").getByRole("alert")).toContainText(
    "has not been submitted",
  );
  expect(submissions).toBe(0);
  await expect(page.getByLabel("What would you like to make possible?")).toHaveValue(
    "A fictional inquiry for a local contact form test.",
  );
});
test("transformation is reversible and touch/reduced motion remain in normal flow", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  if (!isMobile) {
    await expect(page.locator("[data-cinematic]")).toHaveAttribute("data-cinematic", "true");
    await expect(page.locator(".pin-spacer")).toHaveCount(2);
  } else {
    await expect(page.locator(".pin-spacer")).toHaveCount(0);
  }
  const stages = page.getByRole("navigation", { name: "Knowledge transformation stages" });
  await stages.getByRole("button", { name: /Performance intelligence/ }).click();
  await expect(page.locator(".m-transform")).toHaveAttribute("data-stage", "4");
  await expect(
    page.getByRole("heading", { name: "See what the next step could be." }),
  ).toBeVisible();
  await stages.getByRole("button", { name: /Scattered information/ }).click();
  await expect(page.locator(".m-transform")).toHaveAttribute("data-stage", "0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  await expect(page.locator("[data-cinematic]")).toHaveAttribute("data-cinematic", "false");
  await page
    .getByRole("navigation", { name: "Product journey" })
    .getByRole("button", { name: /Automation/ })
    .click();
  await expect(page.getByRole("heading", { name: "Human judgment stays central." })).toBeVisible();
  await page.goto("/platform");
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
});
test("scroll and viewport changes preserve geometry and cleanup", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await expect(page.locator(".pin-spacer")).toHaveCount(0);
    return;
  }
  await expect(page.locator(".pin-spacer")).toHaveCount(2);
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator(".pin-spacer")).toHaveCount(2);
  await page
    .getByRole("navigation", { name: "Knowledge transformation stages" })
    .getByRole("button", { name: /Structured records/ })
    .click();
  const top = await page.locator(".m-transform").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(75);
  expect(top).toBeLessThan(84);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator(".m-transform")).toHaveAttribute("data-stage", "0");
});
