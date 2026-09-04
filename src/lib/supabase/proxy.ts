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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The client comes back too, so a caller can ask one more question — the
  // signed-in user's role, say — on the same refreshed session.
  return { response, user, supabase };
}
