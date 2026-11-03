import { ArrowUpRight, BookOpen, Check, Sparkles } from "lucide-react";

export function GrowthVisual() {
  return (
    <div
      className="growth-scene"
      role="img"
      aria-label="Connected knowledge grows into learning and confident performance"
    >
      <div className="scene-grid" />
      <div className="scene-glow" />
      <svg className="growth-art" viewBox="0 0 580 560" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id="stem"
            x1="290"
            y1="540"
            x2="290"
            y2="90"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#243e2d" />
            <stop offset=".55" stopColor="#b9e880" />
            <stop offset="1" stopColor="#edffd5" />
          </linearGradient>
          <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#436741" />
            <stop offset=".5" stopColor="#a9cd72" />
            <stop offset="1" stopColor="#d5f2a1" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <g className="orbital-lines" stroke="#b8d893" strokeOpacity=".17">
          <ellipse cx="290" cy="285" rx="210" ry="210" />
          <ellipse cx="290" cy="285" rx="260" ry="125" transform="rotate(-28 290 285)" />
          <ellipse cx="290" cy="285" rx="260" ry="125" transform="rotate(40 290 285)" />
          <path d="M30 285h520M290 25v520" strokeDasharray="3 7" />
        </g>
        <g className="plant-stem">
          <path d="M290 532V188" stroke="url(#stem)" strokeWidth="5" strokeLinecap="round" />
          <path d="M290 375C210 370 152 311 143 241c85-9 157 42 147 134Z" fill="url(#leaf)" />
          <path d="M290 319c4-89 65-147 147-148-1 85-59 149-147 148Z" fill="url(#leaf)" />
          <path d="M290 237c-57-12-83-63-74-126 66 16 91 64 74 126Z" fill="url(#leaf)" />
          <path d="M290 194c-2-62 31-106 86-121 14 64-25 114-86 121Z" fill="url(#leaf)" />
          <path
            d="m290 375-113-99m113 43 116-116m-116 34-57-95m57 52 62-90"
            stroke="#ecffce"
            strokeOpacity=".48"
            strokeWidth="1.1"
          />
        </g>
        <g fill="#d2f5a2">
          <circle cx="114" cy="169" r="4" />
          <circle cx="466" cy="354" r="5" />
          <circle cx="376" cy="453" r="3" />
          <circle cx="84" cy="334" r="2" />
          <circle cx="423" cy="97" r="3" />
          <circle cx="290" cy="74" r="3" />
        </g>
        <circle cx="114" cy="169" r="10" fill="#c8ee95" opacity=".2" filter="url(#glow)" />
        <ellipse cx="290" cy="531" rx="101" ry="14" fill="#b4db86" opacity=".08" />
        <ellipse cx="290" cy="531" rx="65" ry="5" fill="#d1eba3" opacity=".14" />
      </svg>
      <div className="float-card float-knowledge">
        <span className="float-icon">
          <BookOpen size={16} />
        </span>
        <div>
          <small>YOUR ORGANIZATION’S KNOWLEDGE</small>
          <strong>Connected. Trusted. Alive.</strong>
        </div>
        <ArrowUpRight size={15} />
      </div>
      <div className="float-card float-answer">
        <div className="float-answer-label">
          <Sparkles size={14} /> From insight to action
        </div>
        <p>
          Give every great idea
          <br />
          room to grow.
        </p>
        <div className="mini-avatars">
          <i>KN</i>
          <i>LR</i>
          <i>AI</i>
          <span>Better, together.</span>
        </div>
      </div>
      <div className="growth-caption">
        <span className="status-dot" /> BUILT FOR HUMAN POTENTIAL <span>01 — ∞</span>
      </div>
      <div className="float-complete">
        <span>
          <Check size={12} />
        </span>{" "}
        A little more capable. Every day.
      </div>
    </div>
  );
}
