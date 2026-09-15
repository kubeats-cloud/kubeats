import { z } from "zod";

/**
 * Environment configuration.
 *
 * Values are validated the first time they are read and then cached. If
 * anything is missing or malformed we throw one readable error that names every
 * offending variable — never its value — so secrets stay out of logs, stack
 * traces and error pages.
 *
 * `NEXT_PUBLIC_*` variables are inlined by Next.js at build time, which only
 * works when `process.env.SOME_NAME` is written out literally. That is why the
 * raw values below are spelled out instead of read from a loop.
 */

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

const HELP =
  "Copy .env.example to .env.local and fill in the values from your Supabase " +
  "dashboard (Project Settings → API), then restart the server.";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

type PublicEnv = z.infer<typeof publicSchema>;
type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Validates `raw` against `schema`, reporting unset variables separately from
 * malformed ones so the message tells you which of the two problems you have.
 */
function parse<T extends z.ZodType>(
  schema: T,
  raw: Record<string, string | undefined>,
  scope: string,
): z.infer<T> {
  const unset = Object.keys(raw).filter((key) => {
    const value = raw[key];
    return value === undefined || value.trim() === "";
  });

  if (unset.length > 0) {
    throw new EnvError(
      `Missing ${scope} environment ${unset.length === 1 ? "variable" : "variables"}:\n` +
        unset.map((key) => `  - ${key} is not set`).join("\n") +
        `\n${HELP}`,
    );
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new EnvError(
      `Invalid ${scope} environment configuration:\n` +
        result.error.issues
          .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n") +
        `\n${HELP}`,
    );
  }

  return result.data;
}

let cachedPublic: PublicEnv | undefined;

/** Supabase URL + anon key. Safe to read in the browser and on the server. */
export function publicEnv(): PublicEnv {
  cachedPublic ??= parse(
    publicSchema,
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    "public",
  );
  return cachedPublic;
}

/**
 * Optional: a contact string for the User-Agent the place lookup sends to
 * OpenStreetMap, whose usage policy asks for one. Optional rather than
 * required because a deployment that never reaches Nominatim — a self-hosted
 * instance behind a firewall, say — should not fail to boot over a courtesy
 * header. Read here because this file is the only place that reads env.
 */
export function placeLookupContact(): string | null {
  return trimmed(process.env.PLACE_LOOKUP_CONTACT);
}

/** An optional variable that is set, or null. Blank counts as unset. */
function trimmed(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

/**
 * Optional: an Ola Maps API key for the area-name lookup.
 *
 * WHAT THIS BUYS. Nothing about the position itself — the coordinates and the
 * accuracy come from the device and are untouched by any of this. What it buys
 * is a better NAME for those coordinates in India, where Ola's data is
 * considerably richer than OpenStreetMap's: a named colony or sector where
 * Nominatim often has only the city.
 *
 * ENTIRELY OPTIONAL, AND OPTIONAL IN THE STRONG SENSE. Return null here and the
 * app behaves exactly as it did before any of this existed: /api/place goes
 * straight to Nominatim, which is free and needs no account at all. There is no
 * degraded mode, no warning banner and no feature that stops working. That is
 * why this is a function returning null rather than an entry in `serverSchema`,
 * which would refuse to boot without it.
 *
 * ONE CREDENTIAL, NOT TWO. Ola authenticates a Places request with a single API
 * key passed as a query parameter. That is the whole of it: no client id, no
 * secret, no token exchange, and therefore none of the token-staleness
 * machinery the previous provider needed. Ola does also offer OAuth project
 * credentials for other products; the Places API does not require them, and
 * adding that path would be a second way for this to fail silently.
 *
 * SERVER-ONLY, and it must stay that way: the name carries no NEXT_PUBLIC_
 * prefix, so Next will not inline it into the browser bundle, and nothing in
 * src/components may read it. A key in a query string is a key anyone watching
 * the browser's network tab can copy, which is the whole reason the lookup
 * happens in the route handler.
 */
export function olaMapsKey(): string | null {
  return trimmed(process.env.OLA_MAPS_API_KEY);
}

/**
 * Optional: a shared secret that unlocks the deep (database-touching) answer
 * from /api/health.
 *
 * That endpoint is deliberately public — a monitor has to reach it without a
 * session — which is exactly why the public answer is static. Anyone can poll
 * it, so it must not spend a database round trip or disclose whether Postgres
 * is reachable. Set this and a monitor presenting the header gets the real
 * check; leave it unset and the deep check simply does not exist.
 *
 * Optional rather than required for the same reason as the contact above: a
 * deployment should not fail to boot over a monitoring convenience.
 */
export function healthCheckToken(): string | null {
  return trimmed(process.env.HEALTH_CHECK_TOKEN);
}

/**
 * Optional: the commit this bundle was built from.
 *
 * WHAT IT IS FOR. Answering "is the new build live?" from outside. Every stage
 * of the Phase 2 rework changes screens that sit behind auth, so there is
 * nothing on the public surface that differs between two builds — and verifying
 * a deploy by comparing content-hashed chunk names does not work either,
 * because those hashes are not reproducible between a developer's machine and
 * the client's builder. This is the one-line answer instead.
 *
 * DEEP ANSWER ONLY. It is returned by /api/health to a caller that presents
 * HEALTH_CHECK_TOKEN, and never in the public `{"ok":true}`. That split is the
 * pen-test F2 finding and it is not weakened here: the anonymous response still
 * touches nothing and still discloses nothing. A build identifier tells a
 * stranger which commit to go and read, which is a small thing to give away and
 * an unnecessary one.
 *
 * PORTABLE ON PURPOSE. The name is generic. Nothing in `src/` may read
 * `CF_PAGES_COMMIT_SHA`, `WORKERS_CI_COMMIT_SHA`, `VERCEL_GIT_COMMIT_SHA` or
 * any other platform's spelling — that is exactly what CLAUDE.md's portability
 * rule forbids. The platform maps ITS variable onto this one in the build
 * command, which is config rather than code.
 *
 * ⚠ IT MUST GO INTO AN ENV *FILE*, NOT JUST THE SHELL. This was verified rather
 * than assumed, because the obvious form does not work:
 *
 *     APP_COMMIT_SHA=$WORKERS_CI_COMMIT_SHA npm run build      ✗ never arrives
 *
 * The OpenNext adapter inlines the environment into
 * `.open-next/cloudflare/next-env.mjs`, and what it inlines is what **Next
 * loaded from `.env*` files** — not arbitrary shell variables. A shell-only
 * value is present while the build runs and absent from the bundle, so the
 * field would read null in production and nowhere would say why. Write it to a
 * file Next loads instead:
 *
 *     echo "APP_COMMIT_SHA=$WORKERS_CI_COMMIT_SHA" >> .env.production.local
 *     npm run build                                            ✓ verified
 *
 * NOT in wrangler.jsonc. That file says, at length, that it must never grow a
 * `vars` block, because Workers Builds prints plaintext vars into the build log.
 *
 * So it is baked in at BUILD time and needs no runtime binding — the same
 * mechanism the wrangler comment warns about for the service-role key. A commit
 * SHA is not a secret, and it is behind the token anyway.
 *
 * Optional, like the two above: a deployment must not fail to boot over a
 * monitoring convenience. Unset simply means the deep answer omits it.
 */
export function appCommitSha(): string | null {
  return trimmed(process.env.APP_COMMIT_SHA);
}

let cachedServer: ServerEnv | undefined;

/**
 * Server-only secrets. Throws if it is ever reached from browser code, which
 * would mean the service-role key had been bundled for the client.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new EnvError(
      "serverEnv() was called in the browser. Server-only secrets must never " +
        "reach client code — import this from a server component, server " +
        "action or route handler instead.",
    );
  }

  cachedServer ??= parse(
    serverSchema,
    { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY },
    "server",
  );
  return cachedServer;
}
