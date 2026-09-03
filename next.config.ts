import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * `geolocation` and `camera` are explicitly allowed for our own origin — the
 * app geo-tags every visit and lets reps attach a photo, and an unset
 * Permissions-Policy would otherwise be tightened by future browser defaults.
 * A Content-Security-Policy is deliberately left out for now: it needs to be
 * written against real pages rather than guessed at on an empty skeleton.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(self), microphone=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
