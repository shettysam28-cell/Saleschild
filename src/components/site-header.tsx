"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X, ChevronDown } from "lucide-react";
import { Brand } from "./brand";
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const links = [
    ["The platform", "/platform"],
    ["Knowledge Gateway", "/knowledge-gateway"],
    ["AI Learning", "/ai-learning"],
    ["Intelligence & Analytics", "/intelligence"],
    ["Solutions", "/solutions"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
    ["Contact", "/contact"],
    ["Interactive demo", "/demo"],
  ];
  return (
    <header className="site-header">
      <div className="nav-inner">
        <Brand light />
        <nav className="desktop-nav" aria-label="Main navigation">
          <details className="m-nav-dropdown">
            <summary>
              Platform <ChevronDown size={12} />
            </summary>
            <div>
              {links.slice(0, 4).map(([name, href]) => (
                <Link href={href} key={href}>
                  {name}
                  <ArrowUpRight size={13} />
                </Link>
              ))}
            </div>
          </details>
          <Link href="/solutions">Solutions</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
        </nav>
        <div className="nav-actions">
          <Link className="login-link" href="/login">
            Log in
          </Link>
          <Link className="button button-lime button-small" href="/register">
            Get started <ArrowUpRight size={14} />
          </Link>
          <button
            ref={toggle}
            className="menu-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation">
          {links.map(([name, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {name}
              <ArrowUpRight size={14} />
            </Link>
          ))}
          <Link href="/login">Log in</Link>
        </nav>
      )}
    </header>
  );
}
