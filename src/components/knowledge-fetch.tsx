"use client";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { fetchKnowledge, type FetchResult } from "@/app/app/fetch-actions";

export function KnowledgeFetch({ suggestions = [] }: { suggestions?: string[] }) {
  const suggestedSearches = [...new Set(suggestions)].slice(0, 3);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FetchResult>();
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <section className="workspace-card knowledge-fetch" aria-labelledby={id}>
      <div className="workspace-section-heading">
        <div>
          <div className="eyebrow">FIND WHAT YOUR TEAM KNOWS</div>
          <h2 id={id}>Fetch</h2>
        </div>
        <Search size={21} aria-hidden="true" />
      </div>
      <p>
        Search approved company knowledge and follow the source. Deterministic search; no AI answer
        is generated.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          start(async () => {
            try {
              setResult(await fetchKnowledge(query));
            } catch {
              setResult({
                error: true,
                message:
                  "The connection was interrupted. Your question was not saved; please try again.",
              });
            }
          });
        }}
      >
        <label className="form-field">
          What would you like to find?
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={200}
            required
            placeholder="Search a topic, process or question…"
          />
        </label>
        <button className="button button-dark" disabled={pending}>
          {pending ? "Finding sources…" : "Fetch knowledge"}
        </button>
      </form>
      {suggestedSearches.length > 0 && (
        <div className="fetch-suggestions" aria-label="Suggested searches">
          {suggestedSearches.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => {
                setQuery(suggestion.slice(0, 200));
                input.current?.focus();
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {result && (
        <div className="fetch-results" aria-busy={pending}>
          <p role={result.error ? "alert" : "status"}>{result.message}</p>
          {result.results?.map((source) => (
            <article key={source.id} className="fetch-source">
              <h3>
                <Link href={`/app/sources/${source.id}?version=${source.version}`}>
                  {source.title}
                </Link>
              </h3>
              <p className="knowledge-body">{source.excerpt}</p>
              <Link
                className="text-link"
                href={`/app/sources/${source.id}?version=${source.version}`}
              >
                Open approved source · version {source.version}
              </Link>
            </article>
          ))}
        </div>
      )}
      <small>Searches stay in this page’s memory and are not saved as conversation history.</small>
    </section>
  );
}
