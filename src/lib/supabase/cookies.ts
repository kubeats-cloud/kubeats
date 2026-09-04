/**
 * How the session cookie is written, in one place.
 *
 * `secure` only in production: Chrome treats localhost as a secure origin and
 * would accept it either way, but other browsers and proxies are less generous,
 * and a cookie that silently fails to set during local development is a bad
 * afternoon.
 *
 * `httpOnly` is deliberately absent, and cannot be added. @supabase/ssr's
 * browser client reads the session from document.cookie to keep the client and
 * server in step, so a script-invisible cookie would sign the user out on every
 * client-side navigation. The mitigations are the ones already in place: a CSP
 * that refuses inline and third-party script, SameSite=Lax, and HSTS.
 */
export const COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;
