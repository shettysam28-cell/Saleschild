"use client";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { fetchKnowledge, type FetchResult } from "@/app/app/fetch-actions";

export function KnowledgeFetch({ suggestions = [] }: { suggestions?: string[] }) {
  const suggestedSearches = [...new Set(suggestions)].slice(0, 3);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FetchResult>();
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <section className="workspace-card knowledge-fetch" aria-labelledby={id} aria-busy={pending}>
      <div className="workspace-section-heading">
        <div>
          <div className="eyebrow">SOURCE-BASED SEARCH</div>
          <h2 id={id}>Fetch</h2>
        </div>
        <Search size={21} aria-hidden="true" />
      </div>
      <p>
        Ask a question or enter a few keywords. Answers are extracted from approved company
        knowledge, with sources you can check.
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
            disabled={pending}
            maxLength={200}
            required
            placeholder="Search a topic, process or question…"
          />
        </label>
        <button className="button button-dark" disabled={pending}>
          {pending ? "Finding your answer…" : "Fetch knowledge"}
        </button>
      </form>
      {suggestedSearches.length > 0 && (
        <div className="fetch-suggestions" aria-label="Suggested searches">
          {suggestedSearches.map((suggestion) => (
            <button
              key={suggestion}
              disabled={pending}
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
          {result.answer?.summary && (
            <>
              <h3>Answer</h3>
              <p className="knowledge-body">
                {result.answer.summary.text}{" "}
                <a
                  href={`#${id}-${result.answer.summary.citation}`}
                  onClick={() => setCitationsOpen(true)}
                  aria-label="Read supporting citation"
                >
                  [1]
                </a>
              </p>
              <h3>Key facts</h3>
              <ul className="answer-facts">
                {result.answer.facts.map((fact, index) => (
                  <li key={fact.citation}>
                    <strong>{fact.label}:</strong> {fact.text}{" "}
                    <a
                      href={`#${id}-${fact.citation}`}
                      onClick={() => setCitationsOpen(true)}
                      aria-label={`Read citation ${index + 1}`}
                    >
                      [{index + 1}]
                    </a>
                  </li>
                ))}
              </ul>
              {!!result.answer.steps.length && (
                <>
                  <h3>Applicable steps</h3>
                  <ol>
                    {result.answer.steps.map((step, index) => (
                      <li key={index}>
                        {step.text}{" "}
                        <a href={`#${id}-${step.citation}`} onClick={() => setCitationsOpen(true)}>
                          Source
                        </a>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {result.answer.notices.map((notice) => (
                <p className="form-help" key={notice}>
                  {notice}
                </p>
              ))}
              <details
                open={citationsOpen}
                onToggle={(e) => setCitationsOpen(e.currentTarget.open)}
                className="answer-citations"
              >
                <summary>Sources and exact evidence ({result.answer.citations.length})</summary>
                {result.answer.citations.map((cite, index) => (
                  <article key={cite.id} id={`${id}-${cite.id}`} className="fetch-source">
                    <h4>
                      {index + 1}. {cite.title}
                    </h4>
                    <p className="form-help">
                      Version {cite.version} · {cite.location}
                    </p>
                    <blockquote className="knowledge-body">{cite.excerpt}</blockquote>
                    <Link
                      className="text-link"
                      href={`/app/sources/${cite.knowledgeId}?version=${cite.version}`}
                    >
                      Open approved source · version {cite.version}
                    </Link>
                  </article>
                ))}
              </details>
            </>
          )}
        </div>
      )}
      <small>Searches stay in this page’s memory and are not saved as conversation history.</small>
    </section>
  );
}
