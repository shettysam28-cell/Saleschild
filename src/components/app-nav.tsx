"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  GraduationCap,
  ClipboardCheck,
  Sparkles,
  BarChart3,
  Bell,
  Settings,
} from "lucide-react";
import { navigationModules } from "@/lib/modules";
import type { Role } from "@/lib/permissions";
const icons = { BookOpen, GraduationCap, ClipboardCheck, Sparkles, BarChart3, Bell, Settings };
export function AppNav({ role = "learner" }: { role?: Role }) {
  const path = usePathname();
  return (
    <nav className="app-navigation" aria-label="Workspace">
      <Link href="/app" aria-current={path === "/app" ? "page" : undefined}>
        <LayoutDashboard size={16} />
        Home
      </Link>
      {navigationModules(role).map((module) => {
        const Icon = icons[module.icon];
        return (
          <Link
            key={module.slug}
            href={`/app/${module.slug}`}
            aria-current={
              path === `/app/${module.slug}` || path.startsWith(`/app/${module.slug}/`)
                ? "page"
                : undefined
            }
          >
            <Icon size={16} />
            {module.title}
          </Link>
        );
      })}
    </nav>
  );
}
