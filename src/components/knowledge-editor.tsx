"use client";
import { useActionState } from "react";
import { updateKnowledge } from "@/app/app/actions";
export function KnowledgeEditor({
  record,
  publish = false,
}: {
  publish?: boolean;
  record: {
    id: string;
    title: string;
    body: string;
    source_url: string | null;
    current_version: number;
  };
}) {
  const [state, action, pending] = useActionState(updateKnowledge, {});
  return (
    <details className="workspace-card" style={{ marginTop: 15 }}>
      <summary>Edit this draft</summary>
      <form action={action} className="workspace-form" style={{ marginTop: 20 }}>
        <input type="hidden" name="id" value={record.id} />
        <input type="hidden" name="version" value={record.current_version} />
        <label className="form-field">
          Resource title
          <input name="title" defaultValue={record.title} minLength={3} maxLength={160} required />
        </label>
        <label className="form-field">
          Knowledge content
          <textarea
            name="body"
            defaultValue={record.body}
            rows={5}
            minLength={20}
            maxLength={20000}
            required
          />
        </label>
        <label className="form-field">
          Source URL
          <input
            name="source_url"
            type="url"
            defaultValue={record.source_url ?? ""}
            maxLength={2048}
          />
        </label>
        <label className="form-field">
          Publication status
          <select name="status" defaultValue="draft">
            <option value="draft">Keep as draft</option>
            {publish && (
              <option value="published">Approve and publish to organization members</option>
            )}
          </select>
        </label>
        {state.message && (
          <div
            className="form-message"
            data-error={state.error}
            role={state.error ? "alert" : "status"}
          >
            {state.message}
          </div>
        )}
        <button className="button button-dark" disabled={pending || state.success}>
          {pending ? "Saving…" : "Save draft changes"}
        </button>
      </form>
    </details>
  );
}
