import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/session";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const client = await createClient();
  const identity = client ? await client.auth.getUser() : null;
  let destination = "/";
  if (identity && !identity.error && identity.data.user?.email_confirmed_at) {
    await requireWorkspace();
    destination = "/app";
  }
  return NextResponse.redirect(new URL(destination, request.url), {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
