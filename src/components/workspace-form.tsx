"use client";
import { useActionState } from "react";
import {
  createKnowledge,
  createCourse,
  requestWorkflow,
  updateOrganization,
} from "@/app/app/actions";
const actions = {
  knowledge: createKnowledge,
  learning: createCourse,
  workflows: requestWorkflow,
  settings: updateOrganization,
};
export function WorkspaceForm({
  kind,
  name,
  publish = false,
}: {
  kind: keyof typeof actions;
  name?: string;
  publish?: boolean;
}) {
  const [state, action, pending] = useActionState(actions[kind], {});
  return (
    <form className="workspace-form" action={action}>
      {kind === "settings" ? (
        <label className="form-field">
          Organization name
          <input name="name" defaultValue={name} required minLength={2} maxLength={100} />
        </label>
      ) : kind === "workflows" ? (
        <>
          <label className="form-field">
            Workflow objective
            <textarea
              name="objective"
              rows={4}
              minLength={10}
              maxLength={2000}
              required
              placeholder="Describe what you would like help preparing…"
            />
          </label>
          <label className="form-field">
            Mode
            <select name="mode">
              <option value="manual">Manual</option>
              <option value="assisted">Assisted</option>
            </select>
            <span className="form-help">
              Draft requests only. Autonomous execution is not enabled.
            </span>
          </label>
        </>
      ) : (
        <>
          <label className="form-field">
            {kind === "knowledge" ? "Resource title" : "Learning path title"}
            <input name="title" minLength={3} maxLength={160} required />
          </label>
          <label className="form-field">
            {kind === "knowledge" ? "Knowledge content" : "Description"}
            <textarea
              name={kind === "knowledge" ? "body" : "description"}
              rows={5}
              minLength={kind === "knowledge" ? 20 : 10}
              maxLength={kind === "knowledge" ? 20000 : 2000}
              required
            />
          </label>
          {kind === "knowledge" && (
            <>
              <label className="form-field">
                Source URL{" "}
                <span className="form-help">Optional — use an approved HTTPS source.</span>
                <input type="url" name="source_url" maxLength={2048} placeholder="https://…" />
              </label>
              <label className="form-field">
                Publication status
                <select name="status">
                  <option value="draft">Draft — content authors only</option>
                  {publish && (
                    <option value="published">Published — all organization members</option>
                  )}
                </select>
              </label>
            </>
          )}
        </>
      )}
      {state.message && (
        <div
          className="form-message"
          data-error={state.error}
          role={state.error ? "alert" : "status"}
        >
          {state.message}
        </div>
      )}
      <button className="button button-dark" disabled={pending}>
        {pending
          ? "Saving…"
          : kind === "settings"
            ? "Save organization"
            : kind === "workflows"
              ? "Save draft request"
              : kind === "knowledge"
                ? "Save resource"
                : "Create draft path"}
      </button>
    </form>
  );
}
