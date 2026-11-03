import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MarketingShell } from "@/components/marketing-shell";
import { ProductDemo } from "@/components/product-demo";
import { KnowledgeTransformation } from "@/components/knowledge-transformation";
export const metadata: Metadata = { title: "Explore the platform" };
export default function DemoPage() {
  return (
    <MarketingShell>
      <main id="main" className="demo-page section-shell">
        <div className="eyebrow">A LITTLE EXPLORATION. A LOT OF POSSIBILITY.</div>
        <h1>
          Meet your team’s
          <br />
          <em>next chapter.</em>
        </h1>
        <p>
          Explore knowledge, learning, and progress in this interactive sample.
          <br />
          Everything here is illustrative. No account or customer data is used.
        </p>
        <h2 className="sr-only">Explore the Saleschild platform</h2>
        <ProductDemo standalone />
        <KnowledgeTransformation />
        <div className="demo-page-cta">
          <span>See a place for Saleschild in your organization?</span>
          <Link className="button button-dark" href="/register">
            Start growing <ArrowUpRight size={15} />
          </Link>
        </div>
      </main>
    </MarketingShell>
  );
}
