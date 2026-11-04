import { notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen, GraduationCap, ClipboardCheck, Sparkles, Bell, ShieldCheck } from "lucide-react";
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
  searchParams: Promise<{ upload?: string }>;
}) {
  const { section } = await params;
  const selectedModule = modules.find((m) => m.slug === section);
  if (!selectedModule) notFound();
  const { client, user, organization, role } = await requireWorkspace();
  const author = canAuthor(role);
  const admin = canAdmin(role);
  let content: React.ReactNode;
  if (section === "knowledge") {
    const records = checked(
      await client
        .from("knowledge_items")
        .select("id,title,body,source_url,status,current_version,evidence_status,custom_fields")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    content = (
      <>
        {author && (
          <UniversalGateway
            initialUploadId={(await searchParams).upload}
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
    const records = checked(
      await client
        .from("courses")
        .select("id,title,description,status")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    content = (
      <>
        <div className="workspace-notice">
          Plan a learning path and add approved knowledge as source-linked lessons. Assignments and
          progress tracking are being developed.
        </div>
        {author && (
          <details className="workspace-card">
            <summary>Create a draft learning path</summary>
            <div style={{ marginTop: 20 }}>
              <WorkspaceForm kind="learning" />
            </div>
          </details>
        )}
        {records.length ? (
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
  } else if (section === "assessments") {
    const records = checked(
      await client
        .from("assessments")
        .select("id,title,description,status,version")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    content = (
      <>
        <div className="workspace-notice">
          Assessment delivery, randomized question banks, and grading are planned. Historical
          assessment versions will be preserved.
        </div>
        {records.length ? (
          <div className="record-list">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <div>
                  <h2>{record.title}</h2>
                  <span className="record-badge">{record.status}</span>
                </div>
                <p>{record.description}</p>
                <small>Version {record.version}</small>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Understanding, made clearer."
            description="Your team’s assessments will appear here once they are ready."
            icon={ClipboardCheck}
          />
        )}
      </>
    );
  } else if (section === "workflows") {
    const records = checked(
      await client
        .from("ai_workflows")
        .select("id,objective,status,mode")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    content = (
      <>
        <div className="workspace-notice">
          Save draft workflow requests for future assistance. AI processing, autonomous actions, and
          external integrations are not enabled.
        </div>
        {author && (
          <details className="workspace-card">
            <summary>Prepare a workflow request</summary>
            <div style={{ marginTop: 20 }}>
              <WorkspaceForm kind="workflows" />
            </div>
          </details>
        )}
        {records.length ? (
          <div className="record-list">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <div>
                  <h2>{record.mode} workflow</h2>
                  <span className="record-badge">{record.status}</span>
                </div>
                <p>{record.objective}</p>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="A thoughtful next step."
            description="Draft requests will live here, ready for your team to review."
            icon={Sparkles}
          />
        )}
      </>
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
    if (!admin)
      content = (
        <Empty
          title="A space for organization admins."
          description="Your organization’s owners and administrators can review workspace analytics and governance."
          icon={ShieldCheck}
        />
      );
    else {
      const counts = await Promise.all([
        client
          .from("knowledge_items")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organization.id),
        client
          .from("courses")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organization.id),
        client
          .from("memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("organization_id", organization.id),
      ]);
      if (counts.some((c) => c.error)) throw new Error("Analytics could not be loaded.");
      const events = checked(
        await client
          .from("audit_events")
          .select("id,event_type,entity_type,created_at")
          .eq("organization_id", organization.id)
          .order("created_at", { ascending: false })
          .limit(25),
      );
      content = (
        <>
          <div className="workspace-stats">
            {["Knowledge resources", "Learning paths", "Organization members"].map((label, i) => (
              <div className="workspace-stat" key={label}>
                <span>{label}</span>
                <strong>{counts[i].count ?? 0}</strong>
                <small>Current organization</small>
              </div>
            ))}
          </div>
          <div className="workspace-card">
            <h2>Governance activity</h2>
            <p>
              Recent organization changes. Learning effectiveness and performance reporting will be
              added as learning activity becomes available.
            </p>
            <div className="table-scroll">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Record type</th>
                    <th scope="col">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>{event.event_type}</td>
                      <td>{event.entity_type}</td>
                      <td>{new Date(event.created_at).toLocaleDateString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!events.length && <p>No activity recorded yet.</p>}
          </div>
        </>
      );
    }
  } else {
    const members = admin
      ? checked(
          await client
            .from("memberships")
            .select("user_id,role,created_at")
            .eq("organization_id", organization.id)
            .order("created_at")
            .limit(100),
        )
      : [];
    content = (
      <>
        <div className="workspace-card">
          <h2>Organization details</h2>
          {admin ? (
            <WorkspaceForm kind="settings" name={organization.name} />
          ) : (
            <p>
              {organization.name} · Your role: {role}. Contact your administrator to update
              organization details.
            </p>
          )}
        </div>
        <div className="workspace-card">
          <h2>Your account</h2>
          <p>{user.email}</p>
          <p>Workspace access is based on your organization membership.</p>
        </div>
        <div className="workspace-notice">
          Member invitations, role administration, and email preferences are planned. Your current
          permissions remain enforced across the workspace.
        </div>
        {admin && (
          <div className="workspace-card">
            <h2>Organization members</h2>
            <p>
              Membership identifiers and assigned roles. Changes to roles and invitations are not
              enabled.
            </p>
            <div className="table-scroll">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">Member identifier</th>
                    <th scope="col">Role</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.user_id}>
                      <td>{member.user_id === user.id ? "You" : member.user_id}</td>
                      <td className="member-role">{member.role}</td>
                      <td>{new Date(member.created_at).toLocaleDateString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <div className="app-title-row">
        <div>
          <h1>{selectedModule.title}</h1>
          <p>{selectedModule.description}</p>
        </div>
      </div>
      {content}
    </>
  );
}
