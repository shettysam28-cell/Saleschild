"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildCurriculum,
  resumeUnitIndex,
  summarizeProgress,
  type ApprovedLearningSource,
  type LearningProgress,
} from "@/lib/learning/curriculum";
import {
  recordLearningProgress,
  publishLearningRevision,
  beginLearningRevision,
} from "@/app/app/learning/progress-actions";

export function LearningPublisher({
  courseId,
  lessonIds,
  available,
  published,
  draft,
}: {
  courseId: string;
  lessonIds: string[];
  available: boolean;
  published: boolean;
  draft: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  async function publish() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await publishLearningRevision({ courseId, lessonIds });
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
      } else {
        setMessage("Published learning revision saved. Members can open this approved version.");
        setReviewed(false);
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage(
        "The publication response was interrupted. Reload to verify the current revision before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await beginLearningRevision({ courseId });
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
      } else {
        setMessage(
          "Draft composition reopened. Add approved sources and review the next revision; members continue using the published snapshot.",
        );
        setReviewed(false);
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage("The response was interrupted. Reload to check the draft before retrying.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="workspace-card learning-publisher"
      aria-labelledby="publish-learning-heading"
    >
      <h2 id="publish-learning-heading">Publish reviewed learning</h2>
      <p>
        Publication freezes the ordered source units as a learning revision. Existing member history
        remains attached to the version they studied.
      </p>
      {!available && <p>Learning publication is waiting for the reviewed database migration.</p>}
      {published && !draft ? (
        <button
          type="button"
          className="button button-dark"
          disabled={busy || !available}
          onClick={() => void prepare()}
        >
          {busy ? "Preparing draft revision…" : "Prepare next revision"}
        </button>
      ) : (
        <>
          <label className="gateway-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy || !available || !lessonIds.length}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I have reviewed the source coverage and the learning preview.
          </label>
          <button
            type="button"
            className="button button-dark"
            disabled={busy || !reviewed || !available || !lessonIds.length}
            onClick={() => void publish()}
          >
            {busy
              ? "Publishing reviewed learning…"
              : published
                ? "Publish reviewed revision"
                : "Publish learning revision"}
          </button>
        </>
      )}
      {message && (
        <p className="form-message" role={failed ? "alert" : "status"} data-error={failed}>
          {message}
        </p>
      )}
    </section>
  );
}

export function LearningExperience({
  sources,
  initialProgress = [],
  revisionId,
  courseId,
  preview = false,
}: {
  sources: ApprovedLearningSource[];
  initialProgress?: LearningProgress[];
  revisionId?: string;
  courseId: string;
  preview?: boolean;
}) {
  const router = useRouter(),
    formId = useId();
  const curriculum = buildCurriculum(sources),
    units = curriculum.units;
  const initialIndex = resumeUnitIndex(
    units.map((unit) => unit.id),
    initialProgress,
  );
  const [active, setActive] = useState(initialIndex),
    [progress, setProgress] = useState(initialProgress),
    [step, setStep] = useState(
      initialProgress.find((p) => p.unit_id === units[initialIndex]?.id)?.resume_step ?? 0,
    ),
    [answer, setAnswer] = useState(""),
    [detailIndex, setDetailIndex] = useState(0),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const unit = units[active],
    current = progress.find((p) => p.unit_id === unit?.id);
  const detail = unit?.facts[detailIndex] ?? unit?.facts[0];
  const summary = summarizeProgress(
    units.map((u) => u.id),
    progress,
  );
  function select(index: number) {
    setActive(index);
    setStep(progress.find((p) => p.unit_id === units[index].id)?.resume_step ?? 0);
    setAnswer("");
    setDetailIndex(0);
    setConfirmed(false);
    setMessage("");
  }
  async function record(action: "start" | "resume" | "complete") {
    if (preview || !unit || !revisionId) return;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await recordLearningProgress({
        courseId,
        revisionId,
        unitId: unit.id,
        action,
        step,
        ...(action === "complete"
          ? {
              evidence:
                unit.checkpoint.mode === "select"
                  ? answer
                  : confirmed
                    ? unit.checkpoint.expected
                    : "",
            }
          : {}),
      });
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
      } else {
        if (result.progress)
          setProgress((rows) => [
            ...rows.filter((row) => row.unit_id !== unit.id),
            result.progress!,
          ]);
        setMessage(
          action === "complete"
            ? "Source checkpoint passed. Engagement is recorded; this is not a mastery score."
            : "Your place is saved. Reopen this path to continue.",
        );
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage("The response was interrupted. Reload to verify saved progress before retrying.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="workspace-card learning-experience"
      aria-labelledby="learning-intelligence-heading"
    >
      <h2 id="learning-intelligence-heading">
        {preview ? "Owner Spectator preview" : "Your learning workspace"}
      </h2>
      <p>
        Deterministic, source-led learning. Each detail below comes from an approved source
        snapshot; no AI generation is connected.
      </p>
      {preview ? (
        <p className="form-help">
          Preview only. Exploring this view never records member progress.
        </p>
      ) : (
        <>
          <p role="status">
            {summary.completed} of {summary.total} eligible units completed · {summary.remaining}{" "}
            remaining · {summary.percentage}%
          </p>
          <progress
            value={summary.completed}
            max={Math.max(1, summary.total)}
            aria-label="Learning consumption progress"
            style={{ width: "100%", accentColor: "var(--forest, #1c513c)" }}
          />
        </>
      )}
      <p className="form-help">
        {curriculum.sourceCount} approved source versions · {curriculum.groups.length} source
        groups.
      </p>
      {curriculum.omitted > 0 && (
        <p>
          {curriculum.omitted} lesson(s) without an approved source reference are excluded from this
          experience.
        </p>
      )}
      {!unit ? (
        <p>Add approved knowledge to this path to preview source-led learning.</p>
      ) : (
        <>
          <nav aria-label="Learning units">
            <ol
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                paddingLeft: 24,
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {units.map((item, index) => (
                <li key={item.id} style={{ minWidth: 0, maxWidth: "100%" }}>
                  <button
                    type="button"
                    className="button button-outline"
                    style={{
                      maxWidth: "100%",
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      paddingBlock: 8,
                      textAlign: "left",
                    }}
                    disabled={busy}
                    aria-current={active === index ? "step" : undefined}
                    onClick={() => select(index)}
                  >
                    {index + 1}. {item.title}
                    {progress.some(
                      (p) => p.unit_id === item.id && p.completed_at && p.checkpoint_passed,
                    )
                      ? " · Completed"
                      : ""}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <article aria-labelledby={`${formId}-unit`}>
            <p className="record-badge" style={{ overflowWrap: "anywhere" }}>
              {unit.group}
            </p>
            <h3 id={`${formId}-unit`} style={{ overflowWrap: "anywhere" }}>
              {unit.title}
            </h3>
            {unit.objective ? (
              <p>
                <strong>Source learning objective:</strong> {unit.objective}
              </p>
            ) : (
              <p>Explore the approved source and confirm one documented detail.</p>
            )}
            <p className="form-help">
              Approved source version {unit.source_version}. This snapshot remains available when
              its original source is revised.{" "}
              <Link
                href={`/app/sources/${unit.source_knowledge_id}?version=${unit.source_version}`}
              >
                Open approved source version
              </Link>
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 16 }}>
              <button
                type="button"
                className="button button-outline"
                aria-pressed={step === 0}
                disabled={busy}
                onClick={() => setStep(0)}
              >
                Explore source
              </button>
              <button
                type="button"
                className="button button-outline"
                aria-pressed={step === 1}
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Source checkpoint
              </button>
            </div>
            {step === 0 ? (
              <>
                <h4>Explore documented details</h4>
                {detail ? (
                  <>
                    <article className="workspace-card" aria-labelledby={`${formId}-detail`}>
                      <p className="form-help">
                        Detail {detailIndex + 1} of {unit.facts.length} · exact approved source text
                      </p>
                      <h5 id={`${formId}-detail`} style={{ overflowWrap: "anywhere" }}>
                        {detail.label}
                      </h5>
                      <p className="knowledge-body">{detail.value}</p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 12 }}>
                        <button
                          type="button"
                          className="button button-outline"
                          disabled={detailIndex === 0 || busy}
                          onClick={() => setDetailIndex((index) => index - 1)}
                        >
                          Previous detail
                        </button>
                        <button
                          type="button"
                          className="button button-outline"
                          disabled={detailIndex + 1 >= unit.facts.length || busy}
                          onClick={() => setDetailIndex((index) => index + 1)}
                        >
                          Next detail
                        </button>
                      </div>
                    </article>
                    <details style={{ marginBlock: 16 }}>
                      <summary>Inspect all documented fields</summary>
                      <dl className="gateway-field-list">
                        {unit.facts.map((fact) => (
                          <div key={fact.id}>
                            <dt>{fact.label}</dt>
                            <dd>{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </>
                ) : (
                  <p className="knowledge-body">{unit.body}</p>
                )}
                {unit.scenario && (
                  <details className="workspace-card">
                    <summary>Explore the source scenario</summary>
                    <p className="knowledge-body">{unit.scenario.situation}</p>
                    <details>
                      <summary>Read the explicitly documented response</summary>
                      <p className="knowledge-body">{unit.scenario.response}</p>
                    </details>
                    <p className="form-help">
                      Both the scenario and response were supplied by the approved source. No
                      missing scenario or response is generated.
                    </p>
                  </details>
                )}
                <button
                  type="button"
                  className="button button-dark"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  Continue to source checkpoint
                </button>
              </>
            ) : (
              <>
                <h4>Source checkpoint — confirms engagement, not mastery</h4>
                {unit.checkpoint.mode === "select" ? (
                  <fieldset disabled={busy || !!current?.completed_at} style={{ minWidth: 0 }}>
                    <legend>
                      According to “{unit.title}”, what is the first documented value under “
                      {unit.checkpoint.label}”?
                    </legend>
                    {unit.checkpoint.choices.map((choice, index) => (
                      <label
                        className="gateway-check"
                        key={choice}
                        style={{ display: "flex", marginBlock: 12, overflowWrap: "anywhere" }}
                      >
                        <input
                          type="radio"
                          name={`${formId}-checkpoint`}
                          value={choice}
                          id={`${formId}-choice-${index}`}
                          checked={answer === choice}
                          onChange={() => setAnswer(choice)}
                        />
                        {choice}
                      </label>
                    ))}
                    <p className="form-help">
                      Every choice is an actual value from this source. Reopen Explore source to
                      check its field labels.
                    </p>
                  </fieldset>
                ) : (
                  <>
                    <p>Read the exact source excerpt below, then confirm that you reviewed it.</p>
                    <blockquote className="knowledge-body" style={{ overflowWrap: "anywhere" }}>
                      {unit.checkpoint.expected}
                    </blockquote>
                    <label className="gateway-check">
                      <input
                        type="checkbox"
                        disabled={busy || !!current?.completed_at}
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      I have read this approved source excerpt.
                    </label>
                  </>
                )}
                {preview ? (
                  <p className="form-help">
                    The member checkpoint is shown for review. Answers and progress are not
                    submitted from this preview.
                  </p>
                ) : current?.completed_at && current.checkpoint_passed ? (
                  <p role="status">This source checkpoint is complete.</p>
                ) : (
                  <button
                    type="button"
                    className="button button-dark"
                    disabled={busy || (unit.checkpoint.mode === "select" ? !answer : !confirmed)}
                    onClick={() => void record("complete")}
                  >
                    {busy ? "Checking source evidence…" : "Complete source checkpoint"}
                  </button>
                )}
              </>
            )}
            <details style={{ marginBlock: 20 }}>
              <summary>Approved snapshot and source reference</summary>
              <p>
                Knowledge record {unit.source_knowledge_id} · version {unit.source_version}
              </p>
              <p className="knowledge-body">{unit.body}</p>
            </details>
            {!preview && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 16 }}>
                {!current?.started_at && (
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => void record("start")}
                  >
                    Start unit
                  </button>
                )}
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={() => void record("resume")}
                >
                  Save my place
                </button>
                {active + 1 < units.length && (
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => select(active + 1)}
                  >
                    Explore next unit
                  </button>
                )}
              </div>
            )}
          </article>
        </>
      )}
      {message && (
        <p className="form-message" role={failed ? "alert" : "status"} data-error={failed}>
          {message}
        </p>
      )}
    </section>
  );
}
