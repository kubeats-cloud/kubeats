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
 * Optional: Mappls (formerly MapmyIndia) credentials for the area-name lookup.
 *
 * WHAT THIS BUYS. Nothing about the position itself — the coordinates and the
 * accuracy come from the device and are untouched by any of this. What it buys
 * is a better NAME for those coordinates in India, where Mappls's data is
 * considerably richer than OpenStreetMap's: a named colony or sector where
 * Nominatim often has only the city.
 *
 * ENTIRELY OPTIONAL, AND OPTIONAL IN THE STRONG SENSE. Return null here and the
 * app behaves exactly as it did before Mappls existed: /api/place goes straight
 * to Nominatim, which is free and needs no account at all. There is no degraded
 * mode, no warning banner and no feature that stops working. That is why this
 * is a function returning null rather than an entry in `serverSchema`, which
 * would refuse to boot without it.
 *
 * TWO CREDENTIAL SHAPES, because Mappls issues two and which one a given
 * account gets depends on when and how it was created:
 *
 *   client_credentials  MAPPLS_CLIENT_ID + MAPPLS_CLIENT_SECRET, exchanged for
 *                       a short-lived bearer token. This is what the current
 *                       console issues and the path to prefer.
 *   a REST key          MAPPLS_REST_KEY, dropped straight into the request
 *                       path with no token step. Older accounts have this.
 *
 * If both are present the REST key wins, because it is the shorter path and
 * cannot fail at a token step. Setting neither is the supported default.
 *
 * SERVER-ONLY, and it must stay that way: none of these names carries a
 * NEXT_PUBLIC_ prefix, so Next will not inline them into the browser bundle,
 * and nothing in src/components may read them. The lookup happens in the route
 * handler for exactly this reason.
 */
export interface MapplsCredentials {
  kind: "rest-key" | "oauth";
  restKey: string | null;
  clientId: string | null;
  clientSecret: string | null;
}

export function mapplsCredentials(): MapplsCredentials | null {
  const restKey = trimmed(process.env.MAPPLS_REST_KEY);
  if (restKey) {
    return { kind: "rest-key", restKey, clientId: null, clientSecret: null };
  }

  const clientId = trimmed(process.env.MAPPLS_CLIENT_ID);
  const clientSecret = trimmed(process.env.MAPPLS_CLIENT_SECRET);
  // Half a credential is not a credential. Say nothing and fall back, rather
  // than spending a request that is certain to be rejected.
  if (clientId && clientSecret) {
    return { kind: "oauth", restKey: null, clientId, clientSecret };
  }

  return null;
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
