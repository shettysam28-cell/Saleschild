import type { Metadata } from "next";
import { Brand } from "@/components/brand";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-story">
        <Brand light />
        <div>
          <div className="eyebrow">KNOWLEDGE. LEARNING. HUMAN POTENTIAL.</div>
          <h2>
            A little more
            <br />
            knowledge.
            <br />
            <em>A lot more possible.</em>
          </h2>
          <p>
            A connected home for what your organization knows and everything your people can become.
          </p>
        </div>
        <div className="auth-orbit" aria-hidden="true" />
        <span>Where Knowledge Grows Into Performance.</span>
      </aside>
      <main id="main" className="auth-main">
        <Brand />
        {children}
      </main>
    </div>
  );
}
