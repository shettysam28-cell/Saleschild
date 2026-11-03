import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin, safeRedirect } from "@/lib/config";
export async function GET(request: NextRequest) {
  const origin = appOrigin();
  if (!origin)
    return new NextResponse("Account access is being prepared.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  const code = request.nextUrl.searchParams.get("code");
  const client = await createClient();
  if (client && code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeRedirect(request.nextUrl.searchParams.get("next")), origin),
        { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
      );
  }
  return NextResponse.redirect(new URL("/login?notice=invalid-link", origin), {
    headers: { "Cache-Control": "no-store" },
  });
}
