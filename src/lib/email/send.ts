import "server-only";
import { Resend } from "resend";
import { z } from "zod";
import { emailConfig } from "./config";
const welcomeSchema = z.object({
  to: z.email().max(254),
  organizationName: z.string().min(2).max(100),
  organizationId: z.uuid(),
  userId: z.uuid(),
});
export type DeliveryResult = { status: "disabled" | "sent" | "failed"; id?: string };
// Internal adapter only: no public send endpoint. Invoke from a future durable,
// authorized transactional job after sender verification; never from a browser.
export async function sendWorkspaceWelcome(
  input: z.infer<typeof welcomeSchema>,
): Promise<DeliveryResult> {
  const config = emailConfig();
  if (!config) return { status: "disabled" };
  const data = welcomeSchema.parse(input);
  const resend = new Resend(config.apiKey);
  try {
    const result = await resend.emails.send(
      {
        from: config.from,
        to: data.to,
        replyTo: config.replyTo,
        subject: "A new chapter with Saleschild",
        text: `Welcome to ${data.organizationName} on Saleschild.\n\nYour organization’s workspace is ready for its first knowledge resource.\n\nWhere Knowledge Grows Into Performance.\n\nNeed a hand? Reply to this email.`,
      },
      { idempotencyKey: `workspace-welcome/${data.organizationId}/${data.userId}` },
    );
    if (result.error || !result.data) return { status: "failed" };
    return { status: "sent", id: result.data.id };
  } catch {
    return { status: "failed" };
  }
}
