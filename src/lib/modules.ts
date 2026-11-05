import type { Role } from "./permissions";
export const modules = [
  {
    slug: "knowledge",
    title: "Knowledge Gateway",
    description: "A shared home for trusted, useful knowledge.",
    icon: "BookOpen",
  },
  {
    slug: "learning",
    title: "Learning Paths",
    description: "Turn what your people know into what they can do.",
    icon: "GraduationCap",
  },
  {
    slug: "assessments",
    title: "Assessment",
    description: "A clearer picture of understanding and capability.",
    icon: "ClipboardCheck",
  },
  {
    slug: "workflows",
    title: "AI Workflow",
    description: "Thoughtful assistance, with your team in control.",
    icon: "Sparkles",
  },
  {
    slug: "analytics",
    title: "Analytics",
    description: "Understand activity and keep knowledge accountable.",
    icon: "BarChart3",
  },
  {
    slug: "progression",
    title: "Progression",
    description: "Your meaningful learning activity, one step at a time.",
    icon: "BarChart3",
  },
  {
    slug: "notifications",
    title: "Notification Hub",
    description: "Keep up with what matters in your workspace.",
    icon: "Bell",
  },
  {
    slug: "settings",
    title: "Settings",
    description: "Your organization, your preferences.",
    icon: "Settings",
  },
] as const;

export function navigationModules(role: Role) {
  const visible =
    role === "learner"
      ? ["learning", "assessments", "workflows", "progression"]
      : role === "owner"
        ? ["knowledge", "learning", "assessments", "workflows", "analytics"]
        : ["knowledge", "learning", "assessments", "workflows"];
  return modules
    .filter((module) => visible.includes(module.slug))
    .map((module) => ({
      ...module,
      title: module.slug === "learning" && role === "learner" ? "Learning Pathway" : module.title,
    }));
}
