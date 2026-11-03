import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check, Compass } from "lucide-react";
import { publicPages, type PublicSlug } from "@/lib/public-pages";
import { MarketingShell } from "@/components/marketing-shell";
import { KnowledgeNetwork } from "@/components/knowledge-network";
import { GrowthVisual } from "@/components/growth-visual";
export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(publicPages).map((slug) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!(slug in publicPages)) return {};
  const p = publicPages[slug as PublicSlug];
  return pageMetadata(p.label, p.description, `/${slug}`);
}
export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in publicPages)) notFound();
  const p = publicPages[slug as PublicSlug];
  return (
    <MarketingShell>
      <main id="main">
        <section className="m-page-hero">
          <div className="m-container m-page-hero-grid">
            <div>
              <span className="m-kicker">
                <span className="m-dot" />
                {p.label}
              </span>
              <h1>
                {p.title}
                <br />
                <em>{p.accent}</em>
              </h1>
              <p>{p.description}</p>
              <div className="m-actions">
                <Link
                  className="button button-lime"
                  href={slug === "pricing" ? "/contact" : "/demo"}
                >
                  {slug === "pricing" ? "Talk about your team" : "Explore the sample"}
                  <ArrowUpRight size={16} />
                </Link>
                <Link className="m-text-link" href="/contact">
                  Let’s connect
                  <ArrowUpRight size={15} />
                </Link>
              </div>
              <span className="m-page-label">{p.status}</span>
            </div>
            {slug === "pricing" ? (
              <div className="m-price-card">
                <span>A PRODUCT IN DEVELOPMENT</span>
                <h2>
                  Your needs.
                  <br />A useful conversation.
                </h2>
                <p>
                  No announced plans. No card details. No invented price. Explore what a considered
                  knowledge foundation could mean for your organization.
                </p>
                <div className="m-price-list">
                  {[
                    "Interactive demonstration",
                    "Clear product availability",
                    "A conversation about your team",
                  ].map((t) => (
                    <div key={t}>
                      <Check size={13} />
                      {t}
                    </div>
                  ))}
                </div>
                <Link className="button button-lime" href="/contact">
                  Start a conversation
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="m-page-art">
                {slug === "about" ? <GrowthVisual /> : <KnowledgeNetwork />}
              </div>
            )}
          </div>
        </section>
        <section className="m-page-content">
          <div className="m-container">
            <div className="m-intro-row">
              <h2>{p.intro}</h2>
              <p>{p.body}</p>
            </div>
            <div className="m-feature-grid">
              {p.features.map(([title, body], i) => (
                <article className="m-feature" key={title}>
                  <span>
                    0{i + 1} / {p.label}
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <div className="m-roadmap" id={"anchor" in p ? p.anchor : undefined}>
              <Compass size={23} />
              <div>
                <h2>The foundation, and what comes next.</h2>
                <p>{p.roadmap}</p>
              </div>
            </div>
            <div className="m-inline-cta">
              <p>A clearer next chapter starts with a conversation.</p>
              <Link className="button button-dark" href="/contact">
                Let’s talk
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
