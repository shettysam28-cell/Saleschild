"use client";
import { useRouter } from "next/navigation";
import { suggestMappings } from "@/lib/knowledge/readiness";
import type { ImportDiagnostic } from "@/lib/knowledge/diagnostics";
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
  const router = useRouter();
  const [worksheets, setWorksheets] = useState<string[]>([]);
  const [worksheetChoice, setWorksheetChoice] = useState("");
  const [excludedRows, setExcludedRows] = useState<number[]>([]);
  const [issue, setIssue] = useState<ImportDiagnostic>();
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
  const [academyReadiness, setAcademyReadiness] = useState<Readiness>();
  const [academyVisible, setAcademyVisible] = useState(false);
  const file = useRef<File | null>(null),
    requestId = useRef("");
  const upload = useRef<HTMLInputElement>(null);
  async function request<T>(call: () => Promise<T>): Promise<T | undefined> {
    try {
      return await call();
    } catch {
      const message =
        "Connection interrupted. Keep this source and retry. An approved import may already have completed; the same request prevents duplicate writes.";
      setFailed(true);
      setMessage(message);
      setIssue({ code: "NETWORK", message });
      return undefined;
    }
  }
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
    data.set("worksheet", worksheetChoice);
    data.set("excludedRows", JSON.stringify(excludedRows));
    data.set("mapping", JSON.stringify(mapping));
    data.set("requestId", requestId.current);
    if (approve) data.set("approve", "yes");
    return data;
  }
  function inspect(selected: File, worksheet = "") {
    reset();
    setExcludedRows([]);
    setIssue(undefined);
    setWorksheetChoice(worksheet);
    file.current = selected;
    requestId.current = crypto.randomUUID();
    const data = new FormData();
    data.set("file", selected);
    data.set("worksheet", worksheet);
    start(async () => {
      const result = await request(() => inspectKnowledgeUpload(data));
      if (!result) return;
      setIssue(result.diagnostic);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "");
      if (result.diagnostic?.worksheets) {
        setWorksheets(result.diagnostic.worksheets);
        setWorksheetChoice(result.diagnostic.worksheet ?? worksheet);
      }
      if (result.source) {
        setSource(result.source);
        setStep(2);
        setMapping(suggestMappings(result.source.headers));
        setWorksheets(result.source.worksheets ?? []);
        setWorksheetChoice(result.source.worksheet ?? "");
      }
    });
  }
  function validate(approve = false) {
    start(async () => {
      const result = await request(() => validateKnowledgeUpload(form(approve)));
      if (!result) return;
      setIssue(result.diagnostic);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "");
      if (result.readiness) {
        setReadiness(result.readiness);
        setStep(approve ? 5 : 4);
      }
      if (result.imported !== undefined) {
        setImported(result.imported);
        router.refresh();
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
      {worksheets.length > 1 && (
        <label className="form-field">
          Data worksheet
          <select
            value={worksheetChoice}
            disabled={pending}
            onChange={(e) => {
              const f = file.current;
              if (f) inspect(f, e.target.value);
            }}
          >
            {worksheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
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
      {issue && (
        <p className="form-help">
          {issue.code}
          {issue.worksheet ? ` · Worksheet: ${issue.worksheet}` : ""}
          {issue.row ? ` · Row ${issue.row}` : ""}
          {issue.column ? ` · Column: ${issue.column}` : ""}
        </p>
      )}
      {pending && <p role="status">Checking your source securely…</p>}
      {source && step === 2 && (
        <div>
          <h3>Preview: {source.name}</h3>
          <p>
            {source.worksheet ? `${source.worksheet} · ` : ""}
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
                  aria-label={
                    c + (["Topic", "Category", "Knowledge Content"].includes(c) ? " *" : "")
                  }
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
                      <label>
                        <input
                          type="checkbox"
                          checked={excludedRows.includes(r.row)}
                          onChange={(e) => {
                            setExcludedRows(
                              e.target.checked
                                ? [...excludedRows, r.row]
                                : excludedRows.filter((n) => n !== r.row),
                            );
                            setReadiness({ ...readiness, ready: false });
                            setStep(4);
                          }}
                        />
                        Exclude row {r.row}
                      </label>{" "}
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
          {excludedRows.length > 0 && (
            <p>
              {excludedRows.length} row(s) excluded. Revalidate the remaining rows before approval.
            </p>
          )}
          <button className="button button-outline" disabled={pending} onClick={() => validate()}>
            Revalidate selected rows
          </button>
          {excludedRows.length > 0 && (
            <button
              className="button button-outline"
              disabled={pending}
              onClick={() => {
                setExcludedRows([]);
                setReadiness({ ...readiness, ready: false });
                setStep(4);
              }}
            >
              Restore excluded rows
            </button>
          )}
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
                const result = await request(() => previewAcademy());
                if (!result) return;
                setIssue(undefined);
                setFailed(Boolean(result.error));
                setMessage(
                  result.error ??
                    `${result.omitted ?? 0} changed source snapshots omitted. Administrator review is required before any future publication.`,
                );
                setCurriculum(result.curriculum);
                setAcademyReadiness(result.readiness);
                setAcademyVisible(false);
              })
            }
          >
            Check academy readiness <ArrowRight size={16} />
          </button>
        ) : (
          <p>An organization administrator must review academy proposals.</p>
        )}
        {academyReadiness && (
          <div aria-label="Approved knowledge readiness">
            <h4>Review your approved knowledge first</h4>
            <p>
              This snapshot includes approved imported sources. Manual resources without structured
              source records and changed source snapshots are excluded. Refresh the readiness check
              after changing knowledge.
            </p>
            <div className="readiness-grid">
              {[
                ["Knowledge records", academyReadiness.total],
                ["Categories", academyReadiness.categories.length],
                ["Topics", academyReadiness.topics.length],
                ["Subtopics", academyReadiness.subtopics.length],
                ["Missing references", academyReadiness.missingSources],
                ["Incomplete or invalid", academyReadiness.incomplete],
                ["Potential duplicates", academyReadiness.duplicates],
                ["Conflicting records", academyReadiness.conflicts],
                ["Requiring review", academyReadiness.review],
                ["Assessment material", academyReadiness.assessments],
              ].map(([label, value]) => (
                <div key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {academyReadiness.review > 0 && (
              <details>
                <summary>Review missing or uncertain information</summary>
                <ul className="validation-findings">
                  {academyReadiness.issues
                    .filter((r) => r.warnings.length || r.errors.length)
                    .map((r) => (
                      <li key={r.row}>
                        Record {r.row - 1}: {[...r.errors, ...r.warnings].join(" ")}
                      </li>
                    ))}
                </ul>
              </details>
            )}
            <p>
              No missing facts are inferred. This action creates a deterministic preview for your
              review, with no AI service or publication.
            </p>
            <button
              className="button button-dark"
              disabled={pending || !academyReadiness.ready}
              onClick={() => setAcademyVisible(true)}
            >
              Generate My Learning Academy <ArrowRight size={16} />
            </button>
          </div>
        )}
        {curriculum && academyVisible && (
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
