export const publicPages = {
  platform: {
    label: "THE SALESCHILD PLATFORM",
    title: "A shared foundation.",
    accent: "A stronger next chapter.",
    description:
      "Knowledge, learning, and the confidence to move forward. Saleschild is being built to bring them closer together.",
    intro: "From information to everyday ability.",
    body: "An organization’s knowledge creates value when people can find it, understand it, and put it into practice. We’re building one connected home for that journey.",
    status: "PHASE 0 FOUNDATION · LIVE ACCESS PENDING VERIFICATION",
    features: [
      [
        "Knowledge with context",
        "Create organization-scoped resources with sources, draft/published states, and version history.",
      ],
      [
        "Learning with direction",
        "Prepare draft learning paths connected to your team’s needs. Lesson delivery and assessments are planned.",
      ],
      [
        "Accountability at the core",
        "Workspace activity, role boundaries, private raw-source storage, and governance events form the foundation.",
      ],
    ],
    roadmap:
      "AI workflows currently save draft requests only. Model processing, source-aware retrieval, assessment delivery, advanced analytics and autonomous execution are not live.",
    anchor: "automation",
  },
  "knowledge-gateway": {
    label: "KNOWLEDGE GATEWAY",
    title: "Less searching.",
    accent: "More shared understanding.",
    description:
      "Give your organization’s knowledge a clear, accountable home. Start with a useful resource. Keep the context that makes it trustworthy.",
    intro: "A source. A version. A clearer starting point.",
    body: "The foundation supports stable resource identifiers, source references, version snapshots, and clear publication states. Knowledge remains inside its organization’s access boundary.",
    status: "FOUNDATION IMPLEMENTED · HOSTED VALIDATION PENDING",
    features: [
      [
        "A record you can follow",
        "Resources retain a stable identity and version history as authorized authors make changes.",
      ],
      [
        "Context that stays attached",
        "Keep a source reference with your knowledge. Evidence status is explicit; publication does not imply independent verification.",
      ],
      [
        "Clear sharing boundaries",
        "Drafts stay with content authors. Published resources become available to the organization’s members.",
      ],
    ],
    roadmap:
      "CSV/XLSX ingestion, schema mapping, duplicate detection, extraction and dependency-aware learning regeneration are the proposed next product phase.",
  },
  "ai-learning": {
    label: "AI LEARNING",
    title: "Not just more knowledge.",
    accent: "More ability.",
    description:
      "A vision for purposeful learning, grounded in what your organization knows and connected to the work your people do.",
    intro: "The learning is the connection.",
    body: "Draft learning-path planning is part of the current foundation. The next chapter connects approved knowledge to lessons, practice and thoughtful checks for understanding.",
    status: "DRAFT PATHS: FOUNDATION · AI / DELIVERY: ROADMAP",
    features: [
      [
        "Start with a purpose",
        "Prepare a draft learning path with a title and clear description. No generated lessons are presented as approved learning.",
      ],
      [
        "Practice with direction",
        "Planned lessons and targeted refreshers will connect understanding to everyday situations.",
      ],
      [
        "Assess understanding",
        "The data foundation preserves published assessment versions. Question banks, randomized delivery and grading are planned.",
      ],
    ],
    roadmap:
      "AI generation, lesson authoring and delivery, assignments, assessment player/grading and progress tracking are not enabled. The interactive demo shows an authored fictional example.",
    anchor: "assessments",
  },
  intelligence: {
    label: "INTELLIGENCE & ANALYTICS",
    title: "See the activity.",
    accent: "Find the opportunity.",
    description:
      "A considered view of your organization’s knowledge and learning. Start with real workspace records; grow toward a richer view of capability.",
    intro: "Progress deserves context.",
    body: "The foundation includes organization-scoped resource and learning-path counts, member counts for administrators, and a governance activity log. Empty workspaces stay empty; fictional demo metrics never become customer activity.",
    status: "WORKSPACE COUNTS: FOUNDATION · PERFORMANCE ANALYTICS: ROADMAP",
    features: [
      [
        "A real starting point",
        "Workspace counts reflect accessible records and permissions, without seeded customer activity.",
      ],
      [
        "Accountable change",
        "Knowledge edits, learning-path creation and organization updates generate governance events.",
      ],
      [
        "A wider view, ahead",
        "Learning effectiveness, knowledge freshness trends and performance intelligence form the future product direction.",
      ],
    ],
    roadmap:
      "Advanced performance analytics, exports and learning effectiveness reporting are planned. Demo charts use illustrative data and are not evidence of real customer outcomes.",
  },
  solutions: {
    label: "BUILT AROUND YOUR PEOPLE",
    title: "Different teams.",
    accent: "Shared potential.",
    description:
      "When people understand more, they have a better place to begin. Explore where a connected knowledge and learning foundation could fit.",
    intro: "Meet people where the work happens.",
    body: "Saleschild is being designed for organizations that want knowledge to move across roles, learning to have purpose, and expertise to remain useful as teams grow.",
    status: "USE CASES / PRODUCT DIRECTION",
    features: [
      [
        "Enablement & onboarding",
        "A home for product fundamentals, approved playbooks and the context new team members need.",
      ],
      [
        "Learning & development",
        "A foundation for focused learning paths, practical assessment and continuous skill development.",
      ],
      [
        "Knowledge & operations",
        "Maintain useful resources, sources, versions and access boundaries across the organization.",
      ],
    ],
    roadmap:
      "These are intended use cases, not claims of existing customer deployments or measured business outcomes. Talk with us about your needs before planning adoption.",
  },
  pricing: {
    label: "A CONSIDERED BEGINNING",
    title: "Let’s find the",
    accent: "right starting point.",
    description:
      "Saleschild is in development. Commercial plans and pricing have not been announced. There is no payment or subscription checkout in this preview.",
    intro: "Clarity before commitment.",
    body: "We’re shaping the product with a clear view of organizational needs, data boundaries and useful learning. Tell us about your team and what you want to make possible.",
    status: "NO ANNOUNCED PRICING · NO PAYMENT COLLECTED",
    features: [
      [
        "Explore the vision",
        "Try the interactive demonstration without an account or payment details.",
      ],
      [
        "Discuss your organization",
        "Use the contact form to describe your team, your knowledge challenges and what success would look like.",
      ],
      [
        "Make an informed decision",
        "Commercial terms, service availability and data-processing details will be shared before any subscription commitment.",
      ],
    ],
    roadmap:
      "No free trial, service-level commitment, paid tier, discount or included usage allowance is offered by this preview.",
  },
  about: {
    label: "WHY SALESCHILD",
    title: "Potential is already there.",
    accent: "Give it room to grow.",
    description:
      "We believe organizations are full of useful knowledge—and people capable of doing more with it.",
    intro: "Built around human potential.",
    body: "The name reflects our belief that growth is a process. Start with what people know. Connect it to what matters. Make space for understanding to become confidence and ability.",
    status: "WHERE KNOWLEDGE GROWS INTO PERFORMANCE.",
    features: [
      [
        "Useful over overwhelming",
        "Knowledge should help people take the next step, not add another layer of information to navigate.",
      ],
      [
        "Thoughtful intelligence",
        "AI should preserve context, make its sources clear, and support human judgment.",
      ],
      [
        "Trust as a foundation",
        "Organization boundaries, accountable content and honest capability claims matter from the beginning.",
      ],
    ],
    roadmap:
      "Saleschild is an independent product in development. We do not claim unapproved affiliations, certifications, partnerships or customer results.",
  },
} as const;
export type PublicSlug = keyof typeof publicPages;
