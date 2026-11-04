"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateGatewayKnowledge,
  approveGatewayKnowledge,
} from "@/app/app/knowledge/gateway-actions";
import type { GatewayField } from "@/lib/knowledge/gateway-model";
export type EditableKnowledge = {
  id: string;
  title: string;
  body: string;
  status: string;
  current_version: number;
  custom_fields: GatewayField[];
};
export function GatewayRecordEditor({
  record,
  admin,
}: {
  record: EditableKnowledge;
  admin: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(record.title),
    [fields, setFields] = useState(record.custom_fields),
    [version, setVersion] = useState(record.current_version),
    [status, setStatus] = useState(record.status),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  async function act(approve = false) {
    setBusy(true);
    setFailed(false);
    try {
      const result = approve
        ? await approveGatewayKnowledge({ id: record.id, version })
        : await updateGatewayKnowledge({ id: record.id, version, title, fields });
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
      } else if (result.revision) {
        setVersion(result.revision);
        setDirty(false);
        setStatus(approve ? "published" : "draft");
        setMessage(
          approve
            ? "Approved and published. This version is eligible for Learning Paths."
            : "Changes saved as a draft. Previous versions and original source values are preserved; approval is required again.",
        );
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage(
        "The response was interrupted. Reopen this resource to confirm its saved version before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gateway-editor">
      <details>
        <summary>Edit knowledge fields</summary>
        <div className="workspace-form">
          <label className="form-field">
            Resource title
            <input
              value={title}
              minLength={3}
              maxLength={160}
              disabled={busy}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {fields.map((field, i) => (
            <div className="gateway-edit-field" key={field.id}>
              <label className="form-field">
                Field {i + 1} name
                <input
                  value={field.label}
                  maxLength={100}
                  disabled={busy}
                  onChange={(e) => {
                    setFields(
                      fields.map((f, n) => (n === i ? { ...f, label: e.target.value } : f)),
                    );
                    setDirty(true);
                  }}
                />
              </label>
              <label className="form-field">
                {field.label} value
                <textarea
                  value={field.value}
                  aria-label={`${field.label} value (${field.id})`}
                  maxLength={12000}
                  rows={3}
                  disabled={busy}
                  onChange={(e) => {
                    setFields(
                      fields.map((f, n) => (n === i ? { ...f, value: e.target.value } : f)),
                    );
                    setDirty(true);
                  }}
                />
              </label>
            </div>
          ))}
          <p className="form-help">
            Saving an edit creates a new draft version. Existing Learning Path lessons keep their
            approved source snapshots.
          </p>
          <button
            type="button"
            className="button button-dark"
            disabled={busy || !dirty}
            onClick={() => void act()}
          >
            Save field changes as draft
          </button>
        </div>
      </details>
      {admin && status === "draft" && (
        <div className="gateway-approval">
          <p>
            Approval shares every saved field with authorized organization readers. Review this
            version before publishing.
          </p>
          <button
            type="button"
            className="button button-dark"
            disabled={busy || dirty}
            onClick={() => void act(true)}
          >
            Approve and publish
          </button>
          {dirty && <p className="form-help">Save your field changes before approval.</p>}
        </div>
      )}
      {message && (
        <p className="form-message" role={failed ? "alert" : "status"} data-error={failed}>
          {message}
        </p>
      )}
    </div>
  );
}
