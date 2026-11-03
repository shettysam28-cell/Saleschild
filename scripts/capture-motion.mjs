import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = "docs/internal/review/phase-1";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: `${output}/video`, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000");
await page.locator('[data-cinematic="true"]').waitFor();
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${output}/hero-desktop.png` });
const navigation = page.getByRole("navigation", { name: "Knowledge transformation stages" });
for (const name of [
  "Scattered information",
  "Connected knowledge",
  "Structured records",
  "Purposeful learning",
  "Performance intelligence",
  "Structured records",
  "Scattered information",
]) {
  await navigation.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForTimeout(450);
  if (name === "Purposeful learning")
    await page.screenshot({ path: `${output}/transformation-desktop.png` });
}
await page
  .getByRole("navigation", { name: "Product journey" })
  .getByRole("button", { name: /Intelligence/ })
  .click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${output}/journey-desktop.png` });
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(700);
await context.close();
await page.video().saveAs(`${output}/scroll-story.webm`);
const quiet = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const qp = await quiet.newPage();
await qp.goto("http://localhost:3000");
await qp.evaluate(() => document.fonts.ready);
await qp.screenshot({ path: `${output}/home-desktop.png`, fullPage: true });
await qp.goto("http://localhost:3000/contact");
await qp.screenshot({ path: `${output}/contact-desktop.png`, fullPage: true });
await quiet.close();
const mobile = await browser.newContext({ ...devices["Pixel 5"] });
const mp = await mobile.newPage();
await mp.goto("http://localhost:3000");
await mp.evaluate(() => document.fonts.ready);
await mp.screenshot({ path: `${output}/home-android.png`, fullPage: true });
await mp.goto("http://localhost:3000/contact");
await mp.screenshot({ path: `${output}/contact-android.png`, fullPage: true });
await mobile.close();
await browser.close();
await writeFile(
  `${output}/capture.json`,
  JSON.stringify(
    {
      environment: "Local Chromium; Pixel 5 emulation is not physical Android hardware",
      errors,
      recording: "scroll-story.webm",
    },
    null,
    2,
  ),
);
if (errors.length) throw new Error("Browser errors during capture");
console.log("Desktop, Android-emulated screenshots and forward/reverse scroll recording captured.");
