import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * `geolocation` and `camera` are explicitly allowed for our own origin — the
 * app geo-tags every visit and lets reps attach a photo, and an unset
 * Permissions-Policy would otherwise be tightened by future browser defaults.
 * The Content-Security-Policy is NOT here: it carries a per-request nonce, so
 * it is built in src/proxy.ts instead. Everything below is the same on every
 * response and belongs in one place.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Belt and braces with the CSP's frame-ancestors, for older browsers.
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    // Only meaningful over HTTPS, and harmless before then. Two years with
    // subdomains, which is what preload lists ask for.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(self), microphone=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  /*
   * Next sends `X-Powered-By: Next.js` on every response otherwise. It buys
   * nothing and tells a scanner which framework to look up advisories for.
   */
  poweredByHeader: false,

  /*
   * The two brand images are local PNGs, already sized for the slots they sit
   * in, so there is nothing for an optimiser to do. Turning it off keeps the
   * app off any one host's image service — Cloudflare's needs a binding, and
   * another host would need something else — which is the portability rule in
   * CLAUDE.md applied to a config file rather than to code.
   */
  images: { unoptimized: true },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
