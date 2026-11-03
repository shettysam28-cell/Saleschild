"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  FileText,
  GraduationCap,
  Layers3,
  ShieldCheck,
  Workflow,
  ChartNoAxesCombined,
} from "lucide-react";
const stages = [
  {
    label: "Scattered information",
    title: "The answer exists. Somewhere.",
    body: "Documents, playbooks, expertise. Useful on their own. Harder to put to work when they live apart.",
  },
  {
    label: "Connected knowledge",
    title: "Connect the dots. Keep the context.",
    body: "Bring related knowledge together, with the source and the people behind it still in view.",
  },
  {
    label: "Structured records",
    title: "Give good knowledge a foundation.",
    body: "A stable record. A source. A version. A clear distinction between a working draft and shared knowledge.",
  },
  {
    label: "Purposeful learning",
    title: "Turn understanding into ability.",
    body: "The next step is learning connected to real work. Lessons and assessments are part of the product roadmap.",
  },
  {
    label: "Performance intelligence",
    title: "See what the next step could be.",
    body: "Our vision: connect knowledge, learning and capability. Advanced performance intelligence is planned, not live.",
  },
];
const journey = [
  {
    name: "Knowledge Gateway",
    status: "FOUNDATION",
    icon: BookOpen,
    text: "A home for trusted knowledge.",
    description:
      "Organization-scoped resources, source references and version history. Start with a useful record.",
    href: "/knowledge-gateway",
  },
  {
    name: "AI Learning",
    status: "PREVIEW / ROADMAP",
    icon: GraduationCap,
    text: "From knowing to doing.",
    description:
      "Draft learning paths today. Source-grounded lessons, AI assistance and practice are the next chapter.",
    href: "/ai-learning",
  },
  {
    name: "Assessments",
    status: "ROADMAP",
    icon: CheckCheck,
    text: "Understanding, made visible.",
    description:
      "A foundation for immutable assessment versions. Delivery, question banks and grading are planned.",
    href: "/ai-learning#assessments",
  },
  {
    name: "Intelligence",
    status: "FOUNDATION + ROADMAP",
    icon: ChartNoAxesCombined,
    text: "A more considered view.",
    description:
      "Workspace counts and governance activity. Learning effectiveness and performance analytics are planned.",
    href: "/intelligence",
  },
  {
    name: "Automation",
    status: "DRAFT REQUESTS",
    icon: Workflow,
    text: "Human judgment stays central.",
    description:
      "Prepare manual or assisted workflow requests. Model processing and autonomous execution are not enabled.",
    href: "/platform#automation",
  },
];
export function HomeStory() {
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [chapter, setChapter] = useState(0);
  const storyTrigger = useRef<{ start: number; end: number } | null>(null);
  const journeyTrigger = useRef<{ start: number; end: number } | null>(null);
  const [cinematic, setCinematic] = useState(false);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let cleanup: (() => void) | undefined;
    const media = matchMedia(
      "(min-width: 1000px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    const setup = async () => {
      const currentGeneration = ++generation;
      cleanup?.();
      cleanup = undefined;
      storyTrigger.current = null;
      journeyTrigger.current = null;
      if (!media.matches || disposed) {
        setCinematic(false);
        return;
      }
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed || !media.matches || currentGeneration !== generation) return;
      gsap.registerPlugin(ScrollTrigger);
      setCinematic(true);
      const element = root.current;
      if (!element) return;
      const context = gsap.context(() => {
        const hero = document.querySelector(".m-hero");
        if (hero) {
          gsap.fromTo(
            document.querySelectorAll(".m-hero-word"),
            { yPercent: 0 },
            {
              yPercent: -32,
              stagger: 0.06,
              ease: "none",
              scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 1 },
            },
          );
          gsap.to(document.querySelector(".m-network"), {
            y: 100,
            rotate: 8,
            scale: 0.88,
            ease: "none",
            scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 1 },
          });
        }
        const story = element.querySelector(".m-transform");
        if (story) {
          const t = gsap.timeline({
            scrollTrigger: {
              id: "saleschild-transformation",
              trigger: story,
              start: "top top+=79",
              end: "+=2400",
              pin: true,
              scrub: 0.6,
              invalidateOnRefresh: true,
              onUpdate: (self) => setStage(Math.min(4, Math.floor(self.progress * 5))),
            },
          });
          storyTrigger.current = t.scrollTrigger!;
          t.to(
            ".m-fragment",
            {
              x: (i: number) => [65, -100, 45, -65, 10][i],
              y: (i: number) => [70, 25, -45, -80, 15][i],
              rotation: 0,
              stagger: 0.05,
              duration: 1,
              ease: "none",
            },
            0,
          )
            .fromTo(".m-transform-lines", { opacity: 0.1 }, { opacity: 1, duration: 1 }, 0)
            .to(".m-fragment", { opacity: 0.1, scale: 0.8, duration: 0.6 }, 1.4)
            .fromTo(
              ".m-interface",
              { scale: 0.65, opacity: 0 },
              { scale: 1, opacity: 1, duration: 0.8, ease: "none" },
              1.4,
            )
            .to(".m-interface", { y: -8, duration: 1.5, ease: "none" }, 2.3);
        }
        const section = element.querySelector<HTMLElement>(".m-journey");
        const track = element.querySelector<HTMLElement>(".m-journey-track");
        const viewport = element.querySelector<HTMLElement>(".m-journey-window");
        if (section && track && viewport) {
          const tween = gsap.to(track, {
            x: () => -(track.scrollWidth - viewport.clientWidth),
            ease: "none",
            scrollTrigger: {
              id: "saleschild-journey",
              trigger: section,
              start: "top top+=79",
              end: () => `+=${track.scrollWidth - viewport.clientWidth + 500}`,
              pin: true,
              scrub: 0.7,
              invalidateOnRefresh: true,
              onUpdate: (self) => setChapter(Math.min(4, Math.round(self.progress * 4))),
            },
          });
          journeyTrigger.current = tween.scrollTrigger!;
        }
      }, element);
      cleanup = () => {
        context.revert();
        setCinematic(false);
      };
      ScrollTrigger.refresh();
    };
    void setup();
    const change = () => {
      void setup();
    };
    media.addEventListener("change", change);
    return () => {
      disposed = true;
      media.removeEventListener("change", change);
      cleanup?.();
      storyTrigger.current = null;
      journeyTrigger.current = null;
    };
  }, []);
  function selectStage(i: number) {
    setStage(i);
    const trigger = storyTrigger.current;
    if (trigger && cinematic)
      window.scrollTo({
        top: trigger.start + ((i + 0.35) / 5) * (trigger.end - trigger.start),
        behavior: "instant",
      });
  }
  function selectChapter(i: number) {
    setChapter(i);
    const trigger = journeyTrigger.current;
    if (trigger && cinematic)
      window.scrollTo({
        top: trigger.start + (i / 4) * (trigger.end - trigger.start),
        behavior: "instant",
      });
    else
      root.current?.querySelector(`#journey-${i}`)?.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
  }
  return (
    <div ref={root} data-cinematic={cinematic}>
      <section
        className="m-transform"
        id="transformation"
        data-stage={stage}
        aria-label="From information to performance"
      >
        <div className="m-container">
          <div className="m-section-top">
            <span className="m-kicker">01 / THE TRANSFORMATION</span>
            <span className="m-section-aside">A PRODUCT VISION, IN FIVE CONNECTIONS</span>
          </div>
          <div className="m-transform-layout">
            <div className="m-transform-copy">
              <p className="m-overline">KNOWLEDGE DOESN’T STAND STILL.</p>
              <h2>
                Neither should
                <br />
                <em>your potential.</em>
              </h2>
              <nav className="m-stage-nav" aria-label="Knowledge transformation stages">
                {stages.map((s, i) => (
                  <button
                    key={s.label}
                    aria-current={stage === i ? "step" : undefined}
                    onClick={() => selectStage(i)}
                  >
                    <span>0{i + 1}</span>
                    {s.label}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </nav>
            </div>
            <div
              className="m-transform-visual"
              aria-label={`Illustrative stage ${stage + 1}: ${stages[stage].label}`}
            >
              <div className="m-visual-grid" />
              <svg
                className="m-transform-lines"
                viewBox="0 0 600 440"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m95 90 185 130 205-120M280 220l-150 120m150-120 200 120M95 90l35 250m350 0 5-240"
                  stroke="#58e6e0"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                />
                <circle cx="280" cy="220" r="105" stroke="#c8ff5f" strokeOpacity=".4" />
              </svg>
              {[
                "Product playbook",
                "Customer context",
                "Team expertise",
                "Research notes",
                "Learning guide",
              ].map((name, i) => (
                <div key={name} className={`m-fragment fragment-${i}`}>
                  <FileText size={16} />
                  <span>{name}</span>
                  <span className="m-fragment-dots">···</span>
                </div>
              ))}
              <div className="m-interface">
                <div className="m-interface-bar">
                  <span className="m-tiny-logo">s.</span>
                  <span>NORTHSTAR / FICTIONAL PREVIEW</span>
                  <span className="m-dot" />
                </div>
                {stage < 3 ? (
                  <div className="m-interface-body">
                    <span className="m-small-tag">KNOWLEDGE GATEWAY</span>
                    <h3>
                      One record.
                      <br />A clearer beginning.
                    </h3>
                    <div className="m-record-row">
                      <BookOpen size={17} />
                      <div>
                        <strong>Product foundations</strong>
                        <small>Source reference · Version 02</small>
                      </div>
                      <Check size={14} />
                    </div>
                    <div className="m-interface-rule" />
                    <div className="m-interface-rule short" />
                    <div className="m-record-meta">
                      <span>
                        <ShieldCheck size={11} /> Approved sample
                      </span>
                      <span>Stable record ID</span>
                    </div>
                  </div>
                ) : stage === 3 ? (
                  <div className="m-interface-body">
                    <span className="m-small-tag">LEARNING / PLANNED EXPERIENCE</span>
                    <h3>
                      Put understanding
                      <br />
                      into practice.
                    </h3>
                    <div className="m-lesson">
                      <GraduationCap size={25} />
                      <div>
                        <strong>Product foundations</strong>
                        <small>Lesson → Practice → Knowledge check</small>
                      </div>
                    </div>
                    <div className="m-check-row">
                      <Check size={13} />
                      Explore the essentials
                    </div>
                    <div className="m-check-row">
                      <Check size={13} />
                      Connect it to your work
                    </div>
                    <div className="m-check-row">
                      <span className="m-check-circle" />
                      Try a sample assessment
                    </div>
                  </div>
                ) : (
                  <div className="m-interface-body">
                    <span className="m-small-tag">INTELLIGENCE / ROADMAP</span>
                    <h3>
                      Make the next
                      <br />
                      opportunity visible.
                    </h3>
                    <div
                      className="m-mini-chart"
                      role="img"
                      aria-label="Illustrative capability chart, not real performance data"
                    >
                      {[32, 50, 43, 76, 62, 89, 106, 120].map((h, i) => (
                        <i key={i} style={{ height: h }} />
                      ))}
                    </div>
                    <div className="m-record-meta">
                      <span>ILLUSTRATIVE DATA</span>
                      <span>Knowledge → Capability</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="m-visual-corner">SC / CONNECTED POTENTIAL</div>
            </div>
          </div>
          <div className="m-stage-caption" aria-live="polite">
            <span>0{stage + 1} / 05</span>
            <div>
              <h3>{stages[stage].title}</h3>
              <p>{stages[stage].body}</p>
            </div>
            <span className="m-stage-hint">
              {cinematic ? "SCROLL TO CONNECT" : "SELECT A STAGE TO EXPLORE"}
            </span>
          </div>
        </div>
      </section>
      <section className="m-journey" id="product-journey">
        <div className="m-container">
          <div className="m-section-top">
            <span className="m-kicker">02 / ONE CONNECTED ECOSYSTEM</span>
            <span className="m-section-aside">EVERY PART HAS A PURPOSE.</span>
          </div>
          <div className="m-journey-heading">
            <h2>
              Less fragmentation.
              <br />
              <em>More forward motion.</em>
            </h2>
            <p>
              Explore the foundation we’re building,
              <br />
              and the direction we’re growing.
            </p>
          </div>
          <nav className="m-journey-progress" aria-label="Product journey">
            {journey.map((item, i) => (
              <button
                key={item.name}
                aria-current={chapter === i ? "step" : undefined}
                onClick={() => selectChapter(i)}
              >
                <span>0{i + 1}</span>
                {item.name}
              </button>
            ))}
          </nav>
          <div className="m-journey-window">
            <div className="m-journey-track">
              {journey.map(({ name, status, icon: Icon, text, description, href }, i) => (
                <article className="m-journey-card" id={`journey-${i}`} key={name}>
                  <div className="m-journey-card-top">
                    <Icon size={25} strokeWidth={1.4} />
                    <span>{status}</span>
                  </div>
                  <span className="m-journey-card-index">
                    0{i + 1} / {name}
                  </span>
                  <h3>{text}</h3>
                  <p>{description}</p>
                  <div className={`m-card-art m-card-art-${i}`} aria-hidden="true">
                    {i === 0 ? (
                      <>
                        <i />
                        <i />
                        <i />
                        <span>
                          <Layers3 size={30} />
                        </span>
                      </>
                    ) : i === 1 ? (
                      <>
                        <span>
                          <GraduationCap size={36} />
                        </span>
                        <i />
                        <i />
                        <i />
                      </>
                    ) : i === 2 ? (
                      <>
                        <span>
                          <CheckCheck size={38} />
                        </span>
                        <i />
                        <i />
                        <i />
                      </>
                    ) : i === 3 ? (
                      <>
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                      </>
                    ) : (
                      <>
                        <span>
                          <Workflow size={40} />
                        </span>
                        <i />
                        <i />
                        <i />
                      </>
                    )}
                  </div>
                  <Link href={href} onFocus={() => selectChapter(i)}>
                    Explore {name}
                    <ArrowUpRight size={16} />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
