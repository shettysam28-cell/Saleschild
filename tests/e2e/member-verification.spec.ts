import { test, expect } from "@playwright/test";
test("member verification stays disabled until its approved sending configuration is enabled", async ({
  page,
}) => {
  const response = await page.goto("/member-verification");
  await expect(page.getByRole("heading", { name: "Verify your email." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request verification email" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("awaiting secure setup");
  expect(response?.headers()["cache-control"]).toContain("no-store");
});
test("member confirmation removes returned credentials and requires explicit password sign-in", async ({
  page,
}) => {
  let providerWrites = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("supabase")) providerWrites++;
  });
  const response = await page.goto(
    "/member-confirmed?code=fictional-test-code#access_token=fictional-test-token",
  );
  await expect(page.getByRole("heading", { name: "Continue your member setup." })).toBeVisible();
  await expect(page).toHaveURL(/\/member-confirmed$/);
  await expect(page.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(providerWrites).toBe(0);
});
