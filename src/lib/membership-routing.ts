export type WorkspaceMembership = {
  organization_id: string;
  role: string;
  lifecycle: string;
  password_change_required: boolean;
  revoked_at: string | null;
  access_not_before: number;
};
/** Input is ordered by creation time; preserve deterministic selection within a state. */
export function selectWorkspaceMembership(memberships: WorkspaceMembership[], issuedAt: number) {
  const active = memberships.filter(
    (m) => m.lifecycle === "active" && !m.password_change_required && !m.revoked_at,
  );
  return (
    active.find((m) => Number(m.access_not_before) <= issuedAt) ??
    active[0] ??
    memberships.find((m) => m.lifecycle !== "revoked" && !m.revoked_at) ??
    memberships[0]
  );
}
