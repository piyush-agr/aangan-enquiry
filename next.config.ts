import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // knowledge/*.md is read on the server at runtime; make sure it ships with server functions.
  outputFileTracingIncludes: { "/**": ["./knowledge/services.md", "./knowledge/qualified.md"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
