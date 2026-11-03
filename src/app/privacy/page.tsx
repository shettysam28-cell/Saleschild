import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
export const metadata = { title: "Privacy", robots: { index: false, follow: false } };
export default function PrivacyPage() {
  return (
    <MarketingShell>
      <main id="main" className="legal-page section-shell">
        <div className="eyebrow">YOUR TRUST MATTERS</div>
        <h1>Privacy, thoughtfully.</h1>
        <p className="legal-intro">
          Saleschild is in development. This notice describes the current preview and will be
          updated before general availability.
        </p>
        <h2>Website and demo</h2>
        <p>
          The interactive demo uses fictional, fixed sample content. Demo questions and lesson
          interactions remain in your browser session and are not submitted to a model or stored as
          customer records. No advertising analytics or marketing cookies are installed in this
          preview.
        </p>
        <h2>Accounts and organization data</h2>
        <p>
          When customer access is enabled, account email and authentication information will be
          processed to provide secure access. Organization content will be available according to
          membership and access permissions. Full service terms, data retention, processing regions,
          subprocessors, and deletion procedures must be provided before general availability.
        </p>
        <h2>Contact inquiries</h2>
        <p>
          Contact sending is disabled in the local preview. When the contact form is enabled on the
          hosted website, the name, work email, optional organization and message you submit will be
          processed through Netlify Forms so we can respond. Consent is requested before submission;
          no marketing subscription is created. Operational retention and deletion procedures must
          be finalized before enabling collection.
        </p>
        <h2>Contact</h2>
        <p>
          For privacy questions or to request information about data access and deletion, use the{" "}
          <Link href="/contact">contact form</Link>. The preview clearly indicates when sending is
          unavailable.
        </p>
        <p className="muted">Last updated: November 3, 2026.</p>
      </main>
    </MarketingShell>
  );
}
