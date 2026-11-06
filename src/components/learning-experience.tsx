"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { presentLesson } from "@/lib/learning/lesson";
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
        setMessage(
          "Learning path published. Members can open this edition and its revision guide.",
        );
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
      <h2 id="publish-learning-heading">Publish learning path</h2>
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
          {busy ? "Opening path draft…" : "Edit path draft"}
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
                ? "Publish next edition"
                : "Publish learning path"}
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
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const unit = units[active],
    current = progress.find((p) => p.unit_id === unit?.id);
  const lesson = unit ? presentLesson(unit) : null;
  const summary = summarizeProgress(
    units.map((u) => u.id),
    progress,
  );
  function select(index: number) {
    setActive(index);
    setStep(progress.find((p) => p.unit_id === units[index].id)?.resume_step ?? 0);
    setAnswer("");
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
            ? "Knowledge check passed. Lesson completion is recorded; this is not a mastery score."
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
        {preview ? "Owner lesson preview" : "Your learning path"}
      </h2>
      <p>
        Follow the modules, read each lesson and check your understanding. Lessons use approved
        company knowledge; missing facts are never invented.
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
          <nav aria-label="Modules and lessons" className="lesson-outline">
            {[...new Set(units.map((item) => presentLesson(item).module))].map(
              (module, moduleIndex) => (
                <section className="lesson-module" key={module}>
                  <h3>
                    Module {moduleIndex + 1}: {module}
                  </h3>
                  <ol>
                    {units.map((item, index) =>
                      presentLesson(item).module === module ? (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="button button-outline"
                            disabled={busy}
                            aria-current={active === index ? "step" : undefined}
                            onClick={() => select(index)}
                          >
                            {index + 1}. {presentLesson(item).title}
                            {progress.some(
                              (p) => p.unit_id === item.id && p.completed_at && p.checkpoint_passed,
                            )
                              ? " · Completed"
                              : ""}
                          </button>
                        </li>
                      ) : null,
                    )}
                  </ol>
                </section>
              ),
            )}
          </nav>
          <article aria-labelledby={`${formId}-unit`}>
            <p className="record-badge" style={{ overflowWrap: "anywhere" }}>
              Module: {lesson?.module}
            </p>
            <h3 id={`${formId}-unit`} style={{ overflowWrap: "anywhere" }}>
              {lesson?.title}
            </h3>
            <p>
              <strong>Learning objective:</strong> {lesson?.objective}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 16 }}>
              <button
                type="button"
                className="button button-outline"
                aria-pressed={step === 0}
                disabled={busy}
                onClick={() => setStep(0)}
              >
                Read lesson
              </button>
              <button
                type="button"
                className="button button-outline"
                aria-pressed={step === 1}
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Knowledge check
              </button>
            </div>
            {step === 0 ? (
              <>
                <h4>
                  Lesson {active + 1}: {lesson?.title}
                </h4>
                {lesson?.sections.map((section) => (
                  <section className="lesson-section" key={section.id}>
                    <h5>{section.heading}</h5>
                    <p className="knowledge-body">{section.text}</p>
                  </section>
                ))}
                {unit.scenario && (
                  <details className="workspace-card">
                    <summary>Practice scenario</summary>
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
                  Continue to knowledge check
                </button>
              </>
            ) : (
              <>
                <h4>Knowledge check</h4>
                {unit.checkpoint.mode === "select" ? (
                  <fieldset disabled={busy || !!current?.completed_at} style={{ minWidth: 0 }}>
                    <legend>
                      According to “{unit.title}”, which value is documented for “
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
                      Every choice is an actual value from this source. Reopen Read lesson to check
                      its field labels.
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
                    {busy ? "Checking source evidence…" : "Complete knowledge check"}
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
                    Start lesson
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
                    Next lesson
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
