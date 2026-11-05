export type MemberSummary = {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  firstLoginAt: string | null;
  lastSeenAt: string | null;
};

export type AccountSettingsData = {
  capturedAt: string;
  profile: { displayName: string; email: string };
  members: MemberSummary[];
  seats: { used: number; limit: 2 };
  provisioning: { available: boolean; reason: string };
};
