import Link from "next/link";
import { ArrowUpRight, BookOpen, GraduationCap, BarChart3, Bell } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { readWorkspaceProgress } from "@/lib/workspace-data";
import { KnowledgeFetch } from "@/components/knowledge-fetch";
import { summarizeProgress } from "@/lib/workspace-progress";

export default async function Home() {
  const { client, organization, role, profile, user } = await requireWorkspace();
  const member = role === "learner";
  const [knowledge, courses, suggestions, notifications, progress] = await Promise.all([
    client
      .from("knowledge_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "published"),
    client
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id),
    client
      .from("knowledge_items")
      .select("title")
      .eq("organization_id", organization.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(3),
    client
      .from("notifications")
      .select("id,title,read_at")
      .eq("organization_id", organization.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3),
    readWorkspaceProgress(),
  ]);
  const overviewError = knowledge.error || courses.error;
  const totals = summarizeProgress(progress.rows);
  const next = member
    ? [...progress.rows]
        .sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""))
        .find((row) => !row.completed_at)
    : undefined;
  const shortcuts = member
    ? [
        {
          title: "Learning Pathway",
          description: "Explore published paths built from approved company knowledge.",
          href: "learning",
          icon: GraduationCap,
        },
        {
          title: "Progression",
          description: "Review meaningful actions, completed units and what comes next.",
          href: "progression",
          icon: BarChart3,
        },
      ]
    : [
        {
          title: "Knowledge Gateway",
          description: "Upload, review and approve the knowledge your team can trust.",
          href: "knowledge",
          icon: BookOpen,
        },
        {
          title: "Learning Paths",
          description: "Build source-linked learning and preview it before publication.",
          href: "learning",
          icon: GraduationCap,
        },
        ...(role === "owner"
          ? [
              {
                title: "Analytics",
                description: "Inspect actual learning activity and governance.",
                href: "analytics",
                icon: BarChart3,
              },
            ]
          : []),
      ];
  return (
    <>
      <div className="app-title-row">
        <div>
          <div className="eyebrow">A LITTLE MORE POSSIBLE</div>
          <h1>{profile.displayName ? `Hello, ${profile.displayName}.` : "Welcome home."}</h1>
          <p>
            {organization.name} ·{" "}
            {member
              ? "Your next useful step starts here."
              : "Turn your team’s knowledge into purposeful learning."}
          </p>
        </div>
      </div>
      <KnowledgeFetch suggestions={(suggestions.data ?? []).map((row) => row.title)} />
      {member && (
        <section className="workspace-card">
          <h2>Continue learning</h2>
          {progress.error ? (
            <p role="alert">{progress.error}</p>
          ) : next ? (
            <>
              <h3>{next.path_title}</h3>
              <p>
                {next.completed_units} of {next.total_units} units complete · version{" "}
                {next.revision_number}
              </p>
              <Link className="button button-dark" href={`/app/learning/${next.course_id}`}>
                {next.started_at ? "Continue learning" : "Start learning"}
              </Link>
            </>
          ) : (
            <p>
              {progress.rows.length
                ? "You have completed the available learning units. Revisit a path at any time."
                : "Your owner has not published an eligible learning path yet."}
            </p>
          )}
        </section>
      )}
      {overviewError ? (
        <p className="form-message" role="alert">
          Workspace totals could not be verified. Please refresh to try again.
        </p>
      ) : (
        <div className="workspace-stats">
          <div className="workspace-stat">
            <span>Approved knowledge sources</span>
            <strong>{knowledge.count ?? 0}</strong>
            <small>Current authorized records</small>
          </div>
          <div className="workspace-stat">
            <span>{member ? "Available learning paths" : "Visible learning paths"}</span>
            <strong>{courses.count ?? 0}</strong>
            <small>Current authorized records</small>
          </div>
          <div className="workspace-stat">
            <span>{member ? "Learning units completed" : "Member learning units completed"}</span>
            <strong>
              {progress.error ? "Unavailable" : `${totals.completed} / ${totals.eligible}`}
            </strong>
            <small>
              {progress.error
                ? "Progression is unavailable in this workspace"
                : "Current published content"}
            </small>
          </div>
        </div>
      )}
      <div className="workspace-grid">
        {shortcuts.map(({ title, description, href, icon: Icon }) => (
          <Link href={`/app/${href}`} className="workspace-module" key={href}>
            <Icon size={23} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{description}</p>
            <span>
              Open <ArrowUpRight size={13} aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
      <section className="workspace-card home-notifications">
        <div className="workspace-section-heading">
          <h2>
            <Bell size={17} aria-hidden="true" /> Your notifications
          </h2>
          <Link className="text-link" href="/app/notifications">
            Open Notification Hub
          </Link>
        </div>
        {notifications.error ? (
          <p role="alert">Notifications could not be loaded.</p>
        ) : notifications.data?.length ? (
          <ul>
            {notifications.data.map((notification) => (
              <li key={notification.id}>
                <span>{notification.title}</span>
                <small>{notification.read_at ? "Read" : "Unread"}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>You’re all caught up.</p>
        )}
      </section>
    </>
  );
}
