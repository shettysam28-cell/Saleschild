import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  Layers3,
  Sparkles,
  Users,
  Check,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing-shell";
import { KnowledgeNetwork } from "@/components/knowledge-network";
import { HomeStory } from "@/components/home-story";
import { ProductDemo } from "@/components/product-demo";
export default function Home() {
  return (
    <MarketingShell>
      <main id="main">
        <section className="m-hero">
          <div className="m-container">
            <div className="m-hero-top">
              <span className="m-kicker">
                <span className="m-dot" /> KNOWLEDGE INTELLIGENCE. HUMAN POTENTIAL.
              </span>
              <span className="m-hero-edition">A NEW CHAPTER / SALESCHILD</span>
            </div>
            <div className="m-hero-layout">
              <div className="m-hero-copy">
                <h1>
                  <span className="m-word-mask">
                    <span className="m-hero-word">Knowledge.</span>
                  </span>
                  <span className="m-word-mask">
                    <span className="m-hero-word">
                      In <em>motion.</em>
                    </span>
                  </span>
                </h1>
                <p className="m-tagline">Where Knowledge Grows Into Performance.</p>
                <p className="m-hero-description">
                  What your organization knows is only the beginning. Connect it to learning,
                  confidence, and the next thing your people can do.
                </p>
                <div className="m-actions">
                  <Link href="/demo" className="button button-lime">
                    See what’s possible
                    <ArrowUpRight size={17} />
                  </Link>
                  <Link href="/platform" className="m-text-link">
                    Explore the platform
                    <ArrowRight size={16} />
                  </Link>
                </div>
                <div className="m-hero-disclosure">
                  <span /> A platform in development. An interactive vision you can explore.
                </div>
              </div>
              <div className="m-hero-art">
                <KnowledgeNetwork />
                <div className="m-hero-float">
                  <div>
                    <span className="m-square-icon">
                      <Sparkles size={17} />
                    </span>
                    <span>
                      THE CONNECTION THAT MATTERS<small>Knowledge → Learning → Performance</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </div>
                  <div className="m-hero-float-bottom">
                    <span>BUILT AROUND PEOPLE.</span>
                    <span>SC / 01</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="m-hero-bottom">
              <span>
                THE KNOWLEDGE YOU HAVE.
                <br />
                THE POTENTIAL AHEAD.
              </span>
              <a href="#transformation">
                <ArrowDown size={16} />
                <span>SCROLL TO CONNECT THE DOTS</span>
              </a>
              <span>
                DESIGNED FOR
                <br />
                WHAT COMES NEXT.
              </span>
            </div>
          </div>
        </section>
        <div className="m-connection-strip">
          <span>One shared foundation.</span>
          <span>
            <Layers3 size={16} />
            Know more.
          </span>
          <span>
            <Sparkles size={16} />
            Connect more.
          </span>
          <span>
            <Users size={16} />
            Become more.
          </span>
        </div>
        <HomeStory />
        <section className="m-demo-section" id="platform">
          <div className="m-container">
            <div className="m-section-top">
              <span className="m-kicker">03 / A CLOSER LOOK</span>
              <span className="m-section-aside">TRY THE POSSIBILITY.</span>
            </div>
            <div className="m-section-heading">
              <h2>
                Clarity looks
                <br />
                <em>good on your team.</em>
              </h2>
              <p>
                Ask a sample question. Explore a learning path.
                <br />
                Change the perspective. It’s all here to try.
              </p>
            </div>
            <ProductDemo />
            <div className="m-demo-caption">
              <span>FICTIONAL ORGANIZATION. AUTHORED SAMPLES. NO LIVE AI CALLS.</span>
              <Link href="/demo">
                Open the full demo
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </section>
        <section className="m-principles">
          <div className="m-container">
            <div className="m-section-top">
              <span className="m-kicker">04 / PROGRESS WITH PRINCIPLE</span>
              <span className="m-section-aside">THOUGHTFUL BY DESIGN.</span>
            </div>
            <div className="m-principles-layout">
              <h2>
                Shared knowledge.
                <br />
                <em>Considered boundaries.</em>
              </h2>
              <div>
                <p>
                  Intelligence is useful when people can trust it. We’re building Saleschild around
                  accountable knowledge, organization boundaries, and human judgment.
                </p>
                {[
                  "A source behind the story.",
                  "The right people. The right access.",
                  "Human approval for consequential change.",
                ].map((t) => (
                  <div className="m-principle" key={t}>
                    <ShieldCheck size={17} />
                    {t}
                    <Check size={13} />
                  </div>
                ))}
                <Link className="m-text-link" href="/platform">
                  Explore the foundation
                  <ArrowUpRight size={15} />
                </Link>
              </div>
            </div>
          </div>
        </section>
        <section className="m-closing">
          <div className="m-container">
            <span className="m-kicker">
              <span className="m-dot" />
              THERE’S MORE IN YOUR PEOPLE.
            </span>
            <h2>
              Give that potential
              <br />a place to <em>grow.</em>
            </h2>
            <div className="m-closing-bottom">
              <p>
                Better knowledge. More confident people.
                <br />
                Let’s build the next chapter.
              </p>
              <Link className="button button-lime" href="/contact">
                Let’s talk about your team
                <ArrowUpRight size={18} />
              </Link>
            </div>
            <div className="m-closing-lines" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
