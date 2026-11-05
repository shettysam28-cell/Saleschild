import { test, expect, type Page, type TestInfo } from "@playwright/test";
import ExcelJS from "exceljs";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { columns, sampleRecord } from "../../src/lib/knowledge/templates";

async function evidence(page: Page, info: TestInfo, name: string) {
  const dir = process.env.SALESCHILD_EVIDENCE_DIR;
  if (dir) await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: dir ? path.join(dir, `${info.project.name}-${name}.png`) : info.outputPath(`${name}.png`),
    fullPage: false,
  });
}
async function data(page: Page, endpoint: string) {
  const response = await page.request.get(endpoint);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function action(page: Page, name: string, payload: unknown) {
  const response = await page.request.post(`/action/${name}`, {
    multipart: { payload: JSON.stringify(payload) },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test("official XLSX reaches published learning, member checkpoint, resume and tenant-safe reopening", async ({
  page,
  browser,
}, info) => {
  await page.request.get("/fixture/owner-a");
  const download = await page.request.get(
    "/app/knowledge/templates?id=product&format=xlsx&variant=blank",
  );
  expect(download.ok()).toBe(true);
  expect(download.headers()["content-disposition"]).toContain("saleschild-product-blank.xlsx");
  const workbook = new ExcelJS.Workbook();
  const downloadedWorkbook = await download.body();
  await workbook.xlsx.load(
    downloadedWorkbook as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sample = workbook.getWorksheet("Sample Data")!;
  const titles = [
    `Learning source alpha ${info.project.name}`,
    `Learning source beta ${info.project.name}`,
  ];
  for (const title of titles) {
    const record = sampleRecord("product");
    record.Topic = title;
    sample.addRow(columns.map((column) => record[column]));
  }
  await page.goto("/app/knowledge");
  await page.getByLabel("Choose a knowledge source").setInputFiles({
    name: "fictional-learning.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(
    page.getByRole("heading", { name: "Review fictional-learning.xlsx", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Worksheet", { exact: true }).selectOption({ label: "Sample Data" });
  await page.getByRole("button", { name: "Save 2 draft records", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your drafts are saved." })).toBeVisible();
  const resourceLinks = await page
    .getByRole("link", { name: /Review saved resource/ })
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).pathname));
  expect(resourceLinks).toHaveLength(2);
  for (const link of resourceLinks) {
    await page.goto(link);
    await page.getByRole("button", { name: "Approve and publish", exact: true }).click();
    await expect(page.locator(".app-title-row")).toContainText("published");
  }
  const pathTitle = `Published learning journey ${info.project.name}`;
  await page.goto("/app/learning");
  await page.getByLabel("Learning path title").fill(pathTitle);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Fictional source-backed learning for local regression verification.");
  await page.getByRole("button", { name: "Create draft path", exact: true }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: pathTitle, exact: true }) });
  await card.getByRole("link", { name: "Open learning path", exact: true }).click();
  const pathUrl = new URL(page.url()).pathname;
  const pathId = pathUrl.split("/").at(-1)!;
  for (const title of titles)
    await page
      .locator(".learning-source-options label")
      .filter({ hasText: title })
      .getByRole("checkbox")
      .check();
  await page.getByRole("button", { name: "Add 2 approved resources", exact: true }).click();
  const ownerPreview = page.locator(".learning-experience");
  await expect(ownerPreview.getByRole("heading", { name: "Owner lesson preview" })).toBeVisible();
  let ownerProgressWrites = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/action/learning-progress")) ownerProgressWrites++;
  });
  await ownerPreview
    .getByRole("button", { name: "Continue to knowledge check", exact: true })
    .click();
  await expect(
    ownerPreview.getByRole("button", { name: "Complete knowledge check", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("I have reviewed the source coverage and the learning preview.").check();
  await page.getByRole("button", { name: "Publish learning path", exact: true }).click();
  await expect(
    page.getByText("Published edition 1 includes 2 lessons.", { exact: false }),
  ).toBeVisible();
  expect(ownerProgressWrites).toBe(0);
  const before = await data(page, "/progress-data");
  expect(before.error).toBeUndefined();
  const pathBefore = before.rows.find((row: { course_id: string }) => row.course_id === pathId);
  expect(pathBefore).toMatchObject({ completed_units: 0, total_units: 2, started_at: null });
  await page.getByRole("button", { name: "Create revision guide", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your revision guide is saved" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open revision guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Key concepts", exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Review cards", exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Key concepts", exact: true })).toHaveCount(2);
  await evidence(page, info, "saved-revision-guide");
  await page.goto(pathUrl);
  await evidence(page, info, "owner-spectator");
  const groups = await data(page, "/draft-data");
  const protectedGroup = groups.groups.find((group: { records: { title: string }[] }) =>
    group.records.some((record) => record.title === titles[0]),
  );
  expect(protectedGroup.publishedCount).toBe(2);
  const protectedDiscard = await action(page, "draft-discard", {
    id: protectedGroup.id,
    kind: protectedGroup.kind,
    confirmed: true,
    records: protectedGroup.records.map((record: { id: string; version: number }) => ({
      id: record.id,
      version: record.version,
    })),
  });
  expect(protectedDiscard.error).toContain("approved knowledge or learning dependencies");

  const foreign = await browser.newContext();
  await foreign.request.get("http://127.0.0.1:3347/fixture/learner-b");
  const foreignPath = await foreign.request.get(`http://127.0.0.1:3347/path-data?id=${pathId}`);
  expect(await foreignPath.json()).toBeNull();
  await foreign.close();

  await page.request.get("/fixture/learner-a");
  await page.goto(pathUrl);
  const member = page.locator(".learning-experience");
  await expect(member.getByRole("heading", { name: "Your learning path" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Knowledge Gateway", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Progression", exact: true }),
  ).toBeVisible();
  let saved = await data(page, `/learning-data?id=${pathId}`);
  expect(saved.progress).toEqual([]);
  await page.reload();
  saved = await data(page, `/learning-data?id=${pathId}`);
  expect(saved.progress).toEqual([]);
  await page.getByRole("button", { name: "Create revision guide", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your revision guide is saved" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open revision guide", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Review cards", exact: true })).toHaveCount(2);
  expect((await data(page, `/learning-data?id=${pathId}`)).progress).toEqual([]);
  await page.goto(pathUrl);
  await member.getByRole("button", { name: "Start lesson", exact: true }).click();
  await expect(member.getByRole("status").filter({ hasText: "Your place is saved" })).toBeVisible();
  await member.getByRole("button", { name: "Continue to knowledge check", exact: true }).click();
  await member.getByRole("button", { name: "Save my place", exact: true }).click();
  await expect(member.getByRole("status").filter({ hasText: "Your place is saved" })).toBeVisible();
  await page.reload();
  await expect(member.getByRole("heading", { name: "Knowledge check", exact: true })).toBeVisible();
  const wrong = member.getByRole("radio").filter({ hasText: "" });
  const wrongValue = await wrong.evaluateAll(
    (nodes, correct) => (nodes as HTMLInputElement[]).find((node) => node.value !== correct)?.value,
    titles[0],
  );
  expect(wrongValue).toBeTruthy();
  await member.getByRole("radio", { name: wrongValue!, exact: true }).check();
  await member.getByRole("button", { name: "Complete knowledge check", exact: true }).click();
  await expect(member.getByRole("alert")).toContainText("Review the approved source");
  await member.getByRole("radio", { name: titles[0], exact: true }).check();
  await member.getByRole("button", { name: "Complete knowledge check", exact: true }).click();
  await expect(
    member.getByRole("status").filter({ hasText: "Knowledge check passed" }),
  ).toBeVisible();
  saved = await data(page, `/learning-data?id=${pathId}`);
  const completed = saved.progress[0];
  expect(completed).toMatchObject({ checkpoint_passed: true });
  expect(completed.completed_at).toBeTruthy();
  const replay = await action(page, "learning-progress", {
    courseId: pathId,
    revisionId: saved.revision.id,
    unitId: completed.unit_id,
    action: "complete",
    step: 1,
    evidence: titles[0],
  });
  expect(replay.progress.completed_at).toBe(completed.completed_at);
  await member.getByRole("button", { name: "Next lesson", exact: true }).click();
  await member.getByRole("button", { name: "Continue to knowledge check", exact: true }).click();
  await member.getByRole("button", { name: "Save my place", exact: true }).click();
  await page.reload();
  await expect(
    member.getByRole("heading", { level: 3, name: titles[1], exact: true }),
  ).toBeVisible();
  await expect(member.getByRole("heading", { name: "Knowledge check", exact: true })).toBeVisible();
  await expect(
    member.getByRole("status").filter({ hasText: "1 of 2 eligible units completed" }),
  ).toBeVisible();
  await evidence(page, info, "member-checkpoint-resume");
  const violations = (await new AxeBuilder({ page }).include(".app-shell").analyze()).violations;
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.goto("/app/progression");
  await expect(page.getByRole("heading", { name: pathTitle, exact: true })).toBeVisible();
  const row = page
    .locator(".progression-path")
    .filter({ has: page.getByRole("heading", { name: pathTitle, exact: true }) });
  await expect(row).toContainText("1 of 2 units complete");
  await row.getByRole("link", { name: "Continue learning", exact: true }).click();
  await expect(
    member.getByRole("heading", { level: 3, name: titles[1], exact: true }),
  ).toBeVisible();
  await page.request.get("/fixture/owner-a");
  await page.goto(`/app/analytics?path=${pathId}`);
  await expect(
    page.getByRole("table", { name: "Current published content by member and learning path" }),
  ).toContainText(pathTitle);
  await expect(
    page.getByRole("table", { name: "Member completion and path counts" }),
  ).toContainText("1 / 2");
  await evidence(page, info, "owner-learning-analytics");
});

test("Draft Manager resumes an upload and safely discards saved drafts after a lost response", async ({
  page,
}, info) => {
  await page.request.get("/fixture/owner-a");
  const title = `Discardable fictional source ${info.project.name}`;
  const filename = `fictional-discard-${info.project.name}.csv`;
  await page.goto("/app/knowledge");
  await page.getByLabel("Choose a knowledge source").setInputFiles({
    name: filename,
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Procedure,Documented detail\r\n${title},Keep this fictional source only while its draft is being reviewed.\r\n`,
    ),
  });
  await expect(
    page.getByRole("heading", { name: `Review ${filename}`, exact: true }),
  ).toBeVisible();
  await page.goto("/app/knowledge?view=drafts");
  const manager = page.getByRole("region", { name: "Draft Manager", exact: true });
  await expect(
    page.getByRole("heading", { name: "Resume a private review", exact: true }),
  ).toHaveCount(0);
  let group = manager.locator(".draft-group").filter({ hasText: filename });
  await group.getByRole("link", { name: "Resume review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `Review ${filename}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save 1 draft records", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your drafts are saved." })).toBeVisible();
  await page.goto("/app/knowledge?view=drafts");
  group = manager.locator(".draft-group").filter({ hasText: filename });
  await expect(group).toContainText("1 drafts");
  await expect(group.getByRole("link").filter({ hasText: title })).toBeVisible();
  await group.getByRole("button", { name: "Discard draft group", exact: true }).click();
  let interrupted = false;
  await page.route("**/action/draft-discard", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await group.getByRole("button", { name: "Confirm discard", exact: true }).click();
  await expect(manager.getByRole("status")).toContainText("Connection interrupted");
  await group.getByRole("button", { name: "Confirm discard", exact: true }).click();
  await expect(manager.getByRole("status")).toContainText("Draft group discarded");
  await expect(group).toContainText("1 discarded");
  await expect(group.getByRole("link").filter({ hasText: title })).toHaveCount(0);
  await page.reload();
  await expect(manager).toContainText("1 discarded");
  await expect(group.getByRole("link").filter({ hasText: title })).toHaveCount(0);
  await evidence(page, info, "draft-manager-discard");
});

test("workspace appearance and grounded Fetch work with keyboard, reload and reduced motion", async ({
  page,
}, info) => {
  await page.request.get("/fixture/owner-a");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/app");
  const account = page.getByRole("button", {
    name: /Fictional Owner.*owner.*Fictional organization/,
  });
  await account.click();
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-workspace-theme", "dark");
  await evidence(page, info, "workspace-dark-menu");
  expect((await new AxeBuilder({ page }).include(".app-shell").analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-workspace-theme", "dark");
  await account.click();
  await page.getByRole("radio", { name: "System", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-workspace-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-workspace-theme", "dark");
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await page.keyboard.press("Escape");
  const query = page.getByLabel("What would you like to find?");
  let searches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/action/knowledge-fetch")) searches++;
  });
  await page.getByRole("button", { name: "Fictional", exact: true }).click();
  await expect(query).toHaveValue("Fictional");
  expect(searches).toBe(0);
  await page.getByRole("button", { name: "Fetch knowledge", exact: true }).click();
  await expect(page.locator(".fetch-results").getByRole("status")).toContainText(
    /Answer extracted|No matching approved/,
  );
  await query.fill("absent-unique-factual-needle-8675309");
  await page.getByRole("button", { name: "Fetch knowledge", exact: true }).click();
  await expect(page.locator(".fetch-results").getByRole("status")).toContainText(
    "No matching approved knowledge",
  );
  await evidence(page, info, "workspace-light-fetch");
  expect((await new AxeBuilder({ page }).include(".app-shell").analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.reload();
  await expect(query).toHaveValue("");
  await expect(page.locator(".fetch-results")).toHaveCount(0);
});

test("keyword and natural-question Fetch presents grounded answers with expandable version citations", async ({
  page,
}, info) => {
  await page.request.get("/fixture/owner-a");
  const title = `Refund guidance ${info.project.name}`;
  await page.goto("/app/knowledge");
  await page.getByLabel("Choose a knowledge source").setInputFiles({
    name: `fictional-refund-${info.project.name}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Topic,Process Steps,Knowledge Content\r\n${title},Submit the fictional refund form to the sample support lead.,Fictional refunds require the sample receipt.\r\n`,
    ),
  });
  await expect(
    page.getByRole("heading", {
      name: `Review fictional-refund-${info.project.name}.csv`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save 1 draft records", exact: true }).click();
  await page.getByRole("link", { name: /Review saved resource/ }).click();
  await page.getByRole("button", { name: "Approve and publish", exact: true }).click();
  await expect(page.locator(".app-title-row")).toContainText("published");
  const sourceId = new URL(page.url()).pathname.split("/").at(-1)!;
  const approvedVersion = (await data(page, "/record-data?id=" + sourceId)).record.current_version;
  expect(approvedVersion).toBeGreaterThan(1);
  await page.goto("/app/knowledge?view=library");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Draft Manager", exact: true })).toHaveCount(0);
  await page.goto("/app");
  await page.getByLabel("What would you like to find?").fill("How do I request a refund?");
  await page.getByRole("button", { name: "Fetch knowledge", exact: true }).click();
  const result = page.locator(".fetch-results");
  await expect(result.getByRole("heading", { name: "Answer", exact: true })).toBeVisible();
  await expect(result).toContainText("sample support lead");
  await expect(result.locator(".answer-citations")).not.toHaveAttribute("open");
  await result.getByRole("link", { name: "Read supporting citation", exact: true }).click();
  await expect(result.locator(".answer-citations")).toHaveAttribute("open");
  await expect(
    result
      .getByRole("link", { name: `Open approved source · version ${approvedVersion}`, exact: true })
      .first(),
  ).toBeVisible();
  await expect(result.locator("blockquote").first()).toContainText("fictional refund form");
  await evidence(page, info, "grounded-answer-citations");
});
