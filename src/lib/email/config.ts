const consumerDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
]);
export function emailConfig(env: Record<string, string | undefined> = process.env) {
  if (env.RESEND_SENDING_ENABLED !== "true" || !env.RESEND_API_KEY || !env.RESEND_FROM) return null;
  const from = env.RESEND_FROM.trim();
  const match = /^[^\s<>@]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(from);
  if (!match || consumerDomains.has(match[1].toLowerCase())) return null;
  return {
    apiKey: env.RESEND_API_KEY,
    from: `Saleschild <${from}>`,
    replyTo: env.RESEND_REPLY_TO || undefined,
  };
}
