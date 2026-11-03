import Link from "next/link";
import { Brand } from "@/components/brand";
export default function NotFound() {
  return (
    <main id="main" className="status-page">
      <Brand />
      <span className="eyebrow">A DIFFERENT PATH</span>
      <h1>
        This page hasn’t
        <br />
        <em>taken root.</em>
      </h1>
      <p>Let’s get you back to a place you know.</p>
      <Link className="button button-dark" href="/">
        Back to Saleschild
      </Link>
    </main>
  );
}
