import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/inter";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import "./marketing.css";
import { appOrigin } from "@/lib/config";
export const metadata: Metadata = {
  title: {
    default: "Saleschild — Where Knowledge Grows Into Performance",
    template: "%s | Saleschild",
  },
  description:
    "Connect your organization’s knowledge, learning and growth. Saleschild helps teams turn what they know into what they can do.",
  applicationName: "Saleschild",
  robots: { index: true, follow: true },
  ...(appOrigin() ? { metadataBase: new URL(appOrigin()!) } : {}),
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
