"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="status-page">
      <div className="eyebrow">LET’S TRY THAT AGAIN</div>
      <h1>A small pause.</h1>
      <p>We couldn’t load this page. Please try again.</p>
      <button className="button button-dark" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
