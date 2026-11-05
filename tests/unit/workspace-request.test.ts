import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceFetch } from "@/lib/supabase/request";
afterEach(() => vi.unstubAllGlobals());
describe("bounded workspace provider requests", () => {
  it("preserves fetch input and options while adding a deadline", async () => {
    const response = new Response("fictional");
    const provider = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", provider);
    expect(
      await workspaceFetch("https://example.test/data", { method: "GET", cache: "no-store" }),
    ).toBe(response);
    expect(provider.mock.calls[0][0]).toBe("https://example.test/data");
    expect(provider.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(provider.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("preserves caller cancellation instead of leaving authorization requests running", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = vi.fn().mockImplementation((_input, init) => {
      expect(init.signal.aborted).toBe(true);
      return Promise.reject(new DOMException("Cancelled", "AbortError"));
    });
    vi.stubGlobal("fetch", provider);
    await expect(
      workspaceFetch(new Request("https://example.test/auth", { signal: controller.signal })),
    ).rejects.toThrow("Cancelled");
  });
});
