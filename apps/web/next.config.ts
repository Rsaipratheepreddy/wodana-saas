import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Next loads app-local files automatically. The monorepo also has a shared,
// server-only environment file used by the internal portal and integrations.
// Existing process variables always win, so deployed configuration is unchanged.
const sharedEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(sharedEnvPath)) process.loadEnvFile(sharedEnvPath);

const scriptPolicy = process.env.NODE_ENV === "development"
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      scriptPolicy,
      "connect-src 'self' https: wss:",
      "media-src 'self' blob: https:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  distDir: process.env.WODANA_NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Product screenshots on the public pages are served as AVIF where the browser supports it, else WebP.
  images: { formats: ["image/avif", "image/webp"] },
  experimental: {
    // Large barrel packages: load only the components a page uses (dev compiles and production bundles).
    optimizePackageImports: ["react-aria-components", "react-aria"],
  },
  redirects() {
    return [
      {
        source: "/workspace/pre-projects/master-data",
        destination: "/workspace/catalogs",
        permanent: false,
      },
      {
        source: "/workspace/pre-projects/catalogs",
        destination: "/workspace/catalogs",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Brand characters (role avatars, Woddy) change by file name only, so browsers may keep them.
        source: "/brand/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        // HRMS check-in can be reached through client-side navigation from any
        // staff page, so its document policy must allow these same-origin APIs.
        // The browser still requires the user's camera/location permission.
        source: "/workspace/:path*",
        headers: [{
          key: "Permissions-Policy",
          value: "camera=(self), microphone=(), geolocation=(self), browsing-topics=()",
        }],
      },
    ];
  },
};

export default nextConfig;
