import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

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
 * Next.js 16 renamed middleware to proxy. Runs on every matched request to
 * refresh the session and steer signed-out traffic to the login screen.
 *
 * This is an *optimistic* gate, as the Next.js docs put it — it keeps people
 * out of the wrong place cheaply, but it is not the authorisation boundary.
 * The real checks are the `(app)` layout re-verifying the user server-side and,
 * underneath everything, Row Level Security in Postgres.
 */
export async function proxy(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

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
    return redirect;
  };

  // API routes answer for themselves. Redirecting a fetch() to an HTML login
  // page would hand the caller a 307 and a document where it expected JSON, so
  // the session is still refreshed above but the route decides the response.
  if (pathname.startsWith("/api/")) return response;

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

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and static files — those never need
     * a session refresh and would only add latency.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
