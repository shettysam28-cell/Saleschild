import { createMemberAdminHandler } from "./handler.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
function managedKey(dictionary: string, legacy: string) {
  try {
    const values = JSON.parse(Deno.env.get(dictionary) ?? "{}");
    if (typeof values.default === "string") return values.default;
  } catch {
    /* Invalid configuration remains closed. */
  }
  return Deno.env.get(legacy) ?? "";
}
Deno.serve(
  createMemberAdminHandler({
    url: Deno.env.get("SUPABASE_URL") ?? "",
    publicKey: managedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    adminKey: managedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    enabled: Deno.env.get("DEVELOPMENT_MEMBER_PROVISIONING_ENABLED") === "true",
  }),
);
