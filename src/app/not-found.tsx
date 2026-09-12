import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Page not found" };

/**
 * The 404 for a URL that matches no route at all.
 *
 * THIS IS NOT THE SAME FILE AS `(app)/not-found.tsx`, and both are needed.
 * That one handles `notFound()` thrown INSIDE the app group — a missing
 * institute id, a rep reaching an admin route — and it renders inside the app
 * shell, with the nav bar still there, because the person seeing it is signed
 * in and mid-task. This one answers an unmatched URL, renders in the root
 * layout, and assumes nothing: no session, no profile, no navigation.
 *
 * Before this file existed, an unmatched URL fell through to Next's own
 * default — a bare "404: This page could not be found." on a white page, with
 * no indication it was even our app. Verified on the live deployment rather
 * than assumed, by asking for a path the proxy matcher excludes so Next
 * answered it directly.
 *
 * WHERE IT IS ACTUALLY REACHABLE, which is narrower than it looks:
 *
 *   signed in, unknown path     yes — proxy.ts passes the request through and
 *                               this renders with a real 404 status
 *   any visitor, a path the     yes — those bypass the proxy entirely, so a
 *   matcher excludes            dead image or font link lands here
 *   signed OUT, unknown path    NO — proxy.ts redirects to /login first
 *
 * That last row is deliberate and was left alone. Letting a signed-out
 * stranger tell "no such page" apart from "page you may not see" would turn
 * this screen into a route-enumeration oracle for a private app: probe a URL,
 * read the status, learn whether it exists. One redirect for everything
 * unknown-or-protected leaks nothing, and a signed-out visitor has no
 * legitimate use for a 404 here — there is nothing for them to navigate back
 * to. If that trade is ever revisited, it is an exemption list in proxy.ts and
 * this file does not change.
 *
 * No session lookup on purpose. It must render for a signed-out visitor on a
 * matcher-excluded path, and a 404 that itself needs a database call is a 404
 * that can fail.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image
            src="/brand/kubeats-logo-transparent.png"
            alt="KUbeats — For a smarter KU"
            width={600}
            height={446}
            className="h-auto w-40 max-w-full"
          />
          <span aria-hidden className="brand-rule mt-5 h-1 w-24 rounded-full" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Page not found</CardTitle>
            <CardDescription>
              We could not find that page. It may have moved, or it may not be
              available to your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="h-11 w-full">
              <Link href="/">Back to KUbeats</Link>
            </Button>
          </CardContent>
        </Card>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          If you followed a link from inside the app and expected something to
          be here, tell your administrator.
        </p>
      </div>
    </main>
  );
}
