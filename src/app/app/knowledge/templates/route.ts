import { requireWorkspace } from "@/lib/session";
import { canAuthor } from "@/lib/permissions";
import { templateLibrary } from "@/lib/knowledge/templates";
import { createTemplate } from "@/lib/knowledge/spreadsheets";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const { role } = await requireWorkspace();
  if (!canAuthor(role))
    return new Response("Organization author access is required.", { status: 403 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id"),
    format = params.get("format"),
    variant = params.get("variant");
  if (
    !templateLibrary.some((t) => t.id === id) ||
    (format !== "csv" && format !== "xlsx") ||
    !["blank", "sample"].includes(variant ?? "")
  )
    return new Response("Choose a valid template, format and version.", { status: 400 });
  const content = await createTemplate(id!, format, variant === "sample");
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="saleschild-${id}-${variant}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
