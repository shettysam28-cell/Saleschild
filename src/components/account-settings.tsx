"use client";
import { useActionState, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import Link from "next/link";
import {
  provisionMember,
  removeMember,
  resetMemberPasscode,
  updateProfile,
} from "@/app/app/member-actions";
import type { AccountSettingsData, MemberSummary } from "@/lib/member-types";
import type { ActionState } from "@/lib/validation";

function CopyValue({ value, children }: { value: () => string; children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value());
            setMessage("Copied.");
          } catch {
            setMessage(
              "Clipboard access was blocked. Select and copy the displayed text manually.",
            );
          }
        }}
      >
        {children}
      </button>
      {message && <span role="status">{message}</span>}
    </>
  );
}
function timeLabel(value: string | null) {
  return value
    ? `${new Date(value).toLocaleString("en-US", { timeZone: "UTC" })} UTC`
    : "Not recorded";
}

function MemberControls({ member, enabled }: { member: MemberSummary; enabled: boolean }) {
  const [removal, removeAction, removing] = useActionState(removeMember, {});
  const [reset, resetAction, resetting] = useActionState(resetMemberPasscode, {});
  const [showPasscode, setShowPasscode] = useState(true);
  if (member.role !== "learner" || !member.userId || member.status === "revoked") return null;
  return (
    <div className="member-controls">
      <form action={resetAction} onSubmit={() => setShowPasscode(true)}>
        <input type="hidden" name="user_id" value={member.userId} />
        <button className="button button-outline button-small" disabled={!enabled || resetting}>
          Reset temporary passcode
        </button>
        {reset.message && <p role={reset.error ? "alert" : "status"}>{reset.message}</p>}
        {reset.temporaryPasscode && showPasscode && (
          <div>
            <output aria-label="Replacement temporary passcode">{reset.temporaryPasscode}</output>{" "}
            <CopyValue value={() => reset.temporaryPasscode!}>Copy temporary passcode</CopyValue>{" "}
            <button type="button" onClick={() => setShowPasscode(false)}>
              Hide passcode
            </button>
          </div>
        )}
      </form>
      <details>
        <summary>Remove member</summary>
        <p>This immediately revokes organization access. Learning history is retained.</p>
        <form action={removeAction}>
          <input type="hidden" name="user_id" value={member.userId} />
          <label>
            <input type="checkbox" name="confirm" value="remove" required /> Confirm removal of{" "}
            {member.name}
          </label>{" "}
          <button className="button button-outline button-small" disabled={removing}>
            Remove access
          </button>
          {removal.message && <p role={removal.error ? "alert" : "status"}>{removal.message}</p>}
        </form>
      </details>
    </div>
  );
}

function ProvisionMemberForm({
  available,
  reason,
  full,
}: {
  available: boolean;
  reason: string;
  full: boolean;
}) {
  const [state, action, pending] = useActionState(provisionMember, {});
  const [operationId, setOperationId] = useState("");
  const [showPasscode, setShowPasscode] = useState(true);
  return (
    <div>
      {!available && <p className="workspace-notice">{reason}</p>}
      <form
        action={action}
        className="workspace-form"
        onFocus={() => {
          if (!operationId) setOperationId(crypto.randomUUID());
        }}
      >
        <input type="hidden" name="operation_id" value={operationId} />
        <label className="form-field">
          Member name
          <input
            name="name"
            required
            maxLength={100}
            autoComplete="off"
            disabled={!available || full}
          />
        </label>
        <label className="form-field">
          Member email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            disabled={!available || full}
          />
        </label>
        <button
          className="button button-dark"
          disabled={!available || full || pending || !operationId || state.success}
        >
          {full
            ? "Both member seats are occupied"
            : pending
              ? "Preparing account…"
              : "Provision member"}
        </button>
        {state.message && <p role={state.error ? "alert" : "status"}>{state.message}</p>}
        {state.success && state.temporaryPasscode && showPasscode && (
          <div>
            <p>
              Share the invitation and passcode separately using your own messaging app. No message
              is sent automatically.
            </p>
            <CopyValue
              value={() =>
                `Your Saleschild account has been prepared. Visit ${window.location.origin}/member-verification to request an email confirmation, then sign in at ${window.location.origin}/login with your registered email. Your temporary passcode is shared separately. After verifying your email, change the temporary password and sign in again to activate your learning workspace.`
              }
            >
              Copy invitation
            </CopyValue>{" "}
            <output aria-label="Temporary member passcode">{state.temporaryPasscode}</output>{" "}
            <CopyValue value={() => state.temporaryPasscode!}>Copy temporary passcode</CopyValue>{" "}
            <button type="button" onClick={() => setShowPasscode(false)}>
              Hide passcode
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

export function AccountSettings({
  initial,
  owner,
}: {
  initial: AccountSettingsData;
  owner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [profileState, setProfileState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <>
      <section className="workspace-card" aria-labelledby="account-details-title">
        <h2 id="account-details-title">Your account</h2>
        <p>
          <strong>Name:</strong> {initial.profile.displayName}
        </p>
        <p>
          <strong>Email:</strong> {initial.profile.email}
        </p>
        <p className="form-help">
          Your email is managed by your verified account and cannot be changed here.
        </p>
        {!editing ? (
          <button
            className="button button-outline button-small"
            onClick={() => {
              setProfileState({});
              setEditing(true);
            }}
          >
            <Pencil size={14} aria-hidden="true" /> Edit your name
          </button>
        ) : (
          <form
            className="workspace-form"
            action={(form) =>
              startTransition(async () => {
                const next = await updateProfile({}, form);
                setProfileState(next);
                if (next.success) setEditing(false);
              })
            }
          >
            <label className="form-field">
              Your name
              <input
                name="display_name"
                defaultValue={initial.profile.displayName}
                required
                maxLength={100}
              />
            </label>
            <div className="button-row">
              <button className="button button-dark button-small" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                className="button button-outline button-small"
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {profileState.message && (
          <p role={profileState.error ? "alert" : "status"}>{profileState.message}</p>
        )}
      </section>
      {owner && (
        <section className="workspace-card" aria-labelledby="member-management-title">
          <h2 id="member-management-title">Organization members</h2>
          <p>
            {initial.seats.used} of {initial.seats.limit} member seats occupied. The owner has a
            separate seat. Pending and provisioned accounts count toward the limit.
          </p>
          {!initial.provisioning.available && (
            <details className="member-setup-requirements">
              <summary className="button button-outline">Add Member — setup required</summary>
              <p>{initial.provisioning.reason}</p>
              <ol>
                <li>Ask your Saleschild administrator to complete secure account setup.</li>
                <li>
                  Keep independent email verification. Review an approved verification workflow that
                  meets the no-automatic-email requirement, or authorize a supported verification
                  channel separately.
                </li>
                <li>
                  Verify account collision handling, first-login password change, session revocation
                  and two-seat limits in an authorized hosted development environment before
                  enabling account creation.
                </li>
              </ol>
            </details>
          )}
          {initial.provisioning.available && (
            <ProvisionMemberForm
              available={initial.provisioning.available}
              reason={initial.provisioning.reason}
              full={initial.seats.used >= 2}
            />
          )}
          <div className="record-list" aria-label="Organization members">
            {initial.members.map((member) => (
              <article className="record-card" key={member.id}>
                <div>
                  <h3>{member.name}</h3>
                  <span className="record-badge">
                    {member.role === "learner" ? "Member" : member.role}
                  </span>
                </div>
                <p>{member.email}</p>
                <p>
                  {member.status === "provisioned"
                    ? "Provisioned / awaiting login"
                    : member.status === "reserved" || member.status === "awaiting_verification"
                      ? "Account preparation pending"
                      : member.status === "active"
                        ? "Active"
                        : "Access removed"}
                </p>
                <p className="form-help">
                  First login: {member.firstLoginAt ? timeLabel(member.firstLoginAt) : "Not yet"} ·
                  Last seen: {timeLabel(member.lastSeenAt)}. Presence is approximate and does not
                  measure learning.
                </p>
                <p>
                  {member.status === "active" &&
                  member.lastSeenAt &&
                  Date.parse(initial.capturedAt) - Date.parse(member.lastSeenAt) >= 0 &&
                  Date.parse(initial.capturedAt) - Date.parse(member.lastSeenAt) < 5 * 60 * 1000
                    ? "Online (approximate at last refresh)"
                    : "Offline (approximate at last refresh)"}
                  . Refresh for a newer snapshot.
                </p>
                {member.role === "learner" && member.userId && (
                  <Link
                    className="text-link"
                    href={`/app/analytics?member=${encodeURIComponent(member.userId)}`}
                  >
                    View member learning progress
                  </Link>
                )}
                <MemberControls member={member} enabled={initial.provisioning.available} />
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
