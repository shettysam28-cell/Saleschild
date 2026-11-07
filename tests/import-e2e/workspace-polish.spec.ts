import { test, expect, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.get("/fixture/owner-a");
});
test("Fetch clears the previous answer and ignores older responses after editing and resubmission", async ({
  page,
}) => {
  const pending: Route[] = [];
  let initial = true;
  const answer = (text: string) => ({
    message: text,
    answer: { summary: { text, citation: "s1" }, facts: [], steps: [], citations: [], notices: [] },
  });
  await page.route("**/action/knowledge-fetch", async (route) => {
    if (initial) {
      initial = false;
      await route.fulfill({ json: answer("Fictional initial answer") });
    } else pending.push(route);
  });
  await page.goto("/app");
  const query = page.getByLabel("What would you like to find?");
  const submit = () => page.getByRole("button", { name: "Fetch knowledge", exact: true }).click();
  await query.fill("initial");
  await submit();
  await expect(
    page.getByRole("status").filter({ hasText: "Fictional initial answer" }),
  ).toBeVisible();
  await query.fill("older");
  await submit();
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByText("Fictional initial answer", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Searching approved knowledge" }),
  ).toBeVisible();
  await query.fill("newer");
  await submit();
  await expect.poll(() => pending.length).toBe(2);
  await pending[1].fulfill({ json: answer("Fictional latest answer") });
  await expect(
    page.getByRole("status").filter({ hasText: "Fictional latest answer" }),
  ).toBeVisible();
  const olderResponse = page.waitForResponse((response) =>
    response.url().endsWith("/action/knowledge-fetch"),
  );
  await pending[0].fulfill({ json: answer("Fictional obsolete answer") });
  await (await olderResponse).finished();
  await expect(page.getByText("Fictional obsolete answer", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Fictional latest answer" }),
  ).toBeVisible();
  await expect(query).toHaveValue("newer");
  await page.screenshot({
    path: test.info().outputPath("390-fetch-latest-answer.png"),
    fullPage: false,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test("390px navigation reveals the active item and empty analytics offers real next steps", async ({
  page,
}) => {
  // This authorized fixture tenant has no published paths. Do not forge a path
  // filter: the real data boundary correctly rejects unknown identifiers.
  await page.request.get("/fixture/owner-b");
  await page.goto("/app/analytics");
  const nav = page.getByRole("navigation", { name: "Workspace", exact: true });
  await expect
    .poll(() =>
      nav.evaluate((el) => {
        const active = el.querySelector('[aria-current="page"]')?.getBoundingClientRect(),
          box = el.getBoundingClientRect();
        return !!active && active.left >= box.left && active.right <= box.right;
      }),
    )
    .toBe(true);
  await expect(page.getByRole("link", { name: "Review member setup", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review or publish a learning path", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).include(".app-shell").analyze()).violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("390-active-nav-empty-analytics.png"),
    fullPage: false,
  });
});
test("390px upload and details preserve accessible file choice and expandable original fields", async ({
  page,
}, info) => {
  await page.goto("/app/knowledge");
  const file = page.getByLabel("Choose a knowledge source");
  await expect(file).toBeVisible();
  await file.setInputFiles({
    name: "fictional-polish.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Topic,Knowledge Content,Category,Source Reference\r\nFictional polish guide ${info.project.name},Fictional content remains unchanged when fields are collapsed.,Training,Fictional reference\r\n`,
    ),
  });
  await page.getByRole("button", { name: "Save 1 draft records", exact: true }).click();
  await page.getByRole("link", { name: /Review saved resource/ }).click();
  await expect(page.locator("article.workspace-card > .gateway-field-list")).toContainText(
    "Fictional content remains unchanged",
  );
  const detail = page
    .locator("details")
    .filter({ has: page.getByText("Inspect all documented fields", { exact: true }) });
  await expect(detail).not.toHaveAttribute("open");
  await page.screenshot({
    path: test.info().outputPath("390-collapsed-source-fields.png"),
    fullPage: false,
  });
  await page.getByText("Inspect all documented fields", { exact: true }).click();
  await expect(detail).toHaveAttribute("open");
  await expect(detail).toContainText("Fictional reference");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).include(".app-shell").analyze()).violations).toEqual([]);
});
