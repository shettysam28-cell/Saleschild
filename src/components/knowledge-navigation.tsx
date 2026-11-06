import Link from "next/link";
import type { GatewayField } from "@/lib/knowledge/gateway-model";
import { displayFields, primaryField, type FieldLabels } from "@/lib/knowledge/field-labels";
export type KnowledgeTab = "import" | "drafts" | "library";
export function KnowledgeNavigation({ tab }: { tab: KnowledgeTab }) {
  return (
    <nav className="knowledge-navigation" aria-label="Knowledge Gateway sections">
      {(
        [
          ["import", "Import knowledge"],
          ["drafts", "Draft Manager"],
          ["library", "Knowledge Library"],
        ] as const
      ).map(([value, label]) => (
        <Link
          key={value}
          className={`button button-small ${tab === value ? "button-dark" : "button-outline"}`}
          href={`/app/knowledge?view=${value}`}
          aria-current={tab === value ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export type LibraryRecord = {
  id: string;
  title: string;
  body: string;
  current_version: number;
  source_url?: string | null;
  evidence_status?: string;
  custom_fields?: GatewayField[];
  field_labels?: FieldLabels;
};
export function KnowledgeLibrary({
  records,
  q = "",
  error,
}: {
  records: LibraryRecord[];
  q?: string;
  error?: string;
}) {
  return (
    <section aria-labelledby="knowledge-library-title">
      <h2 id="knowledge-library-title">Knowledge Library</h2>
      <p>
        Published knowledge, kept separate from drafts. Open a resource to review its version
        history and original provenance.
      </p>
      <form className="library-search" action="/app/knowledge">
        <input type="hidden" name="view" value="library" />
        <label className="form-field">
          Search published knowledge
          <input
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="Topic, keyword or question"
          />
        </label>
        <button className="button button-dark">Search library</button>
        <Link className="text-link" href="/app/knowledge?view=library">
          Clear
        </Link>
      </form>
      {error ? (
        <p role="alert">{error}</p>
      ) : records.length ? (
        <>
          <p role="status">
            {records.length} published {records.length === 1 ? "resource" : "resources"} shown
            {q ? " for this search" : ""}.{" "}
            {records.length >= (q ? 5 : 50)
              ? "Refine your search to find more specific knowledge."
              : ""}
          </p>
          <div className="record-list" aria-label="Published knowledge">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <h3>
                  <Link href={`/app/knowledge/${record.id}`}>{record.title}</Link>
                </h3>
                <span className="record-badge">Published · version {record.current_version}</span>
                <p className="knowledge-body">
                  {(() => {
                    const preview = record.custom_fields?.length
                      ? (primaryField(
                          displayFields(record.custom_fields, record.field_labels),
                          record.title,
                        )?.value ?? record.body)
                      : record.body;
                    return preview.length > 360 ? preview.slice(0, 360) + "…" : preview;
                  })()}
                </p>
                <Link className="text-link" href={`/app/knowledge/${record.id}`}>
                  View knowledge and provenance
                </Link>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p>
          No published knowledge matches. Review drafts in Draft Manager, or try a different
          keyword.
        </p>
      )}
    </section>
  );
}
