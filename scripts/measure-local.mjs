import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
const output = "docs/internal/review/phase-1";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const result = [];
for (const mobile of [false, true]) {
  const context = await browser.newContext(
    mobile ? { ...devices["Pixel 5"] } : { viewport: { width: 1280, height: 800 } },
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__saleschildMetrics = { cls: 0, lcp: 0, longTasks: [], events: [] };
    const m = window.__saleschildMetrics;
    new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => {
        if (!e.hadRecentInput) m.cls += e.value;
      }),
    ).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => (m.lcp = e.startTime)),
    ).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => m.longTasks.push(e.duration)),
    ).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => m.events.push(e.duration)),
    ).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });
  await page.goto("http://localhost:3000");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const initial = await page.evaluate(() => ({
    entries: performance.getEntriesByType("resource").map((e) => ({
      name: new URL(e.name).pathname,
      bytes: e.transferSize,
      type: e.initiatorType,
    })),
    ...window.__saleschildMetrics,
  }));
  await page
    .getByRole("navigation", { name: "Knowledge transformation stages" })
    .getByRole("button", { name: /Purposeful learning/ })
    .click();
  const frames = await page.evaluate(async () => {
    const samples = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      const current = performance.now();
      samples.push(current - last);
      last = current;
      window.scrollBy({ top: i < 60 ? 9 : -9, behavior: "instant" });
    }
    samples.sort((a, b) => a - b);
    return {
      frames: samples.length,
      p50ms: samples[Math.floor(samples.length * 0.5)],
      p95ms: samples[Math.floor(samples.length * 0.95)],
      over50ms: samples.filter((n) => n > 50).length,
    };
  });
  const after = await page.evaluate(() => window.__saleschildMetrics);
  result.push({
    profile: mobile
      ? "Pixel 5 touch emulation, unthrottled local"
      : "Desktop Chromium 1280x800, unthrottled local",
    initialLoad: initial,
    afterInteraction: after,
    scrollFrames: frames,
    pins: await page.locator(".pin-spacer").count(),
  });
  await context.close();
}
await browser.close();
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      ),
    )
  ).flat();
}
const chunks = [];
for (const file of (await files(".next/static")).filter((f) => f.endsWith(".js"))) {
  const data = await readFile(file);
  chunks.push({ file, bytes: data.length, gzipBytes: gzipSync(data).length });
}
await writeFile(
  `${output}/local-performance.json`,
  JSON.stringify(
    {
      conditions:
        "Lab diagnostics only. No field CWV/INP or physical-device claim. Headless shared executor; screenshot/video recording was not active for these measurements.",
      profiles: result,
      totalJavaScriptChunks: {
        count: chunks.length,
        bytes: chunks.reduce((n, c) => n + c.bytes, 0),
        gzipBytes: chunks.reduce((n, c) => n + c.gzipBytes, 0),
      },
      chunks,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    result.map((p) => ({
      profile: p.profile,
      lcpMs: p.initialLoad.lcp,
      cls: p.afterInteraction.cls,
      pins: p.pins,
      scrollFrames: p.scrollFrames,
    })),
    null,
    2,
  ),
);
