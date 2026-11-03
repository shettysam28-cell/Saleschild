import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/config";
export async function GET(request: NextRequest) {
  const origin = appOrigin();
  if (!origin)
    return new NextResponse("Account access is being prepared.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const client = await createClient();
  if (client && token_hash && ["email", "recovery"].includes(type ?? "")) {
    const { error } = await client.auth.verifyOtp({
      token_hash,
      type: type as "email" | "recovery",
    });
    if (!error)
      return NextResponse.redirect(
        new URL(type === "recovery" ? "/reset-password" : "/app", origin),
        { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
      );
  }
  return NextResponse.redirect(new URL("/login?notice=invalid-link", origin), {
    headers: { "Cache-Control": "no-store" },
  });
}
