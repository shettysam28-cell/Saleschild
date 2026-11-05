import { notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen, GraduationCap, Bell } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { canAuthor, canAdmin } from "@/lib/permissions";
import { modules } from "@/lib/modules";
import { WorkspaceForm } from "@/components/workspace-form";
import { KnowledgeEditor } from "@/components/knowledge-editor";
import { KnowledgeOnboarding } from "@/components/knowledge-onboarding";
import { UniversalGateway } from "@/components/universal-gateway";
import { GatewayRecordEditor } from "@/components/gateway-record-editor";
import { listGatewayUploads } from "@/app/app/knowledge/gateway-actions";
import { markNotificationRead } from "@/app/app/actions";
import { WorkspaceAnalytics } from "@/components/workspace-analytics";
import { WorkspaceProgression } from "@/components/workspace-progression";
import { readWorkspaceProgress, readLearningPathCards } from "@/lib/workspace-data";
import { parseAnalyticsFilters } from "@/lib/workspace-progress";
import { AccountSettings } from "@/components/account-settings";
import { getAccountSettings } from "@/lib/member-management";
import { OrganizationDetails } from "@/components/organization-details";
import { DraftManager } from "@/components/draft-manager";
import { loadDraftManager } from "@/lib/knowledge/draft-manager";
function Empty({
  title,
  description,
  icon: Icon = BookOpen,
}: {
  title: string;
  description: string;
  icon?: typeof BookOpen;
}) {
  return (
    <div className="empty-state">
      <Icon size={27} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function checked<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw new Error("Workspace data could not be loaded.");
  return (data ?? []) as NonNullable<T>;
}
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const selectedModule = modules.find((m) => m.slug === section);
  if (!selectedModule) notFound();
  const { client, user, organization, role } = await requireWorkspace();
  const author = canAuthor(role);
  const admin = canAdmin(role);
  const query = await searchParams;
  if (section === "knowledge" && !author) notFound();
  if (section === "progression" && role !== "learner") notFound();
  let content: React.ReactNode;
  if (section === "knowledge") {
    const records = checked(
      await client
        .from("knowledge_items")
        .select("id,title,body,source_url,status,current_version,evidence_status,custom_fields")
        .eq("organization_id", organization.id)
        .is("discarded_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    content = (
      <>
        {author && <DraftManager initial={await loadDraftManager()} />}
        {author && (
          <UniversalGateway
            initialUploadId={typeof query.upload === "string" ? query.upload : undefined}
            recent={await listGatewayUploads()}
          />
        )}
        {author && (
          <details className="workspace-card">
            <summary>Optional source templates and Academy preview</summary>
            <KnowledgeOnboarding admin={admin} />
          </details>
        )}
        {author && (
          <details className="workspace-card">
            <summary>Add a knowledge resource</summary>
            <div style={{ marginTop: 20 }}>
              <WorkspaceForm kind="knowledge" publish={admin} />
            </div>
          </details>
        )}
        {records.length ? (
          <div className="record-list" aria-label="Saved knowledge">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <div>
                  <h2>
                    <Link href={`/app/knowledge/${record.id}`}>{record.title}</Link>
                  </h2>
                  <span className="record-badge">{record.status}</span>
                </div>
                <p className="knowledge-body">{record.body}</p>
                <small>
                  Version {record.current_version} · Evidence: {record.evidence_status}
                  {record.source_url && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={record.source_url} target="_blank" rel="noopener noreferrer">
                        Source
                      </a>
                    </>
                  )}
                </small>
                {author &&
                  (record.status === "draft" || admin) &&
                  (record.custom_fields.length ? (
                    <GatewayRecordEditor
                      key={`${record.id}:${record.current_version}`}
                      record={record}
                      admin={admin}
                    />
                  ) : (
                    record.status === "draft" && <KnowledgeEditor record={record} publish={admin} />
                  ))}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Good knowledge starts somewhere."
            description={
              author
                ? "Add your first resource to begin building a trusted foundation."
                : "Your team’s approved knowledge will appear here when it’s published."
            }
          />
        )}
      </>
    );
  } else if (section === "learning") {
    const { records, error } = await readLearningPathCards();
    content = (
      <>
        <div className="workspace-notice">
          {author
            ? "Build from approved source knowledge. Owner previews never record learner progress; publish deliberately when the path is ready."
            : "Learn from approved company knowledge. Meaningful learning actions build your progress; opening a path does not complete it."}
        </div>
        {author && (
          <details className="workspace-card">
            <summary>Create a draft learning path</summary>
            <div style={{ marginTop: 20 }}>
              <WorkspaceForm kind="learning" />
            </div>
          </details>
        )}
        {error ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : records.length ? (
          <div className="record-list">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <div>
                  <h2>
                    <Link href={`/app/learning/${record.id}`}>{record.title}</Link>
                  </h2>
                  <span className="record-badge">{record.status}</span>
                </div>
                <p>{record.description}</p>
                <Link className="text-link" href={`/app/learning/${record.id}`}>
                  Open learning path
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Every capability has a beginning."
            description="Your organization’s learning paths will appear here."
            icon={GraduationCap}
          />
        )}
      </>
    );
  } else if (section === "assessments" || section === "workflows") {
    content = (
      <section className="workspace-card workspace-wip">
        <span className="record-badge">Work in progress</span>
        <h2>
          {section === "assessments"
            ? "Assessment is being prepared."
            : "AI Workflow is being prepared."}
        </h2>
        <p>
          {section === "assessments"
            ? "Assessment delivery and grading are not enabled. Practice checkpoints within learning paths are source-based exercises, separate from this future assessment module."
            : "AI models, workflow requests, processing and external actions are not enabled. Your company knowledge is not sent to a model."}
        </p>
        <button className="button button-outline" disabled>
          {section === "assessments" ? "Assessment unavailable" : "Workflow unavailable"}
        </button>
      </section>
    );
  } else if (section === "notifications") {
    const records = checked(
      await client
        .from("notifications")
        .select("id,title,body,read_at,created_at")
        .eq("organization_id", organization.id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    content = records.length ? (
      <div className="record-list">
        {records.map((record) => (
          <article className="record-card" key={record.id}>
            <div>
              <h2>{record.title}</h2>
              {!record.read_at && (
                <form action={markNotificationRead}>
                  <input type="hidden" name="id" value={record.id} />
                  <button>Mark as read</button>
                </form>
              )}
            </div>
            <p>{record.body}</p>
            <small>
              {record.read_at ? "Read" : "Unread"} ·{" "}
              {new Date(record.created_at).toLocaleDateString("en-US")}
            </small>
          </article>
        ))}
      </div>
    ) : (
      <Empty
        title="You’re all caught up."
        description="Updates for you will appear here."
        icon={Bell}
      />
    );
  } else if (section === "analytics") {
    if (role !== "owner") notFound();
    const parsed = parseAnalyticsFilters(query);
    const filters = "error" in parsed ? { from: "", to: "", member: "", path: "" } : parsed;
    const governance = query.tab === "governance";
    const empty = { rows: [], error: undefined };
    const optionsPromise = governance ? Promise.resolve(empty) : readWorkspaceProgress();
    const hasFilters = Object.values(filters).some(Boolean);
    const [options, progress, settings, eventResult] = await Promise.all([
      optionsPromise,
      governance
        ? Promise.resolve(empty)
        : "error" in parsed
          ? Promise.resolve({ rows: [], error: parsed.error })
          : hasFilters
            ? readWorkspaceProgress(filters)
            : optionsPromise,
      governance ? Promise.resolve(null) : getAccountSettings().catch(() => null),
      !governance
        ? Promise.resolve({ data: [], error: null })
        : client
            .from("audit_events")
            .select("id,event_type,entity_type,created_at")
            .eq("organization_id", organization.id)
            .order("created_at", { ascending: false })
            .limit(25),
    ]);
    if (eventResult.error) throw new Error("Governance activity could not be loaded.");
    content = (
      <WorkspaceAnalytics
        rows={progress.rows}
        options={options.rows}
        members={settings?.members ?? []}
        filters={filters}
        error={
          progress.error ||
          options.error ||
          (!governance && !settings
            ? "Member details are unavailable. Verify the approved workspace migration before reviewing analytics."
            : undefined)
        }
        events={eventResult.data ?? []}
        governance={governance}
      />
    );
  } else if (section === "progression") {
    content = <WorkspaceProgression {...await readWorkspaceProgress()} />;
  } else {
    content = (
      <>
        <OrganizationDetails name={organization.name} owner={role === "owner"} role={role} />
        <AccountSettings initial={await getAccountSettings()} owner={role === "owner"} />
      </>
    );
  }
  return (
    <>
      <div className="app-title-row">
        <div>
          <h1>
            {section === "learning" && role === "learner"
              ? "Learning Pathway"
              : selectedModule.title}
          </h1>
          <p>{selectedModule.description}</p>
        </div>
      </div>
      {content}
    </>
  );
}
