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
  const value = process.env.PLACE_LOOKUP_CONTACT;
  return value && value.trim() !== "" ? value.trim() : null;
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
