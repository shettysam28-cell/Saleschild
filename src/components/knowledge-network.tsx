const nodes = Array.from({ length: 30 }, (_, i) => {
  const angle = i * 2.399963;
  const radius = 55 + Math.sqrt(i / 29) * 210;
  return { x: 300 + Math.cos(angle) * radius, y: 280 + Math.sin(angle) * radius };
});
export function KnowledgeNetwork() {
  return (
    <div
      className="m-network"
      role="img"
      aria-label="Scattered knowledge forming a connected network"
    >
      <div className="m-network-glow" />
      <svg viewBox="0 0 600 560" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="networkCore">
            <stop stopColor="#c8ff5f" stopOpacity=".24" />
            <stop offset="1" stopColor="#c8ff5f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="300" cy="280" r="250" fill="url(#networkCore)" />
        <g className="m-network-orbits" stroke="#a4adbb" strokeOpacity=".2">
          <ellipse cx="300" cy="280" rx="252" ry="176" transform="rotate(-35 300 280)" />
          <ellipse cx="300" cy="280" rx="245" ry="171" transform="rotate(38 300 280)" />
          <circle cx="300" cy="280" r="238" />
          <circle cx="300" cy="280" r="160" strokeDasharray="2 8" />
        </g>
        <g>
          {nodes.map((p, i) => (
            <path
              key={i}
              d={`M${p.x} ${p.y} L${nodes[(i + 7) % 30].x} ${nodes[(i + 7) % 30].y}`}
              stroke={i % 3 === 0 ? "#58e6e0" : "#c8ff5f"}
              strokeOpacity={i % 3 === 0 ? ".22" : ".12"}
            />
          ))}
        </g>
        {nodes.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={i % 4 === 0 ? 5 : 2.5}
              fill={i % 3 === 0 ? "#58e6e0" : "#c8ff5f"}
            />
            {i % 4 === 0 && <circle cx={p.x} cy={p.y} r="11" stroke="#c8ff5f" strokeOpacity=".3" />}
          </g>
        ))}
        <circle cx="300" cy="280" r="42" fill="#141c2b" stroke="#c8ff5f" strokeOpacity=".6" />
        <path
          d="M300 305v-32m0 19c-19 0-26-15-22-31 19 0 28 12 22 31Zm0-13c-3-19 11-29 29-26 3 18-9 30-29 26Z"
          stroke="#c8ff5f"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <div className="m-orbit-label mol-one">
        <span />
        Knowledge
      </div>
      <div className="m-orbit-label mol-two">
        <span />
        Learning
      </div>
      <div className="m-orbit-label mol-three">
        <span />
        Performance
      </div>
      <div className="m-network-coordinate">
        CONNECTED POTENTIAL
        <br />
        SC / 01 — ∞
      </div>
    </div>
  );
}
