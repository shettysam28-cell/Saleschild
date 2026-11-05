"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { WorkspaceForm } from "./workspace-form";
export function OrganizationDetails({
  name,
  owner,
  role,
}: {
  name: string;
  owner: boolean;
  role: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section
      className="workspace-card organization-details"
      aria-labelledby="organization-details-heading"
    >
      <div className="workspace-section-heading">
        <h2 id="organization-details-heading">Organization details</h2>
        {owner && !editing && (
          <button className="button button-outline button-small" onClick={() => setEditing(true)}>
            <Pencil size={14} aria-hidden="true" /> Edit organization
          </button>
        )}
      </div>
      {editing ? (
        <>
          <WorkspaceForm kind="settings" name={name} onSaved={() => setEditing(false)} />
          <button className="text-link workspace-cancel" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <dl className="workspace-details">
          <div>
            <dt>Organization</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd>{role === "learner" ? "Member" : role}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
