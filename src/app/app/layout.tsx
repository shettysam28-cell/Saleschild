import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { AppNav } from "@/components/app-nav";
import { requireWorkspace } from "@/lib/session";
import { signOutAction } from "@/app/(auth)/actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace", robots: { index: false, follow: false } };
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { organization, role } = await requireWorkspace();
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Brand />
        <div className="org-label">
          {organization.name}
          <small>{role} workspace</small>
        </div>
        <AppNav />
        <div className="app-sidebar-bottom">
          <p>Where knowledge grows.</p>
          <Link className="text-link" href="/privacy">
            Privacy
          </Link>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <span>Your organization’s private workspace</span>
          <form action={signOutAction}>
            <button className="button button-outline button-small">Log out</button>
          </form>
        </header>
        <main id="main" className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
