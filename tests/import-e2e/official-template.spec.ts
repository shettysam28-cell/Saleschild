import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { columns, sampleRecord } from "../../src/lib/knowledge/templates";
test("official template completes all six steps, publication and academy readiness", async ({
  page,
  browser,
}, info) => {
  await page.request.get("/fixture/owner-a");
  await page.goto("/");
  await page.getByRole("button", { name: /Start with a Template/ }).click();
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download Product Knowledge blank xlsx template", exact: true })
    .click();
  const download = await waiting;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const sheet = workbook.getWorksheet("Sample Data")!;
  const record = sampleRecord("product");
  record.Topic = `Template journey ${info.project.name}`;
  record["Process Steps"] = "- Ask the customer about their needs.\n- Request an approved quote.";
  sheet.addRow(columns.map((c) => record[c]));
  sheet.addRow(
    columns.map((c) =>
      c === "Topic" ? "Incomplete record" : c === "Knowledge Content" ? "short" : "",
    ),
  );
  sheet.getCell("A5000").font = { bold: true };
  await page.getByLabel("Choose your knowledge source").setInputFiles({
    name: "completed-official.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(page.getByRole("heading", { name: /Preview: completed-official/ })).toBeVisible();
  await page.getByRole("button", { name: "Map columns", exact: true }).click();
  await expect(page.getByLabel("Topic *", { exact: true })).toHaveValue("Topic");
  await expect(page.getByLabel("Knowledge Content *", { exact: true })).toHaveValue(
    "Knowledge Content",
  );
  await page.getByRole("button", { name: "Validate records", exact: true }).click();
  await expect(page.getByText(/Knowledge Content must contain 20/)).toBeVisible();
  await page.getByLabel("Exclude row 3").check();
  await page.getByRole("button", { name: "Revalidate selected rows" }).click();
  await page.getByRole("button", { name: "Review import", exact: true }).click();
  let dropped = false;
  await page.route("**/action/validate", async (route) => {
    if (!dropped && route.request().postData()?.includes('name="approve"')) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Approve and import 1 drafts" }).click();
  await expect(page.getByRole("alert")).toContainText("Connection interrupted");
  await page.getByRole("button", { name: "Approve and import 1 drafts" }).click();
  await expect(page.locator('.form-message[role="status"]')).toContainText("1 records imported");
  const records = page.locator('[aria-label="Saved knowledge"]');
  await expect(records.getByRole("heading", { name: record.Topic, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check academy readiness" }).click();
  const before = await page.request.post("/action/academy", { multipart: {} });
  expect(JSON.stringify(await before.json())).not.toContain(record.Topic);
  const other = await browser.newContext();
  await other.request.get("http://127.0.0.1:3347/fixture/owner-b");
  expect(await (await other.request.get("http://127.0.0.1:3347/records")).text()).not.toContain(
    record.Topic,
  );
  await other.close();
  const card = records
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: record.Topic, exact: true }) });
  await card.getByText("Edit this draft", { exact: true }).click();
  await card.getByLabel("Publication status").selectOption("published");
  await card.getByRole("button", { name: "Save draft changes" }).click();
  await expect(card.getByRole("status")).toContainText("updated");
  await page.reload();
  await page.getByRole("button", { name: "Check academy readiness" }).click();
  await expect(
    page.getByRole("button", { name: "Generate My Learning Academy", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Generate My Learning Academy", exact: true }).click();
  await expect(page.locator('[aria-label="Deterministic academy preview"]')).toContainText(
    record.Topic,
  );
});
