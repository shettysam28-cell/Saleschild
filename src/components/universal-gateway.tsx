"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  uploadGatewaySource,
  loadGatewayUpload,
  saveGatewayReview,
  commitGatewayUpload,
  discardGatewayUpload,
} from "@/app/app/knowledge/gateway-actions";
import {
  reviewRows,
  type GatewayUpload,
  type ReviewChoices,
  type DuplicateResult,
} from "@/lib/knowledge/gateway-model";

type Props = {
  initialUploadId?: string;
  recent?: { id: string; source_name: string; expires_at: string }[];
};
function reviewLocation(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("upload", id);
  else url.searchParams.delete("upload");
  window.history.replaceState(null, "", url);
}
export function UniversalGateway({ initialUploadId, recent = [] }: Props) {
  const router = useRouter();
  const [upload, setUpload] = useState<GatewayUpload>();
  const [choices, setChoices] = useState<ReviewChoices>();
  const [duplicates, setDuplicates] = useState<DuplicateResult[]>([]);
  const [busy, setBusy] = useState(false),
    [autosaving, setAutosaving] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false),
    [page, setPage] = useState(0),
    [saveLocked, setSaveLocked] = useState(false);
  const uploadRef = useRef<GatewayUpload | undefined>(undefined),
    revision = useRef(0),
    lastSaved = useRef(""),
    initialized = useRef(false);
  const queue = useRef<Promise<number | null>>(Promise.resolve(null)),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = useRef<{ id: string; revision: number; requestId: string } | undefined>(
    undefined,
  );
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const adopt = useCallback((next: GatewayUpload, nextDuplicates: DuplicateResult[] = []) => {
    clearTimeout(timer.current);
    uploadRef.current = next;
    revision.current = next.revision;
    lastSaved.current = JSON.stringify(next.choices);
    initialized.current = next.revision > 0;
    attempt.current = undefined;
    setUpload(next);
    setChoices(next.choices);
    setDuplicates(nextDuplicates);
    setPage(0);
    setSaveLocked(false);
    reviewLocation(next.id);
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }, []);
  const error = useCallback((text: string) => {
    setFailed(true);
    setMessage(text);
  }, []);
  async function reopen(id: string) {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await loadGatewayUpload(id);
      if (result.error) error(result.error);
      else if (result.upload) adopt(result.upload, result.duplicates);
    } catch {
      error("Connection interrupted. Your uploaded review is preserved; reopen it to continue.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = initialUploadId ?? new URLSearchParams(window.location.search).get("upload");
    let active = true;
    if (id)
      void loadGatewayUpload(id)
        .then((result) => {
          if (!active) return;
          if (result.error) error(result.error);
          else if (result.upload) adopt(result.upload, result.duplicates);
        })
        .catch(() => {
          if (active) error("Connection interrupted. Reopen your saved review to continue.");
        });
    return () => {
      active = false;
    };
  }, [initialUploadId, adopt, error]); // Restore only an explicitly selected, server-authorized review.
  const persist = useCallback(
    (next: ReviewChoices): Promise<number | null> => {
      const active = uploadRef.current;
      if (!active) return Promise.resolve(null);
      const serialized = JSON.stringify(next);
      queue.current = queue.current.then(async () => {
        if (active.id !== uploadRef.current?.id) return null;
        if (initialized.current && serialized === lastSaved.current) return revision.current;
        setAutosaving(true);
        try {
          const result = await saveGatewayReview({
            id: active.id,
            revision: revision.current,
            choices: next,
          });
          if (result.error) {
            error(result.error);
            return null;
          }
          if (result.revision === undefined) return null;
          revision.current = result.revision;
          lastSaved.current = serialized;
          initialized.current = true;
          if (active.id === uploadRef.current?.id) setDuplicates(result.duplicates ?? []);
          return result.revision;
        } catch {
          error(
            "Review changes could not be confirmed. Keep this page open and retry saving; no source needs to be parsed again.",
          );
          return null;
        } finally {
          setAutosaving(false);
        }
      });
      return queue.current;
    },
    [error],
  );
  useEffect(() => {
    if (
      !choices ||
      !upload ||
      upload.saved_ids ||
      attempt.current ||
      JSON.stringify(choices) === lastSaved.current
    )
      return;
    timer.current = setTimeout(() => {
      void persist(choices);
    }, 850);
    return () => clearTimeout(timer.current);
  }, [choices, upload, persist]);
  async function choose(file: File) {
    clearTimeout(timer.current);
    await queue.current;
    setBusy(true);
    setFailed(false);
    setMessage("Reading your source and checking its structure…");
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await uploadGatewaySource(form);
      if (result.error) error(result.error);
      else if (result.upload) {
        adopt(result.upload, result.duplicates);
        setMessage("Source ready. Confirm the structure and review your records.");
      }
    } catch {
      error(
        "The upload connection was interrupted. Reopen a saved review or upload this same file to recover.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!upload || !choices) return;
    clearTimeout(timer.current);
    setBusy(true);
    setFailed(false);
    setMessage("Saving drafts. Nothing will be published.");
    try {
      if (!attempt.current) {
        const next = await persist(choices);
        if (next === null) return;
        attempt.current = { id: upload.id, revision: next, requestId: crypto.randomUUID() };
        setSaveLocked(true);
      }
      const result = await commitGatewayUpload(attempt.current);
      if (result.error) {
        error(result.error);
        if (result.code !== "DATABASE") {
          attempt.current = undefined;
          setSaveLocked(false);
        }
        return;
      }
      if (result.savedIds) {
        const next = { ...upload, saved_ids: result.savedIds };
        uploadRef.current = next;
        setUpload(next);
        setMessage(
          `${result.savedIds.length} draft records saved. Review and approve them before adding them to a Learning Path.`,
        );
        router.refresh();
      }
    } catch {
      error(
        "Connection interrupted. The save may already have completed. Retry Save with this same request, or reopen this review to confirm the result.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (!upload) return;
    clearTimeout(timer.current);
    await queue.current;
    setBusy(true);
    try {
      const result = await discardGatewayUpload(upload.id);
      if (result.error) error(result.error);
      else {
        uploadRef.current = undefined;
        attempt.current = undefined;
        setUpload(undefined);
        setChoices(undefined);
        setMessage("Unused review discarded. Saved knowledge is preserved.");
        setFailed(false);
        setSaveLocked(false);
        reviewLocation();
      }
    } catch {
      error("The review could not be discarded. Reopen it and try again.");
    } finally {
      setBusy(false);
    }
  }
  const rows = upload && choices ? reviewRows(upload.extraction, choices, duplicates) : [];
  const selected = rows.filter((r) => !r.excluded),
    invalid = selected.filter((r) => r.errors.length),
    exact = selected.filter((r) => r.exact.length),
    possible = selected.filter((r) => r.possible.length && !r.confirmed);
  const locked = busy || saveLocked;
  const sheet = upload && choices ? upload.extraction.sheets[choices.sheet] : undefined;
  function edit(key: string, patch: ReviewChoices["edits"][string]) {
    setChoices((current) =>
      current
        ? { ...current, edits: { ...current.edits, [key]: { ...current.edits[key], ...patch } } }
        : current,
    );
  }
  return (
    <section
      className="workspace-card universal-gateway"
      aria-labelledby="universal-title"
      aria-busy={busy}
    >
      <div className="gateway-intro">
        <span className="eyebrow">YOUR KNOWLEDGE, YOUR STRUCTURE</span>
        <h2 id="universal-title">Upload what your company knows.</h2>
        <p>
          Keep your own columns, or bring a Word document. Review it here and save private drafts.
        </p>
      </div>
      <ol className="gateway-steps" aria-label="Knowledge upload progress">
        {["Upload", "Review", "Save"].map((label, i) => (
          <li
            key={label}
            aria-current={(!upload ? 0 : upload.saved_ids ? 2 : 1) === i ? "step" : undefined}
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {!upload && (
        <div className="gateway-upload">
          <label className="form-field">
            Choose a knowledge source
            <input
              type="file"
              accept=".xlsx,.csv,.docx"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void choose(file);
                e.target.value = "";
              }}
            />
          </label>
          <p className="form-help">
            CSV, XLSX or DOCX · 2 MiB per file · save up to 200 records at once · 32 spreadsheet
            columns. Your existing templates remain optional presets below.
          </p>
          <details>
            <summary>Spreadsheet and Word formatting guide</summary>
            <p>
              Spreadsheets: use clear column names. The first non-empty row is suggested as the
              header; select another row or “No header row” in Review. Duplicate and blank column
              names can be corrected without dropping values. Comma, semicolon and tab-separated
              UTF-8 CSV are supported.
            </p>
            <p>
              Word: use Heading 1/2/3 for sections, followed by selectable paragraphs, lists and
              tables. Confirm inferred titles before saving. Accept or reject tracked changes,
              remove fields/embedded objects and save as DOCX. Images, scans, page headers/footers
              and footnotes are not extracted. No OCR or PowerPoint processing is connected.
            </p>
            <p>
              Spreadsheet formulas are not evaluated. Paste their values first. Ordinary hyperlink
              labels are imported as text; remote content is never fetched.
            </p>
          </details>
          {recent.length > 0 && (
            <div className="gateway-resume">
              <h3>Resume a private review</h3>
              {recent.map((r) => (
                <button
                  type="button"
                  className="button button-outline"
                  key={r.id}
                  disabled={busy}
                  onClick={() => void reopen(r.id)}
                >
                  {r.source_name}
                </button>
              ))}
              <p className="form-help">
                Reviews expire after 24 hours. Saving a draft preserves its source and version
                history.
              </p>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className="form-message" data-error={failed} role={failed ? "alert" : "status"}>
          {message}
        </p>
      )}
      {upload && !upload.saved_ids && choices && (
        <>
          <div className="gateway-review-heading">
            <div>
              <h3 ref={reviewHeading} tabIndex={-1}>
                Review {upload.source_name}
              </h3>
              <p role="status">
                {autosaving
                  ? "Saving review changes…"
                  : "Review progress is private and can be reopened."}
              </p>
            </div>
            <button
              type="button"
              disabled={busy || autosaving}
              onClick={() => void reopen(upload.id)}
            >
              Reopen saved review
            </button>
          </div>
          {upload.extraction.warnings.map((w) => (
            <p className="workspace-notice" key={w}>
              {w}
            </p>
          ))}
          <div className="gateway-structure">
            <label className="form-field">
              Worksheet
              <select
                aria-label="Worksheet"
                value={choices.sheet}
                disabled={locked}
                onChange={(e) => {
                  const index = Number(e.target.value),
                    s = upload.extraction.sheets[index];
                  setChoices({
                    ...choices,
                    sheet: index,
                    headerRow: s.rows.find((r) => r.cells.some((v) => v.trim()))?.row ?? 0,
                    labels: [],
                    edits: {},
                    titleColumn: "",
                  });
                  setDuplicates([]);
                  setPage(0);
                }}
              >
                {upload.extraction.sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                    {s.issue ? " — needs correction" : ""}
                  </option>
                ))}
              </select>
            </label>
            {sheet && !sheet.issue && (
              <label className="form-field">
                Header row
                <select
                  aria-label="Header row"
                  disabled={locked || upload.extraction.format === "docx"}
                  value={choices.headerRow}
                  onChange={(e) => {
                    setChoices({
                      ...choices,
                      headerRow: Number(e.target.value),
                      labels: [],
                      edits: {},
                      titleColumn: "",
                    });
                    setDuplicates([]);
                    setPage(0);
                  }}
                >
                  <option value={0}>No header row — keep every row as data</option>
                  {sheet.rows
                    .filter((r) => r.cells.some((v) => v.trim()))
                    .map((r) => (
                      <option key={r.row} value={r.row}>
                        Row {r.row}: {r.cells.slice(0, 3).join(" · ").slice(0, 100)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {sheet?.issue && (
            <p role="alert" className="form-message" data-error="true">
              {sheet.issue.message} {sheet.issue.row && `Row ${sheet.issue.row}.`}{" "}
              {sheet.issue.column && `Column ${sheet.issue.column}.`} Choose another worksheet or
              correct the source.
            </p>
          )}
          {!!rows.length && (
            <>
              <details className="gateway-column-settings">
                <summary>Correct column names or title selection</summary>
                <p>
                  Every column is preserved. Repeated labels remain separate fields; blank headers
                  receive editable names.
                </p>
                <div className="gateway-column-grid">
                  {rows[0].fields.map((f, i) => (
                    <label className="form-field" key={f.id}>
                      Column {i + 1} name
                      <input
                        maxLength={100}
                        disabled={locked}
                        value={f.label}
                        onChange={(e) => {
                          const labels = rows[0].fields.map((c) => c.label);
                          labels[i] = e.target.value;
                          setChoices({ ...choices, labels });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label className="form-field">
                  Record title from
                  <select
                    aria-label="Record title from"
                    disabled={locked}
                    value={choices.titleColumn}
                    onChange={(e) => setChoices({ ...choices, titleColumn: e.target.value })}
                  >
                    <option value="">Suggest automatically</option>
                    {rows[0].fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label} ({f.id})
                      </option>
                    ))}
                  </select>
                </label>
              </details>
              <div className="gateway-totals" aria-label="Review totals">
                <span>
                  <strong>{rows.length}</strong> extracted
                </span>
                <span>
                  <strong>{selected.length}</strong> selected
                </span>
                <span>
                  <strong>{invalid.length}</strong> invalid
                </span>
                <span>
                  <strong>{exact.length}</strong> exact duplicates
                </span>
                <span>
                  <strong>{possible.length}</strong> possible duplicates to review
                </span>
              </div>
              <div className="gateway-tools">
                <button
                  type="button"
                  disabled={locked || !exact.length}
                  onClick={() => {
                    const edits = { ...choices.edits };
                    for (const row of rows)
                      if (row.exact.length) edits[row.key] = { ...edits[row.key], excluded: true };
                    setChoices({ ...choices, edits });
                  }}
                >
                  Skip all exact duplicates
                </button>
                <button
                  type="button"
                  disabled={locked || !rows.some((r) => r.excluded)}
                  onClick={() => {
                    const edits = { ...choices.edits };
                    for (const key of Object.keys(edits))
                      edits[key] = { ...edits[key], excluded: false };
                    setChoices({ ...choices, edits });
                  }}
                >
                  Reinstate excluded rows
                </button>
              </div>
              <div className="gateway-review-cards" aria-label="Knowledge review records">
                {rows.slice(page * 10, (page + 1) * 10).map((row) => (
                  <article className="gateway-row" key={row.key} data-excluded={row.excluded}>
                    <div className="gateway-row-top">
                      <strong>
                        {upload.extraction.format === "docx" ? "Section" : "Source row"} {row.row}
                      </strong>
                      <label className="gateway-check">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={row.excluded}
                          aria-label={`Exclude row ${row.row}`}
                          onChange={(e) => edit(row.key, { excluded: e.target.checked })}
                        />
                        Skip this row
                      </label>
                    </div>
                    <label className="form-field">
                      Record title
                      <input
                        aria-label={`Row ${row.row} title`}
                        disabled={locked}
                        maxLength={160}
                        value={row.title}
                        onChange={(e) => edit(row.key, { title: e.target.value, confirmed: false })}
                      />
                    </label>
                    {row.errors.length > 0 && (
                      <ul className="gateway-issues" aria-label={`Row ${row.row} issues`}>
                        {row.errors.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                    {row.exact.length > 0 && (
                      <p className="gateway-issues">
                        Exact duplicate: the same labels and values already exist. Skip this row;
                        existing knowledge is preserved.
                      </p>
                    )}
                    {row.possible.length > 0 && (
                      <div className="gateway-possible">
                        <details>
                          <summary>
                            Inspect {row.possible.length} possible duplicate
                            {row.possible.length > 1 ? "s" : ""}
                          </summary>
                          <p>
                            Title similarity only, not AI or semantic verification. Different facts
                            may share a title.
                          </p>
                          {row.possible.map((match) => (
                            <blockquote key={match.id}>
                              <strong>{match.title}</strong>
                              <p>{match.excerpt}</p>
                            </blockquote>
                          ))}
                        </details>
                        <label className="gateway-check">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={row.confirmed}
                            aria-label={`Keep row ${row.row} as a separate record`}
                            onChange={(e) => edit(row.key, { confirmed: e.target.checked })}
                          />
                          I reviewed the matches. Keep this as a separate record.
                        </label>
                      </div>
                    )}
                    <details>
                      <summary>Edit values and view source</summary>
                      <p className="form-help">
                        {row.source.worksheet} · source row {row.source.row} · header{" "}
                        {row.source.headerRow || "none"}. Corrections keep the original source
                        snapshot.
                      </p>
                      {row.fields.map((f) => (
                        <label className="form-field" key={f.id}>
                          {f.label}
                          <textarea
                            aria-label={`Row ${row.row} ${f.label} (${f.id})`}
                            rows={Math.min(5, Math.max(2, f.value.split("\n").length))}
                            maxLength={12000}
                            disabled={locked}
                            value={f.value}
                            onChange={(e) =>
                              edit(row.key, {
                                values: {
                                  ...choices.edits[row.key]?.values,
                                  [f.id]: e.target.value,
                                },
                                confirmed: false,
                              })
                            }
                          />
                        </label>
                      ))}
                    </details>
                  </article>
                ))}
              </div>
              {rows.length > 10 && (
                <nav className="gateway-pagination" aria-label="Review pages">
                  <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous rows
                  </button>
                  <span>
                    Rows {page * 10 + 1}–{Math.min((page + 1) * 10, rows.length)} of {rows.length}
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * 10 >= rows.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next rows
                  </button>
                </nav>
              )}
            </>
          )}
          {!sheet?.issue && !rows.length && (
            <p className="workspace-notice">
              No data follows this header. Choose another header row, “No header row”, or another
              worksheet.
            </p>
          )}
          <div className="gateway-verification">
            <label className="gateway-check">
              <input
                type="checkbox"
                checked={false}
                readOnly
                disabled
                aria-describedby="verification-help"
              />
              Public information verification
            </label>
            <p className="form-help" id="verification-help">
              Unavailable and off. No external verification integration is configured; your company
              knowledge is not transmitted to a public service.
            </p>
          </div>
          <div className="gateway-save">
            <div>
              <strong>Save private drafts</strong>
              <p>
                Approval is a separate action. All approved field values can be included in a
                Learning Path.
              </p>
            </div>
            <button
              type="button"
              className="button button-dark"
              disabled={
                busy ||
                (!saveLocked &&
                  (!selected.length ||
                    selected.length > 200 ||
                    Boolean(invalid.length || exact.length || possible.length)))
              }
              onClick={() => void save()}
            >
              {busy ? "Saving…" : `Save ${selected.length} draft records`}
            </button>
            <button
              type="button"
              disabled={busy || autosaving || saveLocked}
              onClick={() => void discard()}
            >
              Discard review
            </button>
          </div>
        </>
      )}
      {upload?.saved_ids && (
        <div className="gateway-complete">
          <h3 ref={reviewHeading} tabIndex={-1}>
            Your drafts are saved.
          </h3>
          <p>
            Nothing was published automatically. Open a resource, review the content, then approve
            it before adding it to a Learning Path.
          </p>
          <ul>
            {upload.saved_ids.map((id, i) => (
              <li key={id}>
                <Link href={`/app/knowledge/${id}`}>Review saved resource {i + 1}</Link>
              </li>
            ))}
          </ul>
          <Link className="button button-outline" href="/app/learning">
            Open Learning Paths
          </Link>
          <button
            type="button"
            onClick={() => {
              uploadRef.current = undefined;
              attempt.current = undefined;
              setUpload(undefined);
              setChoices(undefined);
              setSaveLocked(false);
              reviewLocation();
              setMessage("");
            }}
          >
            Upload another source
          </button>
        </div>
      )}
    </section>
  );
}
