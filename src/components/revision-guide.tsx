"use client";
import Link from "next/link";
import { useState } from "react";
import { createRevisionGuide } from "@/app/app/learning/revision-actions";
import { presentLesson } from "@/lib/learning/lesson";
import type { ApprovedLearningSource } from "@/lib/learning/curriculum";

export function RevisionGuideControl({
  courseId,
  revisionId,
}: {
  courseId: string;
  revisionId?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState("");
  return (
    <section className="workspace-card revision-guide-control">
      <h2>Revise what you’ve learned</h2>
      <p>
        Create a saved study guide with key concepts, review cards and links to the approved lesson
        evidence. Creating a guide does not complete lessons or claim assessment mastery.
      </p>
      {!revisionId && <p>Publish a reviewed learning path to make its revision guide available.</p>}
      <button
        className="button button-dark"
        disabled={busy || !revisionId}
        onClick={async () => {
          if (!revisionId) return;
          setBusy(true);
          setError("");
          try {
            const result = await createRevisionGuide({ courseId, revisionId });
            if (result.error) setError(result.error);
            else if (result.url) setUrl(result.url);
          } catch {
            setError(
              "The guide response was interrupted. Open your revision guide to check whether it saved before retrying.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing your guide…" : "Create revision guide"}
      </button>{" "}
      <Link
        className="text-link"
        href={
          url || `/app/learning/${courseId}/revision${revisionId ? `?edition=${revisionId}` : ""}`
        }
      >
        Open revision guide
      </Link>
      {url && (
        <p role="status">Your revision guide is saved. Open it now or return from Progression.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function RevisionGuideView({
  data,
}: {
  data: {
    courseId: string;
    revision: { id: string; title: string; number: number };
    savedAt?: string;
    units: ApprovedLearningSource[];
  };
}) {
  return (
    <>
      <Link className="text-link" href={`/app/learning/${data.courseId}`}>
        Back to learning path
      </Link>
      <div className="app-title-row">
        <div>
          <div className="eyebrow">REVISION GUIDE · EDITION {data.revision.number}</div>
          <h1>{data.revision.title}</h1>
          <p>
            Review key concepts and recall the documented guidance. This guide uses the saved
            published edition, including its original source versions.
          </p>
        </div>
      </div>
      {!data.savedAt ? (
        <RevisionGuideControl courseId={data.courseId} revisionId={data.revision.id} />
      ) : (
        <>
          <p className="workspace-notice">
            Saved {new Date(data.savedAt).toISOString().slice(0, 10)} · {data.units.length} lessons.
            Source-based study material; no AI-generated facts.
          </p>
          {!data.units.length && (
            <p>
              No source-backed lessons are available in this edition. Ask your owner to review the
              path.
            </p>
          )}
          {data.units.map((unit) => {
            const lesson = presentLesson(unit);
            return (
              <section className="workspace-card lesson-guide" key={unit.id}>
                <span className="eyebrow">{lesson.module}</span>
                <h2>{lesson.title}</h2>
                <p>
                  <strong>Learning objective:</strong> {lesson.objective}
                </p>
                <h3>Key concepts</h3>
                {lesson.sections.map((section) => (
                  <p className="knowledge-body" key={section.id}>
                    <strong>{section.heading}:</strong> {section.text}
                  </p>
                ))}
                <h3>Review cards</h3>
                {lesson.sections.slice(0, 4).map((section) => (
                  <details key={section.id}>
                    <summary>
                      Recall: {section.heading} — {lesson.title}
                    </summary>
                    <p className="knowledge-body">{section.text}</p>
                  </details>
                ))}
                <details>
                  <summary>Source citation</summary>
                  <p>Approved knowledge version {unit.source_version}</p>
                  <Link
                    className="text-link"
                    href={`/app/sources/${unit.source_knowledge_id}?version=${unit.source_version}`}
                  >
                    Read the approved evidence
                  </Link>
                </details>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
