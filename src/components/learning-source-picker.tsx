"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addApprovedKnowledge } from "@/app/app/learning/knowledge-actions";
export function LearningSourcePicker({
  courseId,
  sources,
}: {
  courseId: string;
  sources: { id: string; title: string; current_version: number }[];
}) {
  const router = useRouter(),
    request = useRef<string | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  function choose(ids: string[]) {
    setSelected(ids);
    request.current = undefined;
    setMessage("");
  }
  async function add() {
    setBusy(true);
    setFailed(false);
    request.current ??= crypto.randomUUID();
    try {
      const result = await addApprovedKnowledge({
        courseId,
        sourceIds: selected,
        requestId: request.current,
      });
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
      } else {
        setUncertain(false);
        setSelected([]);
        request.current = undefined;
        setMessage(
          `${result.added} approved source lessons added. Reopen the path to verify the saved order and content.`,
        );
        router.refresh();
      }
    } catch {
      setFailed(true);
      setUncertain(true);
      setMessage(
        "The response was interrupted. Retry the same selected sources, or reopen the path to confirm saved lessons.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-card learning-source-picker" aria-labelledby="path-sources">
      <h2 id="path-sources">Add approved knowledge</h2>
      <p>
        Choose up to 50 resources in lesson order. Each lesson preserves the approved content and
        source version; no AI generation occurs.
      </p>
      {!sources.length && <p>Publish reviewed knowledge in the Knowledge Gateway first.</p>}
      <div className="learning-source-options">
        {sources.map((s) => (
          <label className="gateway-check" key={s.id}>
            <input
              type="checkbox"
              value={s.id}
              disabled={busy || uncertain || (!selected.includes(s.id) && selected.length >= 50)}
              checked={selected.includes(s.id)}
              onChange={(e) =>
                choose(
                  e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id),
                )
              }
            />
            {s.title} · version {s.current_version}
          </label>
        ))}
      </div>
      <p className="form-help">Showing up to 200 approved organization resources.</p>
      {selected.length > 0 && (
        <ol aria-label="Selected lesson order">
          {selected.map((id, i) => (
            <li key={id}>
              <span>{sources.find((s) => s.id === id)?.title}</span>
              <button
                type="button"
                aria-label={`Move lesson ${i + 1} up`}
                disabled={busy || uncertain || i === 0}
                onClick={() => {
                  const next = [...selected];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  choose(next);
                }}
              >
                Up
              </button>
              <button
                type="button"
                aria-label={`Move lesson ${i + 1} down`}
                disabled={busy || uncertain || i === selected.length - 1}
                onClick={() => {
                  const next = [...selected];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  choose(next);
                }}
              >
                Down
              </button>
            </li>
          ))}
        </ol>
      )}
      {message && (
        <p className="form-message" role={failed ? "alert" : "status"} data-error={failed}>
          {message}
        </p>
      )}
      <button
        type="button"
        className="button button-dark"
        disabled={busy || !selected.length}
        onClick={() => void add()}
      >
        {busy ? "Adding approved lessons…" : `Add ${selected.length} approved resources`}
      </button>
    </section>
  );
}
