import Link from "next/link";
import { ProgressStats } from "./workspace-progression";
import { summarizeProgress, type ProgressRow } from "@/lib/workspace-progress";
import type { MemberSummary } from "@/lib/member-types";

type Filters = { from: string; to: string; member: string; path: string };
export function WorkspaceAnalytics({
  rows,
  options,
  members,
  filters,
  error,
  events,
  governance,
}: {
  rows: ProgressRow[];
  options: ProgressRow[];
  members: MemberSummary[];
  filters: Filters;
  error?: string;
  events: { id: string; event_type: string; entity_type: string; created_at: string }[];
  governance: boolean;
}) {
  const paths = [...new Map(options.map((row) => [row.course_id, row.path_title])).entries()];
  const people = members.filter((member) => member.role === "learner" && member.userId);
  const labels = new Map(people.map((member) => [member.userId, member.name || member.email]));
  const chart = [...new Set(rows.map((row) => row.user_id))].map((user) => ({
    user,
    name: labels.get(user) || "Workspace member",
    ...summarizeProgress(
      rows.filter((row) => row.user_id === user),
      filters,
    ),
  }));
  return (
    <>
      <nav className="workspace-tabs" aria-label="Analytics sections">
        <Link href="/app/analytics" aria-current={!governance ? "page" : undefined}>
          Learning activity
        </Link>
        <Link href="/app/analytics?tab=governance" aria-current={governance ? "page" : undefined}>
          Governance
        </Link>
      </nav>
      {governance ? (
        <section className="workspace-card">
          <h2>Governance activity</h2>
          <p>
            Recent recorded organization changes. This audit history is separate from learner
            consumption.
          </p>
          <div className="table-scroll">
            <table className="workspace-table">
              <caption>Most recent 25 governance events</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Record type</th>
                  <th scope="col">Date (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.event_type}</td>
                    <td>{event.entity_type}</td>
                    <td>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleDateString("en-US", {
                          timeZone: "UTC",
                        })}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!events.length && <p>No governance events recorded yet.</p>}
        </section>
      ) : (
        <>
          <form className="workspace-card analytics-filters" method="get">
            <label className="form-field">
              From
              <input type="date" name="from" defaultValue={filters.from} />
            </label>
            <label className="form-field">
              Through
              <input type="date" name="to" defaultValue={filters.to} />
            </label>
            <label className="form-field">
              Member
              <select name="member" defaultValue={filters.member}>
                <option value="">All members</option>
                {people.map((member) => (
                  <option value={member.userId!} key={member.id}>
                    {member.name || member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Learning path
              <select name="path" defaultValue={filters.path}>
                <option value="">All learning paths</option>
                {paths.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-dark">Apply filters</button>
            <Link className="text-link" href="/app/analytics">
              Reset
            </Link>
          </form>
          <p className="analytics-explanation">
            {filters.from || filters.to
              ? "Completed units and percentages show meaningful completions in the selected period; eligible units include the full current published paths."
              : "Completion includes meaningful actions across all time in the current published paths."}{" "}
            Percentages are weighted by eligible unit count. Reading a preview is not learner
            activity. Date boundaries use UTC; last-activity and account signals remain all-time
            observations.
          </p>
          {error ? (
            <p className="form-message" role="alert">
              {error}
            </p>
          ) : (
            <>
              <ProgressStats rows={rows} range={filters} />
              <section className="workspace-card">
                <h2>Member learning comparison</h2>
                {!chart.length ? (
                  <p>
                    No eligible learning activity matches these filters. Publish a path and let
                    members complete meaningful actions to build an evidence-based view.
                  </p>
                ) : (
                  <>
                    <div
                      className="analytics-chart"
                      role="img"
                      aria-label="Completion by member. Exact values and links follow in the table."
                    >
                      {chart.map((member) => (
                        <div className="analytics-bar-row" key={member.user}>
                          <span>{member.name}</span>
                          <div className="analytics-bar-track">
                            <div style={{ width: `${member.percent}%` }} />
                          </div>
                          <strong>{member.percent}%</strong>
                        </div>
                      ))}
                    </div>
                    <div className="table-scroll">
                      <table className="workspace-table">
                        <caption>Member completion and path counts</caption>
                        <thead>
                          <tr>
                            <th scope="col">Member</th>
                            <th scope="col">Completed units</th>
                            <th scope="col">Remaining units</th>
                            <th scope="col">Completion</th>
                            <th scope="col">Started paths</th>
                            <th scope="col">Completed paths</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chart.map((member) => (
                            <tr key={member.user}>
                              <th scope="row">
                                <Link
                                  href={`/app/analytics?${new URLSearchParams({ ...filters, member: member.user })}`}
                                >
                                  {member.name}
                                </Link>
                              </th>
                              <td>
                                {member.completed} / {member.eligible}
                              </td>
                              <td>{member.remaining}</td>
                              <td>{member.percent}%</td>
                              <td>{member.startedPaths}</td>
                              <td>{member.completedPaths}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
              <section className="workspace-card">
                <h2>Learning path detail</h2>
                {rows.length ? (
                  <div className="table-scroll">
                    <table className="workspace-table">
                      <caption>Current published content by member and learning path</caption>
                      <thead>
                        <tr>
                          <th scope="col">Member</th>
                          <th scope="col">Learning path</th>
                          <th scope="col">Version</th>
                          <th scope="col">Units</th>
                          <th scope="col">Last meaningful activity (all time, UTC)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={`${row.user_id}:${row.revision_id}`}>
                            <td>{labels.get(row.user_id) || "Workspace member"}</td>
                            <th scope="row">
                              <Link href={`/app/learning/${row.course_id}`}>{row.path_title}</Link>
                            </th>
                            <td>{row.revision_number}</td>
                            <td>
                              {row.completed_units} / {row.total_units}
                            </td>
                            <td>
                              {row.last_activity_at ? (
                                <time dateTime={row.last_activity_at}>
                                  {new Date(row.last_activity_at).toLocaleDateString("en-US", {
                                    timeZone: "UTC",
                                  })}
                                </time>
                              ) : (
                                "Not started"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No path detail to show.</p>
                )}
              </section>
            </>
          )}
          <section className="workspace-card">
            <h2>Pilot member activation</h2>
            <p>
              First sign-in and last observed activity are recorded account signals, not proof that
              someone is online.
            </p>
            <div className="table-scroll">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">First sign-in (UTC)</th>
                    <th scope="col">Last observed (UTC)</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((member) => (
                    <tr key={member.id}>
                      <th scope="row">{member.name || member.email}</th>
                      <td>
                        {member.firstLoginAt
                          ? new Date(member.firstLoginAt).toLocaleDateString("en-US", {
                              timeZone: "UTC",
                            })
                          : "Not recorded"}
                      </td>
                      <td>
                        {member.lastSeenAt
                          ? new Date(member.lastSeenAt).toLocaleString("en-US", { timeZone: "UTC" })
                          : "Not recorded"}
                      </td>
                      <td>{member.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!people.length && <p>No provisioned members yet.</p>}
          </section>
        </>
      )}
    </>
  );
}
