"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
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
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const edges = () => {
      nav.dataset.overflowStart = String(nav.scrollLeft > 1);
      nav.dataset.overflowEnd = String(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    };
    const reveal = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (active && nav.scrollWidth > nav.clientWidth) {
        const a = active.getBoundingClientRect(),
          b = nav.getBoundingClientRect();
        if (a.left < b.left + 8) nav.scrollLeft += a.left - b.left - 8;
        else if (a.right > b.right - 8) nav.scrollLeft += a.right - b.right + 8;
      }
      edges();
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    nav.addEventListener("scroll", edges, { passive: true });
    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", edges);
    };
  }, [path, role]);
  return (
    <nav ref={navigation} className="app-navigation" aria-label="Workspace">
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
