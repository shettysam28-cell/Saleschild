"use client";
import { useState } from "react";
import {
  ArrowRight,
  FileText,
  Layers3,
  GraduationCap,
  CheckCircle2,
  BarChart3,
} from "lucide-react";
import { sampleRecord } from "@/lib/knowledge/templates";
const sample = sampleRecord("product");
const stages = [
  { name: "Your knowledge", icon: FileText },
  { name: "Structured intelligence", icon: Layers3 },
  { name: "Learning academy", icon: GraduationCap },
  { name: "Practice", icon: CheckCircle2 },
  { name: "Progress", icon: BarChart3 },
];
export function KnowledgeTransformation() {
  const [stage, setStage] = useState(0),
    [answer, setAnswer] = useState("");
  return (
    <section className="knowledge-story" aria-labelledby="knowledge-story-heading">
      <div className="eyebrow">FROM WHAT YOU KNOW. TO WHAT YOUR TEAM CAN DO.</div>
      <h2 id="knowledge-story-heading">
        Your knowledge.
        <br />
        <em>A world of possibility.</em>
      </h2>
      <p>
        Your Knowledge <ArrowRight size={15} aria-hidden="true" /> Structured Intelligence{" "}
        <ArrowRight size={15} aria-hidden="true" /> Learning Academy
      </p>
      <div className="knowledge-story-frame">
        <div className="knowledge-story-nav" aria-label="Explore the knowledge journey">
          {stages.map((s, i) => (
            <button key={s.name} aria-pressed={stage === i} onClick={() => setStage(i)}>
              <s.icon size={18} aria-hidden="true" />
              <span>{s.name}</span>
              <small>0{i + 1}</small>
            </button>
          ))}
        </div>
        <div className="knowledge-story-stage" aria-live="polite">
          <span className="knowledge-story-label">
            FICTIONAL LUMADESK GUIDE · INTERACTIVE SAMPLE
          </span>
          {stage === 0 && (
            <>
              <FileText size={34} aria-hidden="true" />
              <h3>
                Start with the knowledge
                <br />
                you already have.
              </h3>
              <div className="fictional-document">
                <span>PRODUCT GUIDE / SECTION 1</span>
                <h4>{sample.Topic}</h4>
                <p>{sample["Knowledge Content"]}</p>
              </div>
              <p>Upload a CSV or Excel source, or use a guided template.</p>
            </>
          )}
          {stage === 1 && (
            <>
              <Layers3 size={34} aria-hidden="true" />
              <h3>
                Give every fact
                <br />a clear place.
              </h3>
              <dl className="demo-source-record">
                {(["Topic", "Category", "Learning Objective", "Source Reference"] as const).map(
                  (c) => (
                    <div key={c}>
                      <dt>{c}</dt>
                      <dd>{sample[c]}</dd>
                    </div>
                  ),
                )}
              </dl>
              <p>Preview, map and validate. Review sources before publication.</p>
            </>
          )}
          {stage === 2 && (
            <>
              <GraduationCap size={34} aria-hidden="true" />
              <h3>
                A starting point
                <br />
                for a learning academy.
              </h3>
              <div className="demo-academy-module">
                <span>LEARNING PATH / PRODUCT FOUNDATIONS</span>
                <h4>Module 01 · Plan selection</h4>
                <p>Lesson: {sample.Topic}</p>
                <p>Objective: {sample["Learning Objective"]}</p>
                <small>Source: fictional guide, section 1 · administrator approval required</small>
              </div>
              <p>Curriculum preview shown for illustration. AI generation is not connected.</p>
            </>
          )}
          {stage === 3 && (
            <>
              <CheckCircle2 size={34} aria-hidden="true" />
              <h3>
                Put understanding
                <br />
                into practice.
              </h3>
              <fieldset className="demo-quiz">
                <legend>{sample["Assessment Question"]}</legend>
                {sample["Answer Options"].split(" | ").map((option) => (
                  <button
                    key={option}
                    aria-pressed={answer === option}
                    onClick={() => setAnswer(option)}
                  >
                    {option}
                  </button>
                ))}
                {answer && (
                  <p role="status">
                    {answer === sample["Correct Answer"]
                      ? "Correct — the fictional guide says Team supports multiple workspaces."
                      : "Check the source: Starter supports one workspace. Try again."}
                  </p>
                )}
              </fieldset>
              <p>This sample quiz does not save a result or create a learner account.</p>
            </>
          )}
          {stage === 4 && (
            <>
              <BarChart3 size={34} aria-hidden="true" />
              <h3>
                See learning
                <br />
                take shape.
              </h3>
              <div className="demo-progress">
                <span>ILLUSTRATIVE PROGRESS DASHBOARD</span>
                <strong>1 / 3</strong>
                <p>Sample lessons completed</p>
                <div aria-hidden="true">
                  <span />
                </div>
                <small>Fictional data · Progress tracking is planned.</small>
              </div>
              <p>A future view of progress, grounded in the knowledge you supplied.</p>
            </>
          )}
          <div className="knowledge-story-bottom">
            <span>0{stage + 1} / 05</span>
            <button
              className="button button-accent"
              onClick={() => setStage((stage + 1) % stages.length)}
            >
              {stage === 4 ? "Explore again" : "Next transformation"}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
