import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/config";
import { publicPages } from "@/lib/public-pages";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin();
  if (!origin) return [];
  return [
    "/",
    ...Object.keys(publicPages).map((s) => `/${s}`),
    "/contact",
    "/demo",
    "/privacy",
  ].map((path) => ({
    url: new URL(path, origin).href,
    changeFrequency: "monthly" as const,
    priority: path === "/" ? 1 : 0.7,
  }));
}
