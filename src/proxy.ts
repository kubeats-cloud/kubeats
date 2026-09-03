import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
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
  const { response, user } = await updateSession(request);
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
