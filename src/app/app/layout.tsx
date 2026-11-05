import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { AppNav } from "@/components/app-nav";
import { requireWorkspace } from "@/lib/session";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { workspaceAppearanceScript } from "@/lib/workspace-appearance";
import { WorkspacePresence } from "@/components/workspace-presence";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace", robots: { index: false, follow: false } };
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { organization, role, profile } = await requireWorkspace();
  return (
    <div className="app-shell">
      <script dangerouslySetInnerHTML={{ __html: workspaceAppearanceScript }} />
      <WorkspacePresence />
      <aside className="app-sidebar">
        <Brand href="/app" />
        <div className="org-label">
          {organization.name}
          <small>{role === "learner" ? "Member" : role} workspace</small>
        </div>
        <AppNav role={role} />
        <div className="app-sidebar-bottom">
          <p>Where knowledge grows.</p>
          <Link className="text-link" href="/privacy">
            Privacy
          </Link>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <span>
            {role === "learner" ? "Your learning workspace" : "Your organization’s workspace"}
          </span>
          <WorkspaceAccountMenu
            displayName={profile.displayName}
            organization={organization.name}
            role={role}
          />
        </header>
        <main id="main" className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
