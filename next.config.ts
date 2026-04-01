// next.config.ts
import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
const chatwootUrl = process.env.NEXT_PUBLIC_CHATWOOT_URL ?? "";

const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""} https://www.googletagmanager.com https://*.posthog.com ${chatwootUrl}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // NOTE: 'unsafe-inline' in script-src is a known limitation; nonce-based CSP is a larger follow-up
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  `connect-src 'self' ${apiUrl} https://*.posthog.com https://*.google-analytics.com https://www.googletagmanager.com https://api.github.com ${chatwootUrl}`,
  `frame-src 'self' https://www.googletagmanager.com ${chatwootUrl}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // output: "export",
  images: {
    unoptimized: true, // ✅ disables Image Optimization
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};
export default withBundleAnalyzer(nextConfig);
