import Link from "next/link";
import { summarizeProgress, type ProgressRow } from "@/lib/workspace-progress";

export function ProgressStats({
  rows,
  range = {},
}: {
  rows: ProgressRow[];
  range?: { from?: string; to?: string };
}) {
  const totals = summarizeProgress(rows, range);
  return (
    <div className="workspace-stats progression-stats">
      {[
        ["Learning units completed", `${totals.completed} / ${totals.eligible}`],
        ["Units remaining", totals.remaining],
        ["Completion", `${totals.percent}%`],
        ["Paths started / completed", `${totals.startedPaths} / ${totals.completedPaths}`],
      ].map(([label, value]) => (
        <div className="workspace-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>Current published content</small>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceProgression({ rows, error }: { rows: ProgressRow[]; error?: string }) {
  return (
    <>
      <div className="workspace-notice">
        Progress records meaningful learning actions. Opening or previewing a page does not complete
        a unit. Completion measures consumption; scenario feedback is separate from a claim of
        mastery.
      </div>
      {error ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : (
        <>
          <ProgressStats rows={rows} />
          <section className="workspace-card">
            <h2>Your learning paths</h2>
            {!rows.length ? (
              <p>
                No eligible published learning paths yet. Your owner can publish a source-backed
                path when it is ready.
              </p>
            ) : (
              <div className="progression-paths">
                {rows.map((row) => {
                  const remaining =
                    row.total_units - Math.min(row.completed_units, row.total_units);
                  return (
                    <article className="progression-path" key={`${row.user_id}:${row.revision_id}`}>
                      <div>
                        <h3>
                          <Link href={`/app/learning/${row.course_id}`}>{row.path_title}</Link>
                        </h3>
                        <p>
                          Version {row.revision_number} · {row.completed_units} of {row.total_units}{" "}
                          units complete · {remaining} remaining
                        </p>
                      </div>
                      <Link
                        className="button button-outline"
                        href={`/app/learning/${row.course_id}`}
                      >
                        {row.completed_at
                          ? "Revisit path"
                          : row.started_at
                            ? "Continue learning"
                            : "Start learning"}
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
