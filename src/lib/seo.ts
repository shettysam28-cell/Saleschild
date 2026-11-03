import type { Metadata } from "next";
import { appOrigin } from "./config";
export function pageMetadata(title: string, description: string, path: string): Metadata {
  const origin = appOrigin();
  return {
    title,
    description,
    ...(origin
      ? {
          alternates: { canonical: new URL(path, origin).href },
          openGraph: {
            title: `${title} | Saleschild`,
            description,
            url: new URL(path, origin).href,
            siteName: "Saleschild",
            type: "website",
          },
        }
      : {}),
  };
}
