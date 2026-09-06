/**
 * How the session cookie is written, in one place.
 *
 * `secure` only in production: Chrome treats localhost as a secure origin and
 * would accept it either way, but other browsers and proxies are less generous,
 * and a cookie that silently fails to set during local development is a bad
 * afternoon.
 *
 * `httpOnly` is deliberately absent. This was RE-TESTED against pen-test
 * finding F8 rather than taken on trust, and the measurement is worth keeping:
 *
 *   with httpOnly: true
 *     login                                    works
 *     staying signed in across navigation      works
 *     sign out                                 works
 *     ANY upload from the browser              BROKEN — 403, "new row violates
 *                                              row-level security policy"
 *
 * @supabase/ssr's BROWSER client builds its Authorization header from the
 * session it reads out of document.cookie. Make that cookie invisible to script
 * and the client falls back to the anon key, so every call it makes is
 * anonymous. Two paths depend on it, and both upload straight from the browser
 * rather than through a server action, precisely so a 5 MB file never passes
 * through a request body:
 *
 *   - the visit photo (capture-fields.tsx). Rule 12 makes a photo mandatory,
 *     so with httpOnly a rep cannot log ANY visit at all;
 *   - the materials upload (material-upload-form.tsx).
 *
 * Server-rendered pages keep working throughout, which is what makes this
 * failure nasty: login and navigation look fine, and the app only breaks at the
 * moment a rep is standing in front of a school trying to save their work.
 *
 * So it stays off, as a known @supabase/ssr constraint rather than an
 * oversight. What stands in for it: a nonce-based CSP with strict-dynamic that
 * refuses inline and third-party script (which is what an XSS would need to
 * read the cookie in the first place), SameSite=Lax, Secure in production, and
 * HSTS. Revisit if @supabase/ssr ever reads the session server-side only.
 */
export const COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;
