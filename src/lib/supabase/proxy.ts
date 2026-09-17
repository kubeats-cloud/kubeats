import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { COOKIE_OPTIONS } from "@/lib/supabase/cookies";

/**
 * Refreshes the Supabase session for an incoming request.
 *
 * Server components cannot write cookies, so this is the one place a rotated
 * refresh token can actually be persisted. Skipping it causes the failure mode
 * the Supabase docs warn about: users randomly signed out mid-session.
 *
 * Returns the response carrying any refreshed cookies together with the
 * verified user, so the caller can decide where to send the request.
 */
export async function updateSession(
  request: NextRequest,
  /** Extra request headers to forward to the render, e.g. the CSP nonce. */
  extraHeaders?: Record<string, string>,
) {
  // Rebuilt on demand rather than captured once: setAll() below mutates the
  // request's cookies, and a stale copy would forward the old session.
  const forwardHeaders = () => {
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(extraHeaders ?? {})) {
      headers.set(key, value);
    }
    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = publicEnv();

  const supabase = createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: forwardHeaders() } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Supabase asks for these alongside auth cookies so a CDN or proxy
          // cannot serve one user's freshly-set session token to another.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  /*
   * THE ONE AWAIT IN THIS APP THAT RUNS ON EVERY REQUEST, so it is the one
   * whose failure has nowhere to land.
   *
   * `getUser()` normally reports trouble the way the rest of the SDK does — a
   * value with an `error` on it — and this code has always read it that way.
   * What it did not do is survive a REJECTION: a fetch that never completes, a
   * response that is not JSON, a socket dropped mid-flight. That is not a
   * screen failing, it is `proxy()` throwing, and a middleware that throws is
   * a hard 500 on EVERY route — including /api/* and including /login, with no
   * error boundary anywhere in the path to catch it. The whole app is simply
   * gone until Supabase answers again.
   *
   * FAILING CLOSED IS THE CORRECT DIRECTION, and it is worth being explicit
   * about why, because the alternative looks kinder. Treating an unreadable
   * session as "no user" sends people to /login — annoying during a blip.
   * Treating it as "carry on" would let a request through the signed-out gate
   * on the strength of a network error. One of those costs a sign-in; the
   * other is an authorisation hole. The `(app)` layout and RLS would still
   * refuse the actual data, but the gate must not be the thing that gives way.
   *
   * The refreshed `response` is returned regardless, so any cookie the refresh
   * did manage to set still travels.
   */
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (error) {
    // Not logError(): this module is the proxy, and lib/errors.ts is for
    // turning failures into sentences for a screen. There is no screen here.
    console.error("[proxy] session refresh failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  }

  // The client comes back too, so a caller can ask one more question — the
  // signed-in user's role, say — on the same refreshed session.
  return { response, user, supabase };
}
