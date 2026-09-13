import "server-only";
import { olaMapsKey } from "@/lib/env";
import { formatOlaPlace, type OlaResult } from "@/lib/places";
import { logError } from "@/lib/errors";

/**
 * Ola Maps reverse geocoding, for a better area name in India.
 *
 * WHAT THIS IS NOT. It is not a change to how a position is captured. The
 * coordinates and the accuracy still come from the device, through `bestFix()`,
 * exactly as before; nothing in this file can move a pin by a metre. All it
 * does is put a better NAME on coordinates that were already decided.
 *
 * WHY OLA AND NOT THE PROVIDER BEFORE IT. Mappls had comparable Indian data and
 * a free tier that turned out to be about fifty lookups, which is a day's work
 * for one rep and not a foundation for anything. Ola's free tier is measured in
 * hundreds of thousands of calls a month, and the shape of this file is the
 * shape that file already had — a server-side fetch behind a cache, allowed to
 * fail at every step — so swapping the provider cost the chain nothing. That
 * was the point of building it this way.
 *
 * SERVER-ONLY, AND THERE IS NO SDK. `import "server-only"` makes that a build
 * error rather than a code-review note, and the whole implementation is one
 * `fetch`, so the browser bundle does not grow by a byte. It matters more here
 * than it did before: Ola authenticates with a key in the QUERY STRING, so a
 * lookup made from the browser would hand the key to anyone with the network
 * tab open.
 *
 * SIMPLER THAN WHAT IT REPLACES, and that is worth saying out loud. One key, no
 * client id, no secret, no token exchange, no token cache, and therefore none
 * of the staleness handling that took two attempts to get right. Fewer moving
 * parts is most of the reason to prefer it.
 *
 * EVERYTHING HERE IS ALLOWED TO FAIL. No key, a rejected key, a timeout, a rate
 * limit, a response shaped differently than expected: every one of them returns
 * `{ ok: false }`, the route falls through to Nominatim, and if that fails too
 * the photo stamps with coordinates and time alone. This file must never be the
 * reason a rep standing at a school gate cannot finish their work.
 *
 * WHAT COULD NOT BE VERIFIED HERE, said plainly: the request and response
 * shapes are written from Ola's published Places API and have NOT been
 * exercised against a live account, because that needs a key this repository
 * does not have. The parsing is therefore deliberately loose — it reads the
 * components it recognises and ignores everything else, so a response that
 * differs in detail degrades to a shorter label or a clean `ok: false` rather
 * than a throw. `docs/OLA-MAPS-SETUP.md` has a one-command check to run once
 * the key exists, and `formatOlaPlace()` is the single function to adjust if
 * the live answer is shaped differently.
 */

const REVERSE_URL = "https://api.olamaps.io/places/v1/reverse-geocode";

/**
 * The Ola attempt gets this long.
 *
 * SMALL ON PURPOSE, and the number is not arbitrary. The browser aborts
 * `/api/place` after `PLACE_TIMEOUT_MS` (4s, in geolocate.ts), and the stamp
 * waits on it, so the WHOLE chain has to finish inside that. Ola gets 1.5s and
 * Nominatim keeps 2s, which together stay under the 3.5s budget the route has
 * always had. Adding a provider must not turn a 3.5s worst case into a 7s one.
 *
 * The predecessor spent part of this same 1.5s on a token exchange before it
 * could even ask. With one key and no token step, the whole slot belongs to the
 * lookup, so the identical budget is a more generous one than it was.
 */
export const OLA_TIMEOUT_MS = 1500;

/** As much of the reverse-geocode response as we read. */
interface ReverseResponse {
  results?: unknown;
}

/**
 * Whether Ola is configured at all.
 *
 * Exported so the route can skip the attempt entirely, and so the shape of the
 * fallback is testable without a network: with no key this is false,
 * `reverseGeocode` never fetches, and the chain is precisely what it was before
 * this file existed.
 */
export function olaConfigured(): boolean {
  return olaMapsKey() !== null;
}

/**
 * Coordinates to an area name, in the app's own label format.
 *
 * `{ ok: true, label }` with a null label is a real answer and means "asked,
 * nothing worth stamping there" — the same distinction `place_cache` keeps, and
 * the reason the route can remember it. `{ ok: false }` means "no answer",
 * which is never cached and always falls through to Nominatim.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  budgetMs: number = OLA_TIMEOUT_MS,
): Promise<{ ok: true; label: string | null } | { ok: false }> {
  const key = olaMapsKey();
  if (!key) return { ok: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);

  try {
    // `latlng` is one comma-joined pair, and the key rides in the query string
    // because that is what Ola's Places API takes. Both are encoded rather than
    // interpolated raw: the coordinates are numbers here, but a key is an
    // opaque string from an environment variable and must not be able to add a
    // parameter of its own.
    const url =
      `${REVERSE_URL}?latlng=${encodeURIComponent(`${latitude},${longitude}`)}` +
      `&api_key=${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    // Any non-2xx is "no answer": fall through, and never cache it as though it
    // were one. 429 in particular is Ola asking us to back off, exactly as
    // Nominatim's is. There is no token to invalidate here, which is one whole
    // class of bug this provider simply does not have.
    if (!response.ok) {
      logError("ola:reverse", new Error(`status ${response.status}`));
      return { ok: false };
    }

    const body = (await response.json()) as ReverseResponse | null;
    const results = Array.isArray(body?.results) ? body.results : [];
    const first = results.length > 0 ? (results[0] as OlaResult | null) : null;
    if (!first || typeof first !== "object") return { ok: false };

    return { ok: true, label: formatOlaPlace(first) };
  } catch (error) {
    // AbortError on timeout, TypeError when the network is unreachable, and a
    // SyntaxError if the body was not JSON after all.
    logError("ola:reverse", error);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
