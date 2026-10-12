import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Next loads app-local files automatically. The monorepo also has a shared,
// server-only environment file used by the internal portal and integrations.
// Existing process variables always win, so deployed configuration is unchanged.
const sharedEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(sharedEnvPath)) process.loadEnvFile(sharedEnvPath);

// Meta's SDK runs WhatsApp Embedded Signup (Settings › Integrations); Google's Picker links a sheet to an import
// (Inventory, Catalog). Nothing else loads from outside.
const META_SDK = "https://connect.facebook.net";
const GOOGLE_PICKER = "https://apis.google.com";
const scriptPolicy = process.env.NODE_ENV === "development"
  ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${META_SDK} ${GOOGLE_PICKER}`
  : `script-src 'self' 'unsafe-inline' ${META_SDK} ${GOOGLE_PICKER}`;

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
      // The SDK's own frames for sign-in, on Meta's domains only; the Google Picker's frame.
      // Reference videos in notes play from YouTube's no-cookie host or Vimeo's player.
      "frame-src 'self' https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com https://docs.google.com https://www.youtube-nocookie.com https://player.vimeo.com",
      "connect-src 'self' https: wss:",
      "media-src 'self' blob: https:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const sameOriginHeaders = securityHeaders.map((header) => header.key === "X-Frame-Options"
  ? { ...header, value: "SAMEORIGIN" }
  : header.key === "Content-Security-Policy"
    ? { ...header, value: header.value.replace("frame-ancestors 'none'", "frame-ancestors 'self'") }
    : header);

const framableHeaders = securityHeaders.filter((header) => header.key !== "X-Frame-Options")
  .map((header) => header.key === "Content-Security-Policy" ? { ...header, value: header.value.replace("frame-ancestors 'none'", "frame-ancestors *") } : header);

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
      // The public booking page (/book/{workspace}/{type}) and a lead form (/enquiry/{token}, the "Embed code" firms
      // copy) may be framed on firms' own websites. Files under /api may be shown inside our own pages (the signing
      // page's PDF, a captured bill). Everything else, including the signed manage page, keeps frame-ancestors 'none'.
      { source: "/:path((?!book/[^/]+/[^/]+/?$|enquiry/[^/]+/?$|api/).*)", headers: securityHeaders },
      { source: "/book/:workspace/:type", headers: framableHeaders },
      { source: "/enquiry/:token", headers: framableHeaders },
      { source: "/api/:path*", headers: sameOriginHeaders },
      {
        // Brand characters (role avatars, Woddy) change by file name only, so browsers may keep them.
        source: "/brand/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        // The landing's pre-generated screenshots have a content hash in their names (scripts/landing-images.mjs).
        source: "/landing/opt/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
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
