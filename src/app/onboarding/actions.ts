"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { organizationSchema, type ActionState } from "@/lib/validation";
export async function createOrganization(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = organizationSchema.safeParse({ name: form.get("name") });
  if (!parsed.success)
    return { error: true, message: "Use an organization name of 2–100 characters." };
  const { client } = await requireUser();
  const { error } = await client.rpc("create_organization", {
    organization_name: parsed.data.name,
  });
  if (error)
    return {
      error: true,
      message:
        "We couldn’t create your workspace. If you already have one, open your workspace from the login page.",
    };
  redirect("/app");
}
