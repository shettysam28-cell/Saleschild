import Link from "next/link";
import { LearningSourcePicker } from "./learning-source-picker";
import type { loadLearningPath } from "@/lib/knowledge/learning";
import { LearningExperience, LearningPublisher } from "./learning-experience";
import type { LearningWorkspace } from "@/lib/learning/read-model";
export function LearningPathView({
  data,
  learning,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadLearningPath>>>;
  learning?: LearningWorkspace;
}) {
  return (
    <>
      <Link className="text-link" href="/app/learning">
        All Learning Paths
      </Link>
      <div className="app-title-row">
        <div>
          <h1>{data.course.title}</h1>
          <p>{data.course.description}</p>
          <span className="record-badge">{data.course.status}</span>
        </div>
      </div>
      {data.author && data.course.status === "draft" && (
        <LearningSourcePicker courseId={data.course.id} sources={data.approved} />
      )}
      {learning &&
        (data.author ? (
          <>
            <LearningExperience sources={data.lessons} courseId={data.course.id} preview />
            {learning.revision && (
              <p className="workspace-notice">
                Published revision {learning.revision.number} preserves {learning.units.length}{" "}
                source units. Publishing a reviewed update retains prior member history.
              </p>
            )}
            {learning.canPublish && (
              <LearningPublisher
                courseId={data.course.id}
                lessonIds={data.lessons.map((lesson) => lesson.id)}
                available={learning.available}
                published={!!learning.revision}
                draft={data.course.status === "draft"}
              />
            )}
          </>
        ) : learning.revision ? (
          <LearningExperience
            key={learning.revision.id}
            sources={learning.units}
            initialProgress={learning.progress}
            revisionId={learning.revision.id}
            courseId={data.course.id}
          />
        ) : (
          <section className="workspace-card">
            <h2>Learning experience unavailable</h2>
            <p>
              {learning.available
                ? "An owner must publish a reviewed learning revision before member progress can be recorded."
                : "Member learning is waiting for the reviewed database migration."}
            </p>
          </section>
        ))}
      {(!learning || data.author) && (
        <section className="workspace-card" aria-labelledby="saved-path-lessons">
          <h2 id="saved-path-lessons">Saved lessons</h2>
          {!data.lessons.length && (
            <p>No lessons yet. An author can add approved knowledge to this draft path.</p>
          )}
          <ol className="learning-lessons" aria-label="Learning Path lessons">
            {data.lessons.map((lesson, i) => (
              <li key={lesson.id} id={`lesson-${lesson.id}`}>
                <article>
                  <h3>
                    {i + 1}. {lesson.title}
                  </h3>
                  {lesson.source_knowledge_id && (
                    <p className="form-help">
                      Approved knowledge · source version {lesson.source_version} ·{" "}
                      <Link href={`/app/knowledge/${lesson.source_knowledge_id}`}>
                        Open source resource
                      </Link>
                    </p>
                  )}
                  {lesson.source_fields.length ? (
                    <dl className="gateway-field-list">
                      {lesson.source_fields.map((f) => (
                        <div key={f.id}>
                          <dt>{f.label}</dt>
                          <dd>{f.value || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="knowledge-body">{lesson.body}</p>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
