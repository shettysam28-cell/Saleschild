"use client";
import { useRef, useState, useTransition } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  ArrowRight,
  CheckCircle2,
  BookOpen,
  RotateCcw,
} from "lucide-react";
import { columns, templateLibrary, type Column } from "@/lib/knowledge/templates";
import type { ParsedSource } from "@/lib/knowledge/spreadsheets";
import type { Readiness, curriculumPreview } from "@/lib/knowledge/readiness";
import {
  inspectKnowledgeUpload,
  validateKnowledgeUpload,
  previewAcademy,
} from "@/app/app/knowledge/import-actions";
type Curriculum = ReturnType<typeof curriculumPreview>;
export function KnowledgeOnboarding({ admin }: { admin: boolean }) {
  const [library, setLibrary] = useState(false),
    [step, setStep] = useState(1),
    [source, setSource] = useState<ParsedSource>();
  const [mapping, setMapping] = useState<Partial<Record<Column, string>>>({}),
    [readiness, setReadiness] = useState<Readiness>();
  const [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false),
    [imported, setImported] = useState<number>();
  const [curriculum, setCurriculum] = useState<Curriculum>(),
    [pending, start] = useTransition();
  const file = useRef<File | null>(null),
    requestId = useRef("");
  const upload = useRef<HTMLInputElement>(null);
  function reset() {
    file.current = null;
    setSource(undefined);
    setReadiness(undefined);
    setStep(1);
    setImported(undefined);
    setMessage("");
    setFailed(false);
    if (upload.current) upload.current.value = "";
  }
  function form(approve = false) {
    const data = new FormData();
    if (file.current) data.set("file", file.current);
    data.set("mapping", JSON.stringify(mapping));
    data.set("requestId", requestId.current);
    if (approve) data.set("approve", "yes");
    return data;
  }
  function inspect(selected: File) {
    reset();
    file.current = selected;
    requestId.current = crypto.randomUUID();
    const data = new FormData();
    data.set("file", selected);
    start(async () => {
      const result = await inspectKnowledgeUpload(data);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "");
      if (result.source) {
        setSource(result.source);
        setStep(2);
        setMapping(
          Object.fromEntries(
            columns.map((c) => [
              c,
              result.source!.headers.find((h) => h.toLowerCase() === c.toLowerCase()) ?? "",
            ]),
          ),
        );
      }
    });
  }
  function validate(approve = false) {
    start(async () => {
      const result = await validateKnowledgeUpload(form(approve));
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "");
      if (result.readiness) {
        setReadiness(result.readiness);
        setStep(approve ? 5 : 4);
      }
      if (result.imported !== undefined) {
        setImported(result.imported);
        setStep(6);
        setMessage(
          `${result.imported} records imported as unverified drafts. Nothing has been published.`,
        );
      }
    });
  }
  return (
    <section className="knowledge-onboarding workspace-card" aria-labelledby="start-knowledge">
      <div className="knowledge-heading">
        <div>
          <span className="eyebrow">YOUR KNOWLEDGE. YOUR NEXT CHAPTER.</span>
          <h2 id="start-knowledge">Start with Your Knowledge</h2>
          <p>Turn what your team knows into a foundation you can trust.</p>
        </div>
        <FileSpreadsheet aria-hidden="true" size={36} />
      </div>
      <div className="knowledge-entry">
        <button
          className="knowledge-choice"
          disabled={pending}
          onClick={() => upload.current?.click()}
        >
          <UploadCloud aria-hidden="true" />
          <strong>Upload Existing Knowledge</strong>
          <span>Preview and map your CSV or Excel source.</span>
          <ArrowRight size={18} />
        </button>
        <button
          className="knowledge-choice"
          disabled={pending}
          aria-expanded={library}
          onClick={() => setLibrary(!library)}
        >
          <FileSpreadsheet aria-hidden="true" />
          <strong>Start with a Template</strong>
          <span>Seven starting points. Make them your own.</span>
          <ArrowRight size={18} />
        </button>
      </div>
      {library && (
        <div className="template-library">
          <p>
            Fictional examples only. Replace sample facts with your approved sources. Excel includes
            Instructions and Sample Data sheets. Blank CSV files contain headers.
          </p>
          {templateLibrary.map((t) => (
            <article className="template-tile" key={t.id}>
              <h3>{t.name}</h3>
              <p>{t.topic}</p>
              <div>
                {(["xlsx", "csv"] as const).map((format) => (
                  <div key={format}>
                    <strong>{format.toUpperCase()}</strong>
                    {(["blank", "sample"] as const).map((variant) => (
                      <a
                        key={variant}
                        href={`/app/knowledge/templates?id=${t.id}&format=${format}&variant=${variant}`}
                        download
                        aria-label={`Download ${t.name} ${variant} ${format} template`}
                      >
                        {variant === "blank" ? "Blank" : "With examples"}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="knowledge-upload">
        <label className="form-field">
          Choose your knowledge source
          <input
            ref={upload}
            type="file"
            accept=".csv,.xlsx"
            disabled={pending}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) inspect(selected);
            }}
          />
        </label>
        <small>
          CSV or XLSX · 2 MiB · up to 200 records. PDF and DOCX extraction: coming soon. No files
          are sent to an AI.
        </small>
      </div>
      <ol className="import-steps" aria-label="Import progress">
        {["Choose source", "Preview", "Map columns", "Validate", "Readiness", "Import drafts"].map(
          (label, i) => (
            <li key={label} aria-current={step === i + 1 ? "step" : undefined}>
              <span>{i + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      {message && (
        <p className="form-message" role={failed ? "alert" : "status"} data-error={failed}>
          {message}
        </p>
      )}
      {pending && <p role="status">Checking your source securely…</p>}
      {source && step === 2 && (
        <div>
          <h3>Preview: {source.name}</h3>
          <p>
            {source.rows.length} records · first three shown. Your source is treated as untrusted
            data.
          </p>
          <div
            className="source-table"
            tabIndex={0}
            role="region"
            aria-label="Source preview, scroll horizontally"
          >
            <table>
              <thead>
                <tr>
                  {source.headers.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {source.rows.slice(0, 3).map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j}>
                        {v.slice(0, 220)}
                        {v.length > 220 ? "…" : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="button button-dark" onClick={() => setStep(3)}>
            Map columns <ArrowRight size={16} />
          </button>
        </div>
      )}
      {source && step === 3 && (
        <div>
          <h3>Match your columns</h3>
          <p>
            Topic, Category and Knowledge Content are required. Map optional fields to improve
            readiness.
          </p>
          <div className="mapping-grid">
            {columns.map((c) => (
              <label className="form-field" key={c}>
                {c}
                {["Topic", "Category", "Knowledge Content"].includes(c) ? " *" : ""}
                <select
                  value={mapping[c] ?? ""}
                  disabled={pending}
                  onChange={(e) => setMapping({ ...mapping, [c]: e.target.value })}
                >
                  <option value="">Skip this field</option>
                  {source.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className="button button-dark" disabled={pending} onClick={() => validate()}>
            Validate records <ArrowRight size={16} />
          </button>
        </div>
      )}
      {readiness && [4, 5].includes(step) && (
        <div>
          <h3>{step === 4 ? "Source validation" : "Your knowledge readiness"}</h3>
          <div className="readiness-grid">
            {[
              ["Knowledge records", readiness.total],
              ["Categories", readiness.categories.length],
              ["Topics", readiness.topics.length],
              ["Subtopics", readiness.subtopics.length],
              ["Missing references", readiness.missingSources],
              ["Incomplete or invalid", readiness.incomplete],
              ["Potential duplicates", readiness.duplicates],
              ["Conflicting records", readiness.conflicts],
              ["Requiring review", readiness.review],
              ["Assessment material", readiness.assessments],
            ].map(([label, value]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p>
            Categories: {readiness.categories.join(", ") || "None"}. No missing facts have been
            filled in.
          </p>
          {readiness.issues.some((r) => r.errors.length || r.warnings.length) && (
            <details open={!readiness.ready}>
              <summary>Review record-level findings</summary>
              <ul className="validation-findings">
                {readiness.issues
                  .filter((r) => r.errors.length || r.warnings.length)
                  .map((r) => (
                    <li key={r.row}>
                      <strong>Row {r.row}</strong>: {[...r.errors, ...r.warnings].join(" ")}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <p>
            Imported knowledge remains unverified. Source references, dates, owners and assessment
            answers are preserved for author review. No raw file is retained.
          </p>
          <div className="knowledge-actions">
            <button
              className="button button-outline"
              disabled={pending}
              onClick={() => {
                setReadiness(undefined);
                setStep(3);
              }}
            >
              Change mapping
            </button>
            {step === 4 ? (
              <button
                className="button button-dark"
                disabled={pending || !readiness.ready}
                onClick={() => setStep(5)}
              >
                Review import <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="button button-dark"
                disabled={pending || !readiness.ready}
                onClick={() => validate(true)}
              >
                Approve and import {readiness.total} drafts
              </button>
            )}
          </div>
        </div>
      )}
      {imported !== undefined && (
        <div className="import-complete">
          <CheckCircle2 aria-hidden="true" />
          <h3>Your knowledge has a home.</h3>
          <p>Review your drafts below. Importing has not created lessons or sent email.</p>
        </div>
      )}
      {source && (
        <button className="knowledge-reset" disabled={pending} onClick={reset}>
          <RotateCcw size={15} />
          Choose a different source
        </button>
      )}
      <div className="academy-preview">
        <BookOpen aria-hidden="true" />
        <h3>Generate My Learning Academy</h3>
        <p>
          Preview a curriculum assembled from approved source records. This deterministic preview
          copies your knowledge and assessment material; no AI model is connected. It never
          publishes courses.
        </p>
        {admin ? (
          <button
            className="button button-dark"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await previewAcademy();
                setFailed(Boolean(result.error));
                setMessage(
                  result.error ??
                    `${result.omitted ?? 0} changed source snapshots omitted. Administrator review is required before any future publication.`,
                );
                setCurriculum(result.curriculum);
              })
            }
          >
            Preview my academy <ArrowRight size={16} />
          </button>
        ) : (
          <p>An organization administrator must review academy proposals.</p>
        )}
        {curriculum && (
          <div aria-label="Deterministic academy preview">
            <p className="record-badge">
              Preview only · administrator review required · no publication
            </p>
            {curriculum.map((path) => (
              <article key={path.title}>
                <h4>{path.title}</h4>
                {path.lessons.map((lesson) => (
                  <details key={lesson.id}>
                    <summary>{lesson.title}</summary>
                    <p>{lesson.objective}</p>
                    <p>{lesson.content}</p>
                    {lesson.scenario && <p>Scenario: {lesson.scenario}</p>}
                    {lesson.question && (
                      <p>
                        Assessment draft: {lesson.question}
                        <br />
                        Options: {lesson.options}
                        <br />
                        Source answer: {lesson.answer}
                      </p>
                    )}
                    <small>
                      Source: {lesson.source} · Knowledge {lesson.id} · version {lesson.version}
                    </small>
                  </details>
                ))}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
