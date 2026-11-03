"use client";

import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const tabs = [
  { id: "knowledge", label: "Find the answer", icon: Search },
  { id: "learning", label: "Build the capability", icon: GraduationCap },
  { id: "analytics", label: "See the progress", icon: TrendingUp },
] as const;
type Tab = (typeof tabs)[number]["id"];
const answers = {
  onboarding: {
    question: "How does our onboarding work?",
    text: "Start with the essentials. In week one, meet your team and explore the product foundations. Then put your knowledge into practice with a guided customer scenario.",
    source: "Employee onboarding guide",
    section: "Getting started · Sections 1–3",
  },
  product: {
    question: "Where can I learn about the product?",
    text: "Your Product Foundations learning path brings together the product overview, customer use cases, and a short knowledge check. Begin with the overview, then practice explaining the value in your own words.",
    source: "Product foundations playbook",
    section: "Product knowledge · Section 2",
  },
  policy: {
    question: "What is our knowledge review policy?",
    text: "Every published resource has an owner. Review source material before sharing, include a review date, and request a new review when the underlying policy changes. Use the approved version as your reference.",
    source: "Knowledge quality handbook",
    section: "Governance · Sections 2–4",
  },
};

export function ProductDemo({ standalone = false }: { standalone?: boolean }) {
  const [active, setActive] = useState<Tab>("knowledge");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<keyof typeof answers>("onboarding");
  const [searched, setSearched] = useState(false);
  const [lesson, setLesson] = useState(0);
  const [period, setPeriod] = useState("This month");
  const [sourceOpen, setSourceOpen] = useState(false);
  function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = query.toLowerCase();
    setAnswer(
      /policy|review|govern/.test(q)
        ? "policy"
        : /product|learn/.test(q)
          ? "product"
          : "onboarding",
    );
    setSearched(true);
    setSourceOpen(false);
  }

  return (
    <div className={`product-demo ${standalone ? "demo-standalone" : ""}`}>
      <div className="demo-tabs" role="tablist" aria-label="Explore the platform">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-selected={active === id}
            aria-controls={`panel-${id}`}
            tabIndex={active === id ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const index = tabs.findIndex((t) => t.id === active);
                const next = tabs[(index + (e.key === "ArrowRight" ? 1 : 2)) % 3].id;
                setActive(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            onClick={() => setActive(id)}
          >
            <Icon size={17} />
            {label}
            <span>0{tabs.findIndex((t) => t.id === id) + 1}</span>
          </button>
        ))}
      </div>
      <div className="demo-window">
        <aside className="demo-sidebar" aria-hidden="true">
          <div className="demo-workspace">
            <span>n.</span> Northstar <ChevronRight size={13} />
          </div>
          <small>WORKSPACE</small>
          <div>
            <LayoutDashboard size={14} /> Overview
          </div>
          <div className={active === "knowledge" ? "selected" : ""}>
            <BookOpen size={14} /> Knowledge Gateway
          </div>
          <div className={active === "learning" ? "selected" : ""}>
            <GraduationCap size={14} /> Learning paths
          </div>
          <div className={active === "analytics" ? "selected" : ""}>
            <TrendingUp size={14} /> Analytics
          </div>
          <div>
            <ShieldCheck size={14} /> Governance
          </div>
          <div className="demo-sidebar-bottom">
            <span className="avatar">JD</span>
            <span>
              Jamie Davis<small>Team member</small>
            </span>
          </div>
        </aside>
        <div
          className="demo-panel"
          id={`panel-${active}`}
          role="tabpanel"
          aria-labelledby={`tab-${active}`}
          tabIndex={0}
        >
          <div className="demo-topbar">
            <span>
              Workspace <ChevronRight size={12} />{" "}
              {active === "knowledge"
                ? "Knowledge Gateway"
                : active === "learning"
                  ? "Learning paths"
                  : "Analytics"}
            </span>
            <span className="sample-tag">ILLUSTRATIVE DEMO</span>
          </div>
          {active === "knowledge" && (
            <div className="demo-content knowledge-demo">
              <div className="demo-eyebrow">
                <span className="tiny-spark">
                  <Sparkles size={13} />
                </span>{" "}
                A LITTLE CLARITY GOES A LONG WAY
              </div>
              <h3>
                Your next great answer
                <br />
                starts here.
              </h3>
              <p>Less searching. More moving forward.</p>
              <form className="demo-search" onSubmit={ask}>
                <Search size={17} />
                <input
                  aria-label="Ask the sample knowledge base"
                  placeholder="How does our onboarding work?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={200}
                />
                <button aria-label="Search sample knowledge">
                  <ArrowRight size={18} />
                </button>
              </form>
              <div className="demo-suggestions">
                Try asking:{" "}
                <button
                  onClick={() => {
                    setQuery(answers.product.question);
                    setAnswer("product");
                    setSearched(true);
                  }}
                >
                  Product knowledge <ArrowUpIcon />
                </button>
                <button
                  onClick={() => {
                    setQuery(answers.policy.question);
                    setAnswer("policy");
                    setSearched(true);
                  }}
                >
                  Review policy <ArrowUpIcon />
                </button>
              </div>
              <div className="answer-card" aria-live="polite">
                <div>
                  <Sparkles size={15} />
                  <strong>
                    {searched
                      ? "An answer from your sample sources"
                      : "The right knowledge. At the right moment."}
                  </strong>
                  <span className="answer-pill">Cited answer</span>
                </div>
                <p>{answers[answer].text}</p>
                <button
                  className="source-link"
                  onClick={() => setSourceOpen(!sourceOpen)}
                  aria-expanded={sourceOpen}
                >
                  <FileText size={13} />
                  {answers[answer].source}
                  <ChevronRight size={13} />
                </button>
                {sourceOpen && (
                  <p className="source-detail">
                    {answers[answer].section}. This is an authored sample source for this
                    demonstration.
                  </p>
                )}
              </div>
              <div className="demo-note">
                <ShieldCheck size={12} /> Sample content only. Live knowledge workflows are in
                development.
              </div>
            </div>
          )}
          {active === "learning" && (
            <div className="demo-content learning-demo">
              <div className="demo-eyebrow">YOUR NEXT CHAPTER</div>
              <h3>
                Small steps.
                <br />
                Lasting confidence.
              </h3>
              <p>A learning path built around the work you do.</p>
              <div className="learning-path">
                <div className="course-illustration">
                  <GraduationCap size={36} />
                  <span>THE FOUNDATION SERIES</span>
                </div>
                <div className="course-details">
                  <span className="sample-tag">3 SHORT LESSONS</span>
                  <h4>Product Foundations</h4>
                  <p>
                    Understand the product. Connect the dots.
                    <br />
                    Bring the story to life.
                  </p>
                  <div className="progress-track">
                    <span style={{ width: `${(lesson / 3) * 100}%` }} />
                  </div>
                  <small>{lesson} of 3 lessons explored</small>
                  <button
                    className="button button-dark button-small"
                    onClick={() => setLesson(lesson === 3 ? 0 : lesson + 1)}
                  >
                    {lesson === 3
                      ? "Explore again"
                      : lesson === 0
                        ? "Try a sample lesson"
                        : "Complete next lesson"}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
              {lesson > 0 && (
                <div className="lesson-feedback" role="status">
                  <Check size={15} />
                  {
                    [
                      "",
                      "Know the product: start with the customer problem.",
                      "Connect the value: translate capabilities into outcomes.",
                      "Make it yours: practice your product story. Sample path complete!",
                    ][lesson]
                  }
                </div>
              )}
            </div>
          )}
          {active === "analytics" && (
            <div className="demo-content analytics-demo">
              <div className="analytics-heading">
                <div>
                  <div className="demo-eyebrow">GROWTH, MADE VISIBLE</div>
                  <h3>See the bigger picture.</h3>
                </div>
                <select
                  aria-label="Sample analytics period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option>This month</option>
                  <option>Last month</option>
                </select>
              </div>
              <p>Illustrative data to show what progress could look like.</p>
              <div className="metric-grid">
                <div>
                  <small>Learning engagement</small>
                  <strong>
                    {period === "This month" ? "84" : "72"}
                    <span>%</span>
                  </strong>
                  <span className="metric-detail">Sample engagement</span>
                </div>
                <div>
                  <small>Knowledge confidence</small>
                  <strong>
                    {period === "This month" ? "92" : "86"}
                    <span>%</span>
                  </strong>
                  <span className="metric-detail">Sample assessment score</span>
                </div>
                <div>
                  <small>Active learning paths</small>
                  <strong>{period === "This month" ? "12" : "9"}</strong>
                  <span className="metric-detail">Sample organization</span>
                </div>
              </div>
              <div className="chart-card">
                <div>
                  <strong>Capability over time</strong>
                  <span>
                    <i /> Knowledge confidence
                  </span>
                </div>
                <svg
                  viewBox="0 0 600 145"
                  role="img"
                  aria-label={`Illustrative confidence trend for ${period.toLowerCase()}`}
                >
                  <defs>
                    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop stopColor="#91b473" stopOpacity=".35" />
                      <stop offset="1" stopColor="#91b473" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M10 130H590M10 85H590M10 40H590"
                    stroke="#e9ece4"
                    strokeDasharray="4 5"
                  />
                  <path
                    d={
                      period === "This month"
                        ? "M10 126C70 123 75 90 130 96S210 66 260 73S340 31 390 46S490 11 590 15V145H10Z"
                        : "M10 136C70 120 75 110 130 115S210 80 260 86S340 71 390 76S490 37 590 40V145H10Z"
                    }
                    fill="url(#chartFill)"
                  />
                  <path
                    d={
                      period === "This month"
                        ? "M10 126C70 123 75 90 130 96S210 66 260 73S340 31 390 46S490 11 590 15"
                        : "M10 136C70 120 75 110 130 115S210 80 260 86S340 71 390 76S490 37 590 40"
                    }
                    stroke="#456745"
                    strokeWidth="2.5"
                    fill="none"
                  />
                </svg>
                <div className="chart-axis">
                  <span>Week 1</span>
                  <span>Week 2</span>
                  <span>Week 3</span>
                  <span>Week 4</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="demo-footer">
        <span className="status-dot" /> A glimpse of what’s growing.
        <span>Fictional organization · No account needed</span>
      </div>
    </div>
  );
}
function ArrowUpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 10 10 2M2 2h8v8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
