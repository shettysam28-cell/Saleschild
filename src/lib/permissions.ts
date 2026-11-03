export type Role = "owner" | "admin" | "editor" | "learner";
export function canAuthor(role: Role) {
  return ["owner", "admin", "editor"].includes(role);
}
export function canAdmin(role: Role) {
  return ["owner", "admin"].includes(role);
}
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ["owner", "admin", "editor", "learner"].includes(value);
}
