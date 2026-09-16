import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { publicEnv } from "@/lib/env";
import {
  MFA_VERIFY_PATH,
  isAdminOnlyPath,
  isAuthPath,
  isPublicPath,
  isRepOnlyPath,
} from "@/lib/nav";
import { challengeRequiredFor } from "@/lib/mfa";

/**
 * The role split, turned away here so each refusal is a real HTTP redirect.
 * Both lists live in lib/nav.ts, which is also what builds the navigation, so
 * a screen cannot appear in one role's bar and be reachable by the other.
 */



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

  if (!user && !isPublicPath(pathname)) {
    const intended = `${pathname}${search}`;
    const params =
      intended === "/" ? undefined : new URLSearchParams({ next: intended });
    return redirectTo("/login", params);
  }

  if (user && isAuthPath(pathname)) {
    return redirectTo("/");
  }

  /*
   * THE SECOND FACTOR, AND THIS IS WHERE IT IS ACTUALLY ENFORCED.
   *
   * `signInWithPassword()` hands back a REAL session before any code is typed.
   * It is AAL1, and it can read and write everything that user can. So the code
   * screen is not what stops an enrolled admin getting in — this is. Without
   * these few lines, closing the code screen and typing "/" in the address bar
   * walks around the whole feature, and MFA is decoration.
   *
   * It sits ABOVE the role gates deliberately. Those redirect to "/", so an
   * admin owing a code who asked for an admin path would be sent to "/" and
   * only then here — a second hop for no reason, and an ordering that would
   * quietly start mattering the day either rule grows a special case.
   *
   * COSTS NOTHING FOR THE PEOPLE IT DOES NOT APPLY TO. `challengeRequiredFor()`
   * asks about verified factors first, off the `getUser()` result the refresh
   * above already fetched, and returns false before reading any claims. A rep
   * and an un-enrolled admin therefore pay one boolean on an array that is
   * almost always empty.
   */
  if (user) {
    const owesCode = await challengeRequiredFor(supabase, user);
    const onVerify = pathname === MFA_VERIFY_PATH;

    // Owing a code: the code screen is the only page there is. Sign-out is a
    // server action posted to whatever page is open, so it keeps working from
    // there — which is the escape hatch for "wrong account" and for a lost
    // authenticator.
    if (owesCode && !onVerify) {
      const intended = `${pathname}${search}`;
      const params =
        intended === "/" ? undefined : new URLSearchParams({ next: intended });
      return redirectTo(MFA_VERIFY_PATH, params);
    }

    // Nothing to verify: either they finished, or they never had a factor. Not
    // an error, just a page with no purpose, so it behaves like /login does for
    // someone already signed in.
    if (!owesCode && onVerify) {
      return redirectTo("/");
    }
  }

  // /weekly became /targets when the screen grew daily and monthly periods.
  //
  // Answered here rather than by a page calling permanentRedirect(), for the
  // same reason the admin gate below moved here: by the time a page under
  // app/loading.tsx runs, the response has begun streaming and no redirect can
  // still set a status. That route returned 200 with the redirect buried in the
  // RSC payload, so a browser followed it but curl, a crawler and anything
  // without JavaScript did not - and a permanent redirect that only some
  // clients can see is not one.
  //
  // ?week= is carried straight through. It briefly became ?period=weekly&start=
  // while /targets offered a daily/weekly/monthly switcher; only the week is
  // committed to now, so the screen reads ?week= and the old translation would
  // hand it two parameters it ignores and drop the saved week on the floor. A
  // link saved when the screen was called Weekly lands on exactly the week it
  // used to, which is the whole point of this.
  if (pathname === "/weekly" || pathname.startsWith("/weekly/")) {
    const params = new URLSearchParams();
    const week = request.nextUrl.searchParams.get("week");
    if (week) params.set("week", week);
    const member = request.nextUrl.searchParams.get("member");
    if (member) params.set("member", member);
    return redirectTo("/targets", params);
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
  const wantsAdminArea = isAdminOnlyPath(pathname);
  const wantsRepArea = isRepOnlyPath(pathname);

  if (user && (wantsAdminArea || wantsRepArea)) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    // Least privilege: an unreadable profile is not an admin.
    const admin = data?.role === "admin";

    // An admin has no business on the fieldwork screens either. The gate runs
    // both ways because "log a visit" records a person standing somewhere, and
    // an admin at a desk was not there — letting them reach the form at all
    // invites a row that says otherwise.
    if (wantsAdminArea && !admin) return redirectTo("/");
    if (wantsRepArea && admin) return redirectTo("/");
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
     *
     * robots.txt is here for exactly that reason, one step further on. It is a
     * Route Handler (src/app/robots.ts), so without this exclusion the
     * signed-out redirect answers a crawler's request for our robots file with
     * the login page's HTML - and the file might as well not exist. A crawler
     * has no session to refresh either, so letting these requests reach our
     * code would only spend a Supabase call per probe.
     *
     * .well-known is excluded for the same reason plus one more: security.txt
     * has to be readable by a stranger, and it is fetched by scanners that
     * would otherwise make us refresh a session — and spend a Supabase call —
     * on every probe. Excluding it here means those requests never reach any
     * of our code.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|\.well-known/|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
