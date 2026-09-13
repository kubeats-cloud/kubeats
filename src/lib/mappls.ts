import "server-only";
import { mapplsCredentials, type MapplsCredentials } from "@/lib/env";
import { formatMapplsPlace, type MapplsAddress } from "@/lib/places";
import { logError } from "@/lib/errors";

/**
 * Mappls (formerly MapmyIndia) reverse geocoding, for a better area name in India.
 *
 * WHAT THIS IS NOT. It is not a change to how a position is captured. The
 * coordinates and the accuracy still come from the device, through
 * `bestFix()`, exactly as before; nothing in this file can move a pin by a
 * metre. All it does is put a better NAME on coordinates that were already
 * decided. The reason it is worth having is data quality in India, where
 * Mappls knows colonies, sectors and blocks that OpenStreetMap often has only
 * as a city.
 *
 * SERVER-ONLY, AND THERE IS NO SDK. `import "server-only"` makes that a build
 * error rather than a code-review note, and the whole implementation is two
 * `fetch` calls, so the browser bundle does not grow by a byte. A Mappls
 * JavaScript SDK exists; it is not used and must not be, both for the bundle
 * and because the credentials below would then be in the browser.
 *
 * EVERYTHING HERE IS ALLOWED TO FAIL. No credentials, a rejected token, a
 * timeout, a rate limit, a response shaped differently than expected: every
 * one of them returns `{ ok: false }`, the route falls through to Nominatim,
 * and if that fails too the photo stamps with coordinates and time alone. This
 * file must never be the reason a rep standing at a school gate cannot finish
 * their work — the same rule migration 0007 states about the cache table, and
 * the reason `/api/place` answers 200 even when it has nothing to say.
 *
 * WHAT COULD NOT BE VERIFIED HERE, said plainly: the request and response
 * shapes below are written from Mappls's published API and have NOT been
 * exercised against a live account, because that needs paid credentials this
 * repository does not have. The parsing is therefore deliberately loose — it
 * reads the fields it recognises and ignores everything else, so a response
 * that differs in detail degrades to a shorter label or a clean `ok: false`
 * rather than a throw. `docs/MAPMYINDIA-SETUP.md` has a one-command check to
 * run once the client's key exists, and names the two lines to adjust if their
 * account answers with different field names.
 */

/** Exchanges client_id + client_secret for a bearer token. */
const TOKEN_URL = "https://outpost.mappls.com/api/security/oauth/token";

/** Reverse geocode. The token or REST key goes in the path, not a header. */
const REVERSE_URL = "https://apis.mappls.com/advancedmaps/v1";

/**
 * The whole Mappls attempt, token step included, gets this long.
 *
 * SMALL ON PURPOSE, and the number is not arbitrary. The browser aborts
 * `/api/place` after `PLACE_TIMEOUT_MS` (4s, in geolocate.ts), and the stamp
 * waits on it, so the WHOLE chain has to finish inside that. Mappls gets 1.5s
 * and Nominatim keeps 2s, which together stay under the 3.5s budget the route
 * has always had. Adding a provider must not turn a 3.5s worst case into a 7s
 * one: that would not fail safely, it would make every photo slower and then
 * time out in the browser anyway.
 */
export const MAPPLS_TIMEOUT_MS = 1500;

/** How early to treat a token as expired, so one is never used on its last breath. */
const TOKEN_SKEW_MS = 60_000;

/** As much of the token response as we read. Everything else is ignored. */
interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

/** As much of the reverse-geocode response as we read. */
interface ReverseResponse {
  results?: unknown;
}

interface CachedToken {
  token: string;
  /** Epoch milliseconds, already reduced by TOKEN_SKEW_MS. */
  expiresAt: number;
}

/**
 * The token, kept for as long as this isolate lives.
 *
 * BEST-EFFORT BY DESIGN. On Workers an isolate is short-lived and there may be
 * many at once, so this is not one token per day across the fleet — it is one
 * per isolate that actually needs one. That is acceptable because of what sits
 * in front of it: `place_cache` answers the overwhelming majority of lookups
 * without reaching this file at all, so a token is only ever fetched on a cache
 * MISS, which is a rep standing somewhere the team has not been before.
 *
 * If that ever stops being true — a much larger team, or a much wider patch —
 * the extension point is a `mappls_token` row in Postgres rather than a longer
 * timeout here. It is deliberately NOT done now: it would mean storing a live
 * bearer token in a table, which is a real secret in a new place, to save a
 * request that is currently rare.
 */
let cached: CachedToken | null = null;

/** Visible for tests, and for anyone who needs to force a fresh token. */
export function forgetMapplsToken(): void {
  cached = null;
}

/** One fetch with a deadline, returning null instead of throwing. Ever. */
async function fetchWithin(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  scope: string,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    // AbortError on timeout, TypeError when the network is unreachable.
    logError(scope, error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A bearer token, from the cache or freshly minted.
 *
 * Null on any failure, which the caller reads as "use the other service". A
 * rejected credential is not retried within the request: there is no reason to
 * think the second attempt would go better, and the time belongs to Nominatim.
 */
async function accessToken(
  credentials: MapplsCredentials,
  budgetMs: number,
): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId ?? "",
    client_secret: credentials.clientSecret ?? "",
  });

  const response = await fetchWithin(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    },
    budgetMs,
    "mappls:token",
  );

  if (!response || !response.ok) {
    // A 401 here means the credentials are wrong, which is worth a log line and
    // is still not worth failing the request over.
    if (response) logError("mappls:token", new Error(`token status ${response.status}`));
    return null;
  }

  let parsed: TokenResponse | null = null;
  try {
    parsed = (await response.json()) as TokenResponse | null;
  } catch (error) {
    logError("mappls:token-parse", error);
    return null;
  }

  const token = typeof parsed?.access_token === "string" ? parsed.access_token : null;
  if (!token) return null;

  // Mappls documents expires_in in seconds and typically returns about a day.
  // A missing or nonsensical value falls back to a conservative ten minutes
  // rather than being trusted or rejected.
  const seconds =
    typeof parsed?.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : 600;
  const lifetimeMs = Math.max(0, seconds * 1000 - TOKEN_SKEW_MS);
  cached = { token, expiresAt: Date.now() + lifetimeMs };

  return token;
}

/**
 * Whether Mappls is configured at all.
 *
 * Exported so the route can skip the attempt entirely, and so the shape of the
 * fallback is testable without a network: with nothing set this is false,
 * `reverseGeocode` never fetches, and the chain is precisely what it was before
 * this file existed.
 */
export function mapplsConfigured(): boolean {
  return mapplsCredentials() !== null;
}

/**
 * Coordinates to an area name, in the app's own label format.
 *
 * `{ ok: true, label }` with a null label is a real answer and means "asked,
 * nothing worth stamping there" — the same distinction `place_cache` keeps, and
 * the reason the route can remember it. `{ ok: false }` means "no answer",
 * which is never cached and always falls through to the next provider.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  budgetMs: number = MAPPLS_TIMEOUT_MS,
): Promise<{ ok: true; label: string | null } | { ok: false }> {
  const credentials = mapplsCredentials();
  if (!credentials) return { ok: false };

  const startedAt = Date.now();

  let pathKey: string | null;
  if (credentials.kind === "rest-key") {
    pathKey = credentials.restKey;
  } else {
    // The token step shares the budget with the lookup; whatever it does not
    // spend, the lookup gets.
    pathKey = await accessToken(credentials, budgetMs);
  }
  if (!pathKey) return { ok: false };

  const remaining = budgetMs - (Date.now() - startedAt);
  if (remaining <= 100) return { ok: false };

  const url =
    `${REVERSE_URL}/${encodeURIComponent(pathKey)}/rev_geocode` +
    `?lat=${encodeURIComponent(String(latitude))}&lng=${encodeURIComponent(String(longitude))}`;

  const response = await fetchWithin(
    url,
    { headers: { Accept: "application/json" } },
    remaining,
    "mappls:reverse",
  );

  if (!response) return { ok: false };

  // A 401 means the token went stale early; drop it so the next request mints a
  // fresh one rather than reusing a dead one until its nominal expiry.
  if (response.status === 401) {
    forgetMapplsToken();
    return { ok: false };
  }
  // 429 is Mappls asking us to back off, and like Nominatim's it must not be
  // cached as though it were an answer.
  if (!response.ok) return { ok: false };

  let body: ReverseResponse | null = null;
  try {
    body = (await response.json()) as ReverseResponse | null;
  } catch (error) {
    logError("mappls:parse", error);
    return { ok: false };
  }

  const results = Array.isArray(body?.results) ? body.results : [];
  const first = results.length > 0 ? (results[0] as MapplsAddress | null) : null;
  if (!first || typeof first !== "object") return { ok: false };

  return { ok: true, label: formatMapplsPlace(first) };
}
