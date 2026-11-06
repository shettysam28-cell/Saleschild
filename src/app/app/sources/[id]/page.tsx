import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import type { GatewayField } from "@/lib/knowledge/gateway-model";
import { displayFields, primaryField } from "@/lib/knowledge/field-labels";
import { readFieldLabels } from "@/lib/knowledge/field-label-reader";

export default async function ApprovedSource({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const parsed =
    version === undefined ? null : z.coerce.number().int().positive().safeParse(version);
  if (parsed && !parsed.success) notFound();
  const ws = await requireWorkspace();
  let query = ws.client
    .from("knowledge_versions")
    .select("title,body,custom_fields,source_url,version,recorded_at")
    .eq("organization_id", ws.organization.id)
    .eq("knowledge_id", id)
    .eq("status", "published");
  if (parsed?.success) query = query.eq("version", parsed.data);
  const { data, error } = await query.order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw Error("The approved source version could not be loaded.");
  if (!data) notFound();
  const labels = (await readFieldLabels(ws.client, ws.organization.id, [id]))[id];
  const fields = Array.isArray(data.custom_fields)
    ? displayFields(data.custom_fields as GatewayField[], labels)
    : [];
  const primary = primaryField(fields, data.title);
  return (
    <>
      <div className="app-title-row">
        <div>
          <div className="eyebrow">APPROVED SOURCE · VERSION {data.version}</div>
          <h1>{data.title}</h1>
          <p>This published snapshot preserves the source used by your learning content.</p>
        </div>
      </div>
      <article className="workspace-card">
        {Array.isArray(data.custom_fields) && data.custom_fields.length ? (
          <>
            {primary && (
              <dl className="gateway-field-list">
                <div>
                  <dt>{primary.label}</dt>
                  <dd>{primary.value || "—"}</dd>
                </div>
              </dl>
            )}
            <details>
              <summary>Inspect all documented fields</summary>
              <dl className="gateway-field-list">
                {fields.map((field) => (
                  <div key={field.id}>
                    <dt>{field.label}</dt>
                    <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        ) : (
          <p className="knowledge-body" style={{ whiteSpace: "pre-wrap" }}>
            {data.body}
          </p>
        )}
        {typeof data.source_url === "string" && /^https:\/\//i.test(data.source_url) && (
          <a className="text-link" href={data.source_url} rel="noopener noreferrer" target="_blank">
            Open the recorded external reference
          </a>
        )}
      </article>
      <Link className="text-link" href="/app/learning">
        Back to Learning Paths
      </Link>
    </>
  );
}
