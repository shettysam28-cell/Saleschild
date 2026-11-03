import Link from "next/link";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`brand ${light ? "brand-light" : ""}`} aria-label="Saleschild home">
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M16 27V14M16 20C5 21 3 14 4 6c8-1 14 3 12 14ZM16 15C15 6 22 3 29 4c1 8-4 13-13 11Z"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="m9 12 7 8 7-11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      <span>
        saleschild<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
