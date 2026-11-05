"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { discardDraftGroup } from "@/app/app/knowledge/draft-actions";
import type { DraftGroup, DraftManagerData } from "@/lib/knowledge/draft-types";

export function DraftManager({ initial }: { initial: DraftManagerData }) {
  const router = useRouter();
  const [override, setOverride] = useState<{ source: DraftManagerData; data: DraftManagerData }>();
  const data = override?.source === initial ? override.data : initial;
  const [confirm, setConfirm] = useState<{
    key: string;
    records: { id: string; version: number }[];
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function discard(group: DraftGroup) {
    if (confirm?.key !== `${group.kind}:${group.id}`) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await discardDraftGroup({
        id: group.id,
        kind: group.kind,
        confirmed: true,
        records: confirm.records,
      });
      if (result.error) setMessage(result.error);
      else {
        setOverride({ source: initial, data: result });
        setConfirm(undefined);
        setMessage(
          group.kind === "review"
            ? "Unfinished review discarded. Saved knowledge was not changed."
            : "Draft group discarded. Source history and audit records are preserved.",
        );
        router.refresh();
      }
    } catch {
      setMessage(
        "Connection interrupted. Refresh to check whether the discard completed before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-card" aria-labelledby="draft-manager-title">
      <h2 id="draft-manager-title">Draft Manager</h2>
      <p>
        Resume source reviews and manage saved drafts by upload. Approved knowledge and learning
        dependencies are protected.
      </p>
      {data.error && <p role="status">{data.error}</p>}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {!data.error && !data.groups.length && (
        <p>No upload groups yet. Your next upload will appear here.</p>
      )}
      {data.groups.map((group) => (
        <article key={`${group.kind}:${group.id}`} className="record-card draft-group">
          <h3>
            <strong>{group.sourceName}</strong> —{" "}
            {group.kind === "review"
              ? "Review in progress"
              : `${group.draftCount} drafts · ${group.publishedCount} approved · ${group.discardedCount} discarded`}
          </h3>
          <p>
            {group.recordCount} saved records ·{" "}
            <time dateTime={group.createdAt}>{group.createdAt.slice(0, 10)} UTC</time>
          </p>
          {group.resumable && (
            <Link
              className="button button-outline button-small"
              href={`/app/knowledge?upload=${group.id}`}
            >
              Resume review
            </Link>
          )}
          {!group.resumable && group.records.some((r) => !r.discarded) && (
            <Link
              className="button button-outline button-small"
              href={`/app/knowledge/${group.records.find((r) => !r.discarded)!.id}`}
            >
              Review
            </Link>
          )}
          {group.publishedCount > 0 && (
            <Link className="text-link" href="/app/knowledge?view=library">
              Open Knowledge Library
            </Link>
          )}
          {group.blockedReason && <p className="workspace-notice">{group.blockedReason}</p>}
          {group.records.length > 0 && (
            <ul>
              {group.records.map((record) => (
                <li key={record.id}>
                  {record.discarded ? (
                    <span>{record.title} — discarded</span>
                  ) : (
                    <Link href={`/app/knowledge/${record.id}`}>
                      {record.title} — {record.status === "published" ? "Approved" : "Draft"} · v
                      {record.version}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(group.kind === "review" || group.draftCount > 0 || group.publishedCount > 0) &&
            (confirm?.key === `${group.kind}:${group.id}` ? (
              <div role="group" aria-label={`Confirm discard of ${group.sourceName}`}>
                <p>
                  {group.kind === "review"
                    ? "Discard this unfinished review? Uploaded review data will be removed. Saved knowledge is unaffected."
                    : `Discard all ${group.draftCount} active drafts? This removes them from active knowledge. Source history is retained; approved or dependent records cannot be discarded.`}
                </p>
                <button
                  className="button button-small"
                  disabled={busy}
                  onClick={() => discard(group)}
                >
                  {busy ? "Discarding…" : "Confirm discard"}
                </button>{" "}
                <button
                  className="button button-outline button-small"
                  disabled={busy}
                  onClick={() => setConfirm(undefined)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="button button-outline button-small"
                disabled={busy || group.discardable !== true}
                title={group.blockedReason || undefined}
                onClick={() =>
                  setConfirm({
                    key: `${group.kind}:${group.id}`,
                    records: group.records
                      .filter((r) => !r.discarded)
                      .map(({ id, version }) => ({ id, version })),
                  })
                }
              >
                {group.discardable ? "Discard draft group" : "Discard unavailable"}
              </button>
            ))}
        </article>
      ))}
      {data.groups.length === 50 && <p>Showing the latest 50 upload groups.</p>}
    </section>
  );
}
