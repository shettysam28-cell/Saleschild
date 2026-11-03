import { z } from "zod";
export const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});
export const organizationSchema = z.object({ name: z.string().trim().min(2).max(100) });
export const knowledgeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(20).max(20000),
  source_url: z.union([
    z
      .url()
      .max(2048)
      .refine((url) => {
        try {
          return new URL(url).protocol === "https:";
        } catch {
          return false;
        }
      }, "Use a secure HTTPS source URL."),
    z.literal(""),
  ]),
  status: z.enum(["draft", "published"]),
});
export const courseSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(2000),
});
export type ActionState = { message?: string; error?: boolean; success?: boolean };
