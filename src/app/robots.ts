import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/demo"],
      disallow: [
        "/app/",
        "/auth/",
        "/login",
        "/register",
        "/onboarding",
        "/forgot-password",
        "/reset-password",
        "/__forms.html",
      ],
    },
  };
}
