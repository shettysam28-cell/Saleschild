import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/config";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (
    /(^|\/)(AGENTS\.md|SALESCHILD_SKILLS\.md|skills?\.md|SKILL\.md|docs|supabase|scripts|tests|\.git|\.env[^/]*|\.agents|\.codex(?:-attachments)?|\.github)(\/|$)/i.test(
      decoded,
    )
  )
    return new NextResponse("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
    });
  let response = NextResponse.next({ request });
  const privatePath =
    /^\/(app(?:\/|$)|onboarding|auth(?:\/|$)|login|register|forgot-password|reset-password)/.test(
      path,
    );
  if (!privatePath) return response;
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const config = supabaseConfig();
  if (!config) {
    if (path === "/app" || path.startsWith("/app/") || path === "/onboarding") {
      response = NextResponse.redirect(new URL("/login?notice=unavailable", request.url));
      response.headers.set("Cache-Control", "private, no-store");
    }
    return response;
  }
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(values, headers) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (headers)
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, String(value)),
          );
        response.headers.set("Cache-Control", "private, no-store, max-age=0");
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
      },
    },
  });
  const { data, error } = await client.auth.getClaims();
  if ((error || !data?.claims) && (/^\/app(?:\/|$)/.test(path) || path === "/onboarding")) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma", "x-robots-tag"]) {
      const value = response.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }
    return redirect;
  }
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"] };
