import { pageMetadata } from "@/lib/seo";
import { MarketingShell } from "@/components/marketing-shell";
import { ContactForm } from "@/components/contact-form";
export const metadata = pageMetadata(
  "Contact",
  "Talk with Saleschild about your organization’s knowledge, learning and growth.",
  "/contact",
);
export default function Contact() {
  return (
    <MarketingShell>
      <main id="main">
        <section className="m-page-hero">
          <div className="m-container">
            <span className="m-kicker">
              <span className="m-dot" />
              LET’S CONNECT
            </span>
            <h1>
              Tell us what’s next.
              <br />
              <em>We’re listening.</em>
            </h1>
            <p>
              Big ambitions, small questions, or a clearer starting point.
              <br />
              We’d like to hear what your team needs.
            </p>
          </div>
        </section>
        <section className="m-page-content">
          <div className="m-container m-contact-layout">
            <div>
              <h2>
                A useful conversation
                <br />
                starts here.
              </h2>
              <p>
                Tell us about your organization, your knowledge challenges, and the possibilities
                you see. There’s no subscription or payment commitment.
              </p>
              <div className="m-contact-notice">
                Please don’t include passwords, confidential documents or sensitive personal
                information. This form is for product and privacy inquiries.
              </div>
            </div>
            <ContactForm enabled={process.env.CONTACT_FORM_ENABLED === "true"} />
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
