import { UniversalGateway } from "../../src/components/universal-gateway";
import { GatewayRecordEditor } from "../../src/components/gateway-record-editor";
import { KnowledgeRecordView } from "../../src/components/knowledge-record-view";
import { LearningPathView } from "../../src/components/learning-path-view";
import { WorkspaceForm } from "../../src/components/workspace-form";
import { Brand } from "../../src/components/brand";
import { AppNav } from "../../src/components/app-nav";
import { WorkspaceAccountMenu } from "../../src/components/workspace-account-menu";
import { KnowledgeFetch } from "../../src/components/knowledge-fetch";
import { WorkspaceProgression } from "../../src/components/workspace-progression";
import { WorkspaceAnalytics } from "../../src/components/workspace-analytics";
import { DraftManager } from "../../src/components/draft-manager";
import type { DraftManagerData } from "../../src/lib/knowledge/draft-types";
import type { LearningWorkspace } from "../../src/lib/learning/read-model";
import type { Role } from "../../src/lib/permissions";
import type { ProgressRow } from "../../src/lib/workspace-progress";
import type { loadKnowledgeRecord } from "../../src/lib/knowledge/record";
import type { loadLearningPath } from "../../src/lib/knowledge/learning";
import type { EditableKnowledge } from "../../src/components/gateway-record-editor";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { KnowledgeOnboarding } from "../../src/components/knowledge-onboarding";
import { KnowledgeEditor } from "../../src/components/knowledge-editor";
import "../../src/app/globals.css";
function LegacyApp() {
  const [records, setRecords] = useState<
    Array<{
      id: string;
      title: string;
      body: string;
      source_url: string | null;
      current_version: number;
      status: string;
    }>
  >([]);
  const load = () => {
    fetch("/records")
      .then((r) => r.json())
      .then(setRecords);
  };
  useEffect(() => {
    load();
    window.addEventListener("fixture-refresh", load);
    return () => window.removeEventListener("fixture-refresh", load);
  }, []);
  return (
    <main id="main" style={{ maxWidth: 1100, margin: "auto", padding: 24 }}>
      <h1>Isolated import regression fixture</h1>
      <KnowledgeOnboarding admin />
      <div aria-label="Saved knowledge">
        {records.map((r) => (
          <article className="record-card" key={r.id}>
            <h2>{r.title}</h2>
            <p>{r.body}</p>
            <span>{r.status}</span>
            {r.status === "draft" && <KnowledgeEditor record={r} publish />}
          </article>
        ))}
      </div>
    </main>
  );
}

function UniversalApp() {
  const [records, setRecords] = useState<(EditableKnowledge & { source_url: string | null })[]>([]),
    [paths, setPaths] = useState<{ id: string; title: string; description: string }[]>([]),
    [recent, setRecent] = useState<{ id: string; source_name: string; expires_at: string }[]>([]);
  const [role, setRole] = useState<Role>("learner"),
    [learning, setLearning] = useState<LearningWorkspace>(),
    [analytics, setAnalytics] = useState<React.ComponentProps<typeof WorkspaceAnalytics>>(),
    [drafts, setDrafts] = useState<DraftManagerData>({ groups: [] }),
    [progression, setProgression] = useState<{ rows: ProgressRow[]; error?: string }>({ rows: [] });
  const [record, setRecord] = useState<Awaited<ReturnType<typeof loadKnowledgeRecord>> | undefined>(
      undefined,
    ),
    [path, setPath] = useState<Awaited<ReturnType<typeof loadLearningPath>> | undefined>(undefined);
  const current = window.location.pathname,
    recordId = /^\/app\/knowledge\/([\da-f-]+)$/.exec(current)?.[1],
    pathId = /^\/app\/learning\/([\da-f-]+)$/.exec(current)?.[1];
  useEffect(() => {
    const get = (url: string) =>
      fetch(url).then((r) => {
        if (!r.ok) throw Error("Fixture read failed");
        return r.json();
      });
    const load = () => {
      void get("/me").then((data) => setRole(data.role));
      if (recordId) void get("/record-data?id=" + recordId).then(setRecord);
      else if (pathId) {
        void get("/path-data?id=" + pathId).then(setPath);
        void get("/learning-data?id=" + pathId).then(setLearning);
      } else {
        void get("/records").then(setRecords);
        void get("/paths").then(setPaths);
        void get("/recent-uploads").then(setRecent);
        if (current === "/app/knowledge") void get("/draft-data").then(setDrafts);
        if (current === "/app/progression") void get("/progress-data").then(setProgression);
        if (current === "/app/analytics")
          void get("/analytics-data" + window.location.search).then(setAnalytics);
      }
    };
    load();
    window.addEventListener("fixture-refresh", load);
    return () => window.removeEventListener("fixture-refresh", load);
  }, [current, recordId, pathId]);
  const author = ["owner", "admin", "editor"].includes(role),
    admin = ["owner", "admin"].includes(role);
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Brand href="/app" />
        <div className="org-label">
          Fictional organization<small>Local isolated integration fixture</small>
        </div>
        <AppNav role={role} />
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <span>
            Synthetic verified-account fixture · real local SQL/RLS · no hosted Auth claim
          </span>
          <WorkspaceAccountMenu
            displayName={author ? "Fictional Owner" : "Fictional Member"}
            organization="Fictional organization"
            role={role}
          />
        </header>
        <main id="main" className="app-content">
          {recordId ? (
            record === undefined ? (
              <p>Loading resource…</p>
            ) : record ? (
              <KnowledgeRecordView data={record} />
            ) : (
              <p role="alert">Resource not available.</p>
            )
          ) : pathId ? (
            path === undefined ? (
              <p>Loading path…</p>
            ) : path ? (
              <LearningPathView data={path} learning={learning} />
            ) : (
              <p role="alert">Learning path not available.</p>
            )
          ) : current === "/app/analytics" ? (
            <>
              <h1>Analytics</h1>
              {analytics && <WorkspaceAnalytics {...analytics} />}
            </>
          ) : current === "/app/progression" ? (
            <>
              <h1>Progression</h1>
              <WorkspaceProgression {...progression} />
            </>
          ) : current === "/app/learning" ? (
            <>
              <h1>Learning Paths</h1>
              {author && <WorkspaceForm kind="learning" />}
              <div aria-label="Learning Paths">
                {paths.map((p) => (
                  <article key={p.id} className="record-card">
                    <h2>{p.title}</h2>
                    <p>{p.description}</p>
                    <a href={"/app/learning/" + p.id}>Open learning path</a>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1>{current === "/app" ? "Your workspace" : "Knowledge Gateway"}</h1>
              {current === "/app" && (
                <KnowledgeFetch suggestions={["Fictional", "source checkpoint"]} />
              )}
              {author && <UniversalGateway recent={recent} />}
              {author && current === "/app/knowledge" && <DraftManager initial={drafts} />}
              <div aria-label="Saved knowledge">
                {records.map((r) => (
                  <article key={r.id} className="record-card">
                    <h2>
                      <a href={"/app/knowledge/" + r.id}>{r.title}</a>
                    </h2>
                    <p className="knowledge-body">{r.body}</p>
                    <span>{r.status}</span>
                    {author &&
                      (r.status === "draft" || admin) &&
                      (r.custom_fields.length ? (
                        <GatewayRecordEditor
                          key={r.id + ":" + r.current_version}
                          record={r}
                          admin={admin}
                        />
                      ) : (
                        r.status === "draft" && <KnowledgeEditor record={r} publish={admin} />
                      ))}
                  </article>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
const current = window.location.pathname;
createRoot(document.getElementById("root")!).render(
  current === "/" ? (
    <LegacyApp />
  ) : current === "/marketing" ? (
    <main>
      <Brand />
      <h1>Marketing navigation fixture</h1>
    </main>
  ) : (
    <UniversalApp />
  ),
);
