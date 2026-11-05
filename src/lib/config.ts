export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith("sb_publishable_")) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))
      return null;
    return { url: parsed.origin, key };
  } catch {
    return null;
  }
}

export function appOrigin() {
  const value = process.env.APP_URL;
  if (!value) {
    if (process.env.NODE_ENV === "production") return null;
    return "http://localhost:3000";
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function safeRedirect(value: string | null | undefined, fallback = "/app") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s\u0000-\u001f]/.test(value)
  )
    return fallback;
  if (
    !/^\/(app(?:\/|\?|$)|onboarding(?:\?|$)|member-setup(?:\?|$)|reset-password(?:\?|$))/.test(
      value,
    )
  )
    return fallback;
  try {
    const parsed = new URL(value, "https://redirect.invalid");
    const decoded = decodeURIComponent(parsed.pathname);
    const normalized = new URL(decoded, "https://redirect.invalid");
    if (
      normalized.origin !== "https://redirect.invalid" ||
      /[\\\s\u0000-\u001f]/.test(decoded) ||
      !/^\/(app(?:\/|$)|onboarding$|member-setup$|reset-password$)/.test(normalized.pathname)
    )
      return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
