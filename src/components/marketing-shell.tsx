import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
