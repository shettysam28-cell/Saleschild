import { test, expect, type Page, type TestInfo } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import AxeBuilder from "@axe-core/playwright";
async function workbook(rows: unknown[][]) {
  const w = new ExcelJS.Workbook();
  w.addWorksheet("Company handbook").addRows(rows);
  w.addWorksheet("Reference").addRows([
    ["Reference", "Detail"],
    [
      "Fictional source",
      "This second worksheet is retained and can be selected without reparsing.",
    ],
  ]);
  return Buffer.from(await w.xlsx.writeBuffer());
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.SALESCHILD_EVIDENCE_DIR;
  if (dir) await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: dir
      ? path.join(dir, info.project.name + "-" + name + ".png")
      : info.outputPath(name + ".png"),
    fullPage: false,
  });
}
async function begin(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.request.get("/fixture/owner-a");
  await page.goto("/universal");
  await page.getByLabel("Choose a knowledge source").setInputFiles(file);
  await expect(
    page.getByRole("heading", { name: "Review " + file.name, exact: true }),
  ).toBeVisible();
}
async function savedLinks(page: Page, count: number) {
  await page.getByRole("button", { name: `Save ${count} draft records`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your drafts are saved." })).toBeVisible();
  const links = page.getByRole("link", { name: /Review saved resource/ });
  expect(await links.count()).toBe(count);
  return links.evaluateAll((nodes) => nodes.map((n) => (n as HTMLAnchorElement).pathname));
}
async function approve(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "Approve and publish", exact: true }).click();
  await expect(page.locator(".app-title-row")).toContainText("published");
}
async function createPath(page: Page, title: string) {
  await page.goto("/app/learning");
  await page.getByLabel("Learning path title").fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A fictional existing learning path used to verify persisted company knowledge.");
  await page.getByRole("button", { name: "Create draft path", exact: true }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByRole("link", { name: "Open learning path", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}
async function chooseSource(page: Page, title: string) {
  const label = page.locator(".learning-source-options label").filter({ hasText: title });
  await label.getByRole("checkbox").check();
}
test("custom three-column XLSX: review, recovery, edit, approval and existing path snapshots", async ({
  page,
  browser,
}, info) => {
  const topic = `Device setup ${info.project.name}`,
    second = `Audit routine ${info.project.name}`;
  const original = "Inspect the fictional training indicator before starting the practice device.";
  const corrected =
    "Inspect the indicator and confirm the fictional approved practice mode before starting.";
  await begin(page, {
    name: "company-structure.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await workbook([
      ["Fictional company handbook"],
      [],
      ["Procedure", "Role", "Local practice"],
      [topic, "Operations", original],
      [topic, "Operations", original],
      [
        topic,
        "Operations",
        "Pause the fictional device when its amber training indicator appears.",
      ],
      ["x", "", ""],
    ]),
  });
  await expect(
    page.getByRole("list", { name: "Knowledge upload progress" }).getByRole("listitem"),
  ).toHaveCount(3);
  await page.getByLabel("Header row", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Skip all exact duplicates", exact: true }).click();
  await expect(page.getByLabel("Exclude row 5", { exact: true })).toBeChecked();
  const possible = page
    .locator(".gateway-row")
    .filter({ has: page.getByLabel("Row 6 title", { exact: true }) });
  await possible.getByText(/Inspect 1 possible duplicate/).click();
  await page.getByLabel("Keep row 6 as a separate record", { exact: true }).check();
  const invalid = page
    .locator(".gateway-row")
    .filter({ has: page.getByLabel("Row 7 title", { exact: true }) });
  await invalid.getByText("Edit values and view source", { exact: true }).click();
  await page.getByLabel("Row 7 title", { exact: true }).fill(second);
  await page
    .getByLabel("Row 7 Local practice (c3)", { exact: true })
    .fill(`Record the fictional audit outcome in the ${info.project.name} training checklist.`);
  const first = page
    .locator(".gateway-row")
    .filter({ has: page.getByLabel("Row 4 title", { exact: true }) });
  await first.getByText("Edit values and view source", { exact: true }).click();
  await page.getByLabel("Row 4 Local practice (c3)", { exact: true }).fill(corrected);
  await expect
    .poll(async () => {
      const form = new FormData();
      form.set("payload", JSON.stringify(new URL(page.url()).searchParams.get("upload")));
      const r = await page.request.post("/action/gateway-load", {
        multipart: { payload: String(form.get("payload")) },
      });
      return (await r.json()).upload?.choices?.edits?.["0:4"]?.values?.c3;
    })
    .toBe(corrected);
  await page.reload();
  await expect(page.getByLabel("Header row", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Exclude row 5", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Keep row 6 as a separate record", { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize()!.width);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await expect(
    page.getByLabel("Public information verification", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Public information verification", { exact: true })).toBeDisabled();
  await screenshot(page, info, "review");
  await page.locator(".gateway-review-cards").scrollIntoViewIfNeeded();
  await screenshot(page, info, "review-records");
  let lost = false;
  await page.route("**/action/gateway-save", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save 3 draft records", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Connection interrupted");
  const urls = await savedLinks(page, 3);
  const recordId = urls[0].split("/").at(-1)!;
  const other = await browser.newContext();
  await other.request.get("http://127.0.0.1:3347/fixture/owner-b");
  expect(
    await (await other.request.get("http://127.0.0.1:3347/record-data?id=" + recordId)).json(),
  ).toBeNull();
  await other.close();
  await page.goto(urls[0]);
  await expect(page.locator(".gateway-field-list").first()).toContainText(corrected);
  await page.getByText("Original source and provenance", { exact: true }).click();
  await expect(
    page
      .locator(".workspace-card")
      .filter({ has: page.getByText("Original source and provenance", { exact: true }) }),
  ).toContainText(original);
  await page.getByText("Edit knowledge fields", { exact: true }).click();
  const final =
    "The final fictional setup instruction adds a supervisor check before practice begins.";
  await page.getByLabel("Local practice value (c3)", { exact: true }).fill(final);
  await page.getByRole("button", { name: "Save field changes as draft", exact: true }).click();
  await expect(page.locator(".app-title-row")).toContainText("Version 2");
  await page.getByRole("button", { name: "Approve and publish", exact: true }).click();
  await expect(page.locator(".app-title-row")).toContainText("published");
  await approve(page, urls[1]);
  const pathUrl = await createPath(page, `Existing path ${info.project.name}`);
  // Both approved records intentionally share a title; select them separately.
  const sourceChecks = page
    .locator(".learning-source-options label")
    .filter({ hasText: topic })
    .getByRole("checkbox");
  const selectedOrder = [
    await sourceChecks.nth(0).inputValue(),
    await sourceChecks.nth(1).inputValue(),
  ];
  await sourceChecks.nth(0).check();
  await sourceChecks.nth(1).check();
  await page.getByRole("button", { name: "Move lesson 2 up", exact: true }).click();
  let pathLost = false;
  await page.route("**/action/path-add", async (route) => {
    if (!pathLost) {
      pathLost = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Add 2 approved resources", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("response was interrupted");
  await page.getByRole("button", { name: "Add 2 approved resources", exact: true }).click();
  await page.getByText("Source coverage and curator details", { exact: true }).click();
  const lessons = page.getByRole("list", { name: "Learning Path lessons" });
  await expect(lessons.getByRole("listitem")).toHaveCount(2);
  await expect(lessons).toContainText(final);
  await page.reload();
  await page.getByText("Source coverage and curator details", { exact: true }).click();
  await expect(lessons.getByRole("listitem")).toHaveCount(2);
  await expect(lessons).toContainText("Local practice");
  await screenshot(page, info, "learning-path");
  const snapshots = await (
    await page.request.get("/path-data?id=" + pathUrl.split("/").at(-1))
  ).json();
  expect(snapshots.lessons).toHaveLength(2);
  expect(snapshots.lessons[0].source_knowledge_id).toBe(selectedOrder[1]);
  await page.goto(urls[0]);
  await page.getByText("Edit knowledge fields", { exact: true }).click();
  await page
    .getByLabel("Local practice value (c3)", { exact: true })
    .fill(
      "A later draft revision must not replace the approved snapshot inside the existing path.",
    );
  await page.getByRole("button", { name: "Save field changes as draft", exact: true }).click();
  await expect(page.locator(".app-title-row")).toContainText("draft");
  await page.goto(pathUrl);
  await page.getByText("Source coverage and curator details", { exact: true }).click();
  await expect(page.getByRole("list", { name: "Learning Path lessons" })).toContainText(final);
  await expect(page.getByRole("list", { name: "Learning Path lessons" })).not.toContainText(
    "later draft revision",
  );
  await page.getByRole("link", { name: "Saleschild home", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});
for (const format of ["csv", "xlsx"] as const)
  test(`company multi-column ${format} reaches a reopened Learning Path`, async ({
    page,
  }, info) => {
    const title = `Company ${format} ${info.project.name}`,
      note =
        "Use the locally approved fictional guide; retain the company-defined labels and values.";
    const headers = [
        "Practice name",
        "Department",
        "Support tier",
        "Company guidance",
        "Reviewed date",
      ],
      values = [title, "Operations", "Tier 2", note, "2026-11-01"];
    const buffer =
      format === "csv"
        ? Buffer.from(
            [headers, values]
              .map((r) => r.map((v) => '"' + v.replaceAll('"', '""') + '"').join(";"))
              .join("\r\n"),
          )
        : await workbook([headers, values]);
    await begin(page, {
      name: `company-multi.${format}`,
      mimeType:
        format === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    const urls = await savedLinks(page, 1);
    await approve(page, urls[0]);
    const pathUrl = await createPath(page, `Path ${format} ${info.project.name}`);
    await chooseSource(page, title);
    await page.getByRole("button", { name: "Add 1 approved resources", exact: true }).click();
    await page.getByText("Source coverage and curator details", { exact: true }).click();
    await expect(page.getByRole("list", { name: "Learning Path lessons" })).toContainText(note);
    await page.goto(pathUrl);
    await page.getByText("Source coverage and curator details", { exact: true }).click();
    await expect(page.getByRole("list", { name: "Learning Path lessons" })).toContainText(
      "Support tier",
    );
    await expect(page.getByRole("list", { name: "Learning Path lessons" })).toContainText(
      "2026-11-01",
    );
  });
test("structured DOCX sections become approved persisted Learning Path lessons", async ({
  page,
}, info) => {
  const parts = unzipSync(
    new Uint8Array(await readFile("tests/fixtures/documents/structured-guide.docx")),
  );
  parts["word/document.xml"] = strToU8(
    strFromU8(parts["word/document.xml"]).replaceAll(
      "Device preparation",
      `Device preparation ${info.project.name}`,
    ),
  );
  await begin(page, {
    name: "company-guide.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(zipSync(parts)),
  });
  await expect(page.getByText(/OCR is unavailable/)).toBeVisible();
  await screenshot(page, info, "docx-review");
  const urls = await savedLinks(page, 2);
  for (const url of urls) await approve(page, url);
  const pathUrl = await createPath(page, `Document path ${info.project.name}`);
  const choices = page
    .locator(".learning-source-options label")
    .filter({ hasText: `Device preparation ${info.project.name}` })
    .getByRole("checkbox");
  await choices.nth(0).check();
  await choices.nth(1).check();
  await page.getByRole("button", { name: "Add 2 approved resources", exact: true }).click();
  await page.getByText("Source coverage and curator details", { exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Learning Path lessons" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.goto(pathUrl);
  await page.getByText("Source coverage and curator details", { exact: true }).click();
  const lessons = page.getByRole("list", { name: "Learning Path lessons" });
  await expect(lessons).toContainText("Indicator 🧰 | Operations");
  await expect(lessons).toContainText("designated training coordinator");
});
test("anonymous logo resolves to marketing without a fixture session", async ({ page }) => {
  await page.goto("/marketing");
  await page.getByRole("link", { name: "Saleschild home", exact: true }).click();
  await expect(page).toHaveURL(/\/marketing$/);
});
