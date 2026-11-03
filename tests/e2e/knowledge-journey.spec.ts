import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("fictional knowledge journey is interactive, accessible and truthful", async ({ page }) => {
  await page.goto("/demo");
  const story = page.locator(".knowledge-story");
  await story.scrollIntoViewIfNeeded();
  await expect(story.getByRole("heading", { name: /Start with the knowledge/ })).toBeVisible();
  for (const name of [
    "Structured intelligence",
    "Learning academy",
    "Practice",
    "Progress",
    "Your knowledge",
  ]) {
    await story
      .getByRole("button", { name: new RegExp(name, "i"), exact: false })
      .first()
      .click();
    expect(
      (
        await new AxeBuilder({ page })
          .include(".knowledge-story")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await story.getByRole("button", { name: /Practice/ }).click();
  await story.getByRole("button", { name: "Starter", exact: true }).click();
  await expect(story.getByRole("status")).toContainText("Check the source");
  await story.getByRole("button", { name: "Team", exact: true }).click();
  await expect(story.getByRole("status")).toContainText("Correct");
  await story.getByRole("button", { name: /Learning academy/ }).click();
  await expect(story).toContainText("AI generation is not connected");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await story.getByRole("button", { name: /Progress/ }).click();
  await expect(story).toContainText("Progress tracking is planned");
});
test("knowledge imports and source templates require a session", async ({ request }) => {
  for (const path of [
    "/app/knowledge",
    "/app/knowledge/templates?id=product&format=xlsx&variant=sample",
  ]) {
    const result = await request.get(path, { maxRedirects: 0 });
    expect(result.status()).toBe(307);
    expect(result.headers().location).toContain("/login");
    expect(result.headers()["cache-control"]).toContain("no-store");
  }
});
