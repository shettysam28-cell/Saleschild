export type DraftRecord = {
  id: string;
  title: string;
  status: string;
  version: number;
  discarded: boolean;
};
export type DraftGroup = {
  id: string;
  kind: "gateway" | "legacy" | "review";
  sourceName: string;
  createdAt: string;
  recordCount: number;
  draftCount: number;
  publishedCount: number;
  discardedCount: number;
  resumable: boolean;
  records: DraftRecord[];
};
export type DraftManagerData = { groups: DraftGroup[]; error?: string };
