import "server-only";
import { requireWorkspace } from "@/lib/session";
import { progressRowSchema, type ProgressRow } from "./workspace-progress";
import { canAuthor } from "./permissions";

export async function readLearningPathCards() {
  const { client, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) {
    const progress = await readWorkspaceProgress();
    return {
      records: progress.rows.map((row) => ({
        id: row.course_id,
        title: row.path_title,
        description: `${row.total_units} documented learning ${row.total_units === 1 ? "unit" : "units"} · ${row.completed_units} completed.`,
        status: `Published · version ${row.revision_number}`,
      })),
      error: progress.error,
    };
  }
  const result = await client
    .from("courses")
    .select("id,title,description,status")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error)
    return { records: [], error: "Learning paths could not be loaded. Please try again." };
  return {
    records: (result.data ?? []) as {
      id: string;
      title: string;
      description: string;
      status: string;
    }[],
    error: undefined,
  };
}

export async function readWorkspaceProgress(
  filters: {
    from?: string;
    to?: string;
    member?: string;
    path?: string;
  } = {},
): Promise<{ rows: ProgressRow[]; error?: string }> {
  const { client, organization, role } = await requireWorkspace();
  if (role !== "owner" && role !== "learner")
    return {
      rows: [],
      error: "Learning progression is currently available to the owner and organization members.",
    };
  const result = await client.rpc("read_learning_progress", {
    org_id: organization.id,
    member_id: filters.member || null,
    course_id: filters.path || null,
    from_date: filters.from || null,
    to_date: filters.to || null,
  });
  if (result.error?.code === "42501")
    return {
      rows: [],
      error:
        "The selected member or learning path is not available to your account in this organization.",
    };
  if (result.error)
    return {
      rows: [],
      error:
        "Learning activity is unavailable. An administrator should verify that the approved workspace migration is installed. No progress has been estimated.",
    };
  const parsed = progressRowSchema.array().safeParse(result.data);
  if (!parsed.success)
    return {
      rows: [],
      error:
        "Learning activity could not be verified. Please try again or contact your administrator.",
    };
  return { rows: parsed.data };
}
