import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { publicEnv } from "@/lib/env";

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login"];

/** Admin-only areas, turned away here so the refusal is a real HTTP redirect. */
const ADMIN_PATHS = ["/settings"];

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPublic(pathname: string): boolean {
  return matches(pathname, PUBLIC_PATHS);
}

/**
 * Content-Security-Policy, built per request around a fresh nonce.
 *
 * Written here rather than in next.config.ts because the nonce has to change
 * every request and be handed to the render: Next stamps its own script tags
 * with whatever `x-nonce` says. With `strict-dynamic`, scripts those trusted
 * scripts load are trusted too, so no bundle path has to be listed.
 *
 * The relaxations are deliberate and each has a reason:
 *   style-src 'unsafe-inline'  Radix and our progress bar set style attributes
 *   img-src blob: data:        the stamped photo preview before it is uploaded
 *   connect-src <supabase>     auth, PostgREST and the photo upload
 * Development additionally needs 'unsafe-eval' and a websocket for hot reload.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  const supabase = new URL(NEXT_PUBLIC_SUPABASE_URL).origin;

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}${dev ? " ws: http://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Next.js 16 renamed middleware to proxy. Runs on every matched request to
 * refresh the session and steer signed-out traffic to the login screen.
 *
 * This is an *optimistic* gate, as the Next.js docs put it — it keeps people
 * out of the wrong place cheaply, but it is not the authorisation boundary.
 * The real checks are the `(app)` layout re-verifying the user server-side and,
 * underneath everything, Row Level Security in Postgres.
 */
export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = contentSecurityPolicy(nonce);

  const { response, user, supabase } = await updateSession(request, {
    "x-nonce": nonce,
    "content-security-policy": csp,
  });
  const { pathname, search } = request.nextUrl;

  /** Every response leaving here carries the policy, redirects included. */
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // Carry any cookies the refresh just set onto the redirect, or the rotated
  // token is dropped and the next request has to refresh all over again.
  const redirectTo = (target: string, searchParams?: URLSearchParams) => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = searchParams ? `?${searchParams}` : "";
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return withCsp(redirect);
  };

  // API routes answer for themselves. Redirecting a fetch() to an HTML login
  // page would hand the caller a 307 and a document where it expected JSON, so
  // the session is still refreshed above but the route decides the response.
  if (pathname.startsWith("/api/")) return withCsp(response);

  if (!user && !isPublic(pathname)) {
    const intended = `${pathname}${search}`;
    const params =
      intended === "/" ? undefined : new URLSearchParams({ next: intended });
    return redirectTo("/login", params);
  }

  if (user && isPublic(pathname)) {
    return redirectTo("/");
  }

  // Admin-only areas.
  //
  // The page checks this for itself as well, but by the time a dynamic page
  // runs, the response has begun streaming: neither notFound() nor redirect()
  // can still set a status, so Next answers 200 and steers the browser from
  // inside the payload. No admin content is served either way, but "200 OK" on
  // a refusal is a poor answer to give a security review. Here the session is
  // already loaded, so one more query buys a genuine 307 — and it costs that
  // query only on requests that ask for an admin path.
  if (user && matches(pathname, ADMIN_PATHS)) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    // Least privilege: an unreadable profile is not an admin.
    if (data?.role !== "admin") return redirectTo("/");
  }

  return withCsp(response);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and static files — those never need
     * a session refresh and would only add latency.
     *
     * manifest.webmanifest is on that list for a reason worth remembering: the
     * browser fetches it without credentials, so the signed-out redirect caught
     * it and handed back the login page's HTML. Chrome then reported
     * "Manifest: Line 1, column 1, Syntax error", which says nothing at all
     * about the actual cause.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
