import Link from "next/link";
import { GatewayRecordEditor } from "./gateway-record-editor";
import { KnowledgeEditor } from "./knowledge-editor";
import type { loadKnowledgeRecord } from "@/lib/knowledge/record";
import { displayFields, primaryField } from "@/lib/knowledge/field-labels";
export function KnowledgeRecordView({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadKnowledgeRecord>>>;
}) {
  const { record, source, versions, author, admin } = data;
  const fields = displayFields(record.custom_fields, data.fieldLabels);
  const primary = primaryField(fields, record.title);
  return (
    <>
      <Link className="text-link" href="/app/knowledge">
        Back to Knowledge Gateway
      </Link>
      <div className="app-title-row">
        <div>
          <h1>{record.title}</h1>
          <p>
            Version {record.current_version} · {record.status}
          </p>
        </div>
      </div>
      <article className="workspace-card">
        <h2>Saved knowledge</h2>
        {record.custom_fields.length ? (
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
                {fields.map((f) => (
                  <div key={f.id}>
                    <dt>{f.label}</dt>
                    <dd>{f.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        ) : (
          <p className="knowledge-body">{record.body}</p>
        )}
        {author &&
          (record.status === "draft" || admin) &&
          (record.custom_fields.length ? (
            <GatewayRecordEditor
              key={`${record.id}:${record.current_version}`}
              record={record}
              admin={admin}
            />
          ) : (
            record.status === "draft" && <KnowledgeEditor record={record} publish={admin} />
          ))}
      </article>
      {source && (
        <details className="workspace-card">
          <summary>Original source and provenance</summary>
          <p>
            {String(source.origin.fileName ?? source.origin.worksheet)} ·{" "}
            {String(source.origin.worksheet)} · row {String(source.origin.row)} · header{" "}
            {String(source.origin.headerRow || "none")}
          </p>
          <p className="form-help">
            Source SHA-256: {String(source.origin.digest ?? "available in the upload audit")}
          </p>
          <dl className="gateway-field-list">
            {displayFields(source.original_fields, data.fieldLabels).map((f) => (
              <div key={f.id}>
                <dt>{f.label}</dt>
                <dd>{f.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {author && versions.length > 0 && (
        <details className="workspace-card">
          <summary>Version history ({versions.length} most recent)</summary>
          {versions.map((v) => (
            <details key={v.version}>
              <summary>
                Version {v.version} · {v.status} · {v.title}
              </summary>
              <p className="knowledge-body">{v.body}</p>
            </details>
          ))}
        </details>
      )}
      <Link className="button button-outline" href="/app/learning">
        Open Learning Paths
      </Link>
    </>
  );
}
