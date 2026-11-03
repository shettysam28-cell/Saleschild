import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="m-footer-intro">
        <span className="m-kicker">THE NEXT CHAPTER STARTS WITH WHAT YOU KNOW.</span>
        <Link href="/contact">
          Let’s make it count.
          <ArrowUpRight />
        </Link>
      </div>
      <div className="footer-top">
        <div>
          <Brand light />
          <p>Where Knowledge Grows Into Performance.</p>
          <span className="m-footer-note">An emerging platform for organizational potential.</span>
        </div>
        <div>
          <span>PLATFORM</span>
          <Link href="/platform">Overview</Link>
          <Link href="/knowledge-gateway">Knowledge Gateway</Link>
          <Link href="/ai-learning">AI Learning</Link>
          <Link href="/intelligence">Intelligence & Analytics</Link>
          <Link href="/demo">Interactive demo</Link>
        </div>
        <div>
          <span>SALESCHILD</span>
          <Link href="/solutions">Solutions</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/register">Start growing</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Saleschild.</span>
        <span>Built around people. Designed for growth.</span>
        <Link href="/privacy">Privacy</Link>
      </div>
    </footer>
  );
}
