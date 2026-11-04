import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { KnowledgeOnboarding } from "../../src/components/knowledge-onboarding";
import { KnowledgeEditor } from "../../src/components/knowledge-editor";
import "../../src/app/globals.css";
function App() {
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
createRoot(document.getElementById("root")!).render(<App />);
