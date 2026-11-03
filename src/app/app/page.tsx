import Link from "next/link";
import { ArrowUpRight, BookOpen, GraduationCap, Sparkles, BarChart3 } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
export default async function Overview() {
  const { client, organization } = await requireWorkspace();
  const results = await Promise.all([
    client
      .from("knowledge_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id),
    client
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id),
    client
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id),
  ]);
  if (results.some((r) => r.error)) throw new Error("Workspace activity could not be loaded.");
  const cards = [
    {
      title: "Knowledge Gateway",
      description: "Find and build the knowledge that moves your organization forward.",
      href: "knowledge",
      icon: BookOpen,
    },
    {
      title: "Learning",
      description: "Explore purposeful learning paths, one useful step at a time.",
      href: "learning",
      icon: GraduationCap,
    },
    {
      title: "AI workflows",
      description:
        "Prepare requests for assisted knowledge workflows. Processing is not enabled yet.",
      href: "workflows",
      icon: Sparkles,
    },
    {
      title: "Analytics & governance",
      description: "Understand your workspace’s activity and maintain accountability.",
      href: "analytics",
      icon: BarChart3,
    },
  ];
  return (
    <>
      <div className="app-title-row">
        <div>
          <div className="eyebrow">A LITTLE MORE POSSIBLE</div>
          <h1>Welcome to {organization.name}.</h1>
          <p>Here’s where your team’s knowledge starts to grow.</p>
        </div>
      </div>
      <div className="workspace-stats">
        {["Accessible resources", "Accessible learning paths", "Visible enrollments"].map(
          (label, i) => (
            <div className="workspace-stat" key={label}>
              <span>{label}</span>
              <strong>{results[i].count ?? 0}</strong>
              <small>Live workspace records</small>
            </div>
          ),
        )}
      </div>
      <div className="workspace-grid">
        {cards.map(({ title, description, href, icon: Icon }) => (
          <Link href={`/app/${href}`} className="workspace-module" key={href}>
            <Icon size={23} />
            <h2>{title}</h2>
            <p>{description}</p>
            <span>
              Explore <ArrowUpRight size={13} />
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
