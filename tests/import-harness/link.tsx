import type { AnchorHTMLAttributes } from "react";
// The isolated Vite fixture has no Next.js router. Preserve real link destinations
// and full navigations while exercising production components and server actions.
export default function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean },
) {
  const anchor = { ...props };
  delete anchor.prefetch;
  return <a {...anchor} />;
}
