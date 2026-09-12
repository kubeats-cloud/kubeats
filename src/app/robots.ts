import type { MetadataRoute } from "next";

/**
 * Keep every crawler out. KUbeats is a private internal tool for one sales
 * team, not a website.
 *
 * There is no Allow and no Sitemap line. A sitemap would be a list of an
 * internal app's routes published at a guessable URL, and we do not have one to
 * point at anyway.
 *
 * WHAT THIS DOES AND DOES NOT DO, because the two are easy to confuse:
 *
 *   robots.txt        asks a crawler not to FETCH a URL. Honoured by the big
 *                     engines, ignored by anything that does not care.
 *   X-Robots-Tag      tells a crawler not to INDEX what it fetched. Set on
 *                     every response in next.config.ts.
 *
 * Both are here on purpose, and the interaction has one wrinkle worth knowing:
 * a URL that is disallowed is never fetched, so the noindex header on it is
 * never seen — which is why a disallowed URL can still show up in an index as a
 * bare link if something external points at it. For a public marketing site the
 * right answer would be to ALLOW crawling and rely on noindex alone. Here it is
 * not, because there is nothing to index: `proxy.ts` turns every path except
 * /login, /privacy and /.well-known/security.txt into a redirect for anyone
 * without a session, so a URL-only listing would expose a path and no content.
 *
 * NEITHER OF THESE IS A SECURITY CONTROL. They are housekeeping. The boundary
 * is the auth gate in proxy.ts, the server-side check in the (app) layout, and
 * Row Level Security in Postgres — see CLAUDE.md. A crawler that ignores this
 * file gets exactly what any other anonymous stranger gets: the login screen.
 *
 * This is a Route Handler, so `proxy.ts`'s matcher has to exclude
 * `robots.txt` — otherwise the signed-out redirect catches it and a crawler
 * asking for our robots file is handed the login page instead. That is the same
 * trap manifest.webmanifest already documents there.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
