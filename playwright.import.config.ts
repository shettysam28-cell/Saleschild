import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/import-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3347",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] }
      : undefined,
  },
  projects: [
    { name: "desktop-import", use: { ...devices["Desktop Chrome"] } },
    { name: "android-import", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "node tests/import-harness/server.mjs",
    url: "http://127.0.0.1:3347",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
