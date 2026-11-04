import Link from "next/link";
import { LearningSourcePicker } from "./learning-source-picker";
import type { loadLearningPath } from "@/lib/knowledge/learning";
export function LearningPathView({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadLearningPath>>>;
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
    </>
  );
}
