import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeLookupContact } from "@/lib/env";
import { cellFor, formatPlace, type NominatimAddress } from "@/lib/places";
import {
  OLA_TIMEOUT_MS,
  olaConfigured,
  reverseGeocode as olaReverseGeocode,
} from "@/lib/ola";
import { logError } from "@/lib/errors";

/**
 * Reverse geocoding for the photo stamp: cache, then Ola Maps, then OpenStreetMap.
 *
 * THE CHAIN, and every step of it is allowed to fail:
 *
 *   1. place_cache   a hit answers without touching anybody's API, including a
 *                    remembered "nothing there".
 *   2. Ola Maps      better names in India, and only when a key is set.
 *   3. Nominatim     free, no account, and exactly what ran here before.
 *   4. nothing       the photo stamps with coordinates and time alone.
 *
 * WITH NO OLA KEY SET THIS IS THE OLD ROUTE, step for step. Step 2 is skipped
 * without a fetch, Nominatim keeps its full timeout, and the answer is
 * identical. That is the supported default, not a degraded one.
 *
 * STEP 2 IS A SLOT, NOT A PROVIDER. It held Mappls first, whose free tier
 * turned out to be about fifty lookups a month; swapping in Ola changed this
 * file by four lines and the rest of the chain not at all, which is what the
 * shape was for. Whatever occupies the slot next has the same contract: return
 * a label in the app's own format, or say nothing and get out of the way.
 *
 * Server-side on purpose, for four reasons now. Nominatim's usage policy asks
 * for an identifying User-Agent, which a browser will not let us set. It asks
 * that you not hammer it, which we can only promise if the requests come from
 * one place we control. Doing it here means the answer lands in a shared cache,
 * so twenty reps working the same neighbourhoods ask once between them rather
 * than once each. And the Ola key is a server-only secret that must never be
 * inlined into the browser bundle — it travels in a QUERY STRING, so a lookup
 * made from the browser would hand it to anyone with the network tab open,
 * which is also why there is no Ola SDK anywhere in this repository.
 *
 * NONE OF THIS TOUCHES THE POSITION. The coordinates and the accuracy come from
 * the device and are already decided by the time anything here runs; all this
 * decides is what the place is CALLED.
 *
 * POST rather than GET with the coordinates in the path: this is somebody's
 * live location, and a URL ends up in access logs and browser history. The body
 * does not.
 *
 * Every failure path returns 200 with `ok: false`. A missing area name is not
 * an error — the photo still stamps with its coordinates and time, and the
 * visit still saves. Nothing here is allowed to become a reason a rep standing
 * at a school gate cannot finish their work.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

/**
 * The WHOLE route, both providers included, gets this long.
 *
 * Short on purpose. The stamp waits for this, so it is a delay a rep feels;
 * better a photo with no area name than a photo they waited ten seconds for.
 * The browser gives up at PLACE_TIMEOUT_MS (4s, geolocate.ts), so this has to
 * stay under it.
 *
 * ADDING A SECOND PROVIDER DID NOT ADD A SECOND TIMEOUT. That would have been
 * the easy mistake: 3.5s for Ola plus 3.5s for Nominatim is a 7s worst case,
 * the browser aborts at 4s, and every photo taken somewhere Ola is slow would
 * wait longer and then get nothing at all. Instead the existing budget is
 * SPLIT — 1.5s for Ola, the remainder for Nominatim — so the worst case is
 * exactly what it was before.
 */
const TIMEOUT_MS = 3500;

/** What is left for Nominatim after a full-length Ola attempt. */
const NOMINATIM_TIMEOUT_MS = TIMEOUT_MS - OLA_TIMEOUT_MS;

const coordsSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

function miss(message: string) {
  // Deliberately 200: an expected outcome the caller handles by omitting a
  // line, not an error the browser should treat as a failed request.
  return NextResponse.json({ ok: false as const, message });
}

/**
 * The User-Agent Nominatim asks for. A contact is part of their policy; it is
 * optional here rather than required because a self-hosted deployment that
 * never reaches Nominatim should not fail to boot over it.
 */
function userAgent(): string {
  const contact = placeLookupContact();
  return contact ? `KUbeats/1.0 (+${contact})` : "KUbeats/1.0";
}

async function lookup(
  latitude: number,
  longitude: number,
  budgetMs: number,
): Promise<{ ok: true; label: string | null } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);

  try {
    const url =
      `${NOMINATIM}?format=jsonv2&zoom=16&addressdetails=1` +
      `&lat=${encodeURIComponent(String(latitude))}&lon=${encodeURIComponent(String(longitude))}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      cache: "no-store",
    });

    // 429 is Nominatim asking us to back off. Treat it as "no answer this
    // time" and, crucially, do not cache it as if it were one.
    if (!response.ok) return { ok: false };

    const body = (await response.json()) as { address?: NominatimAddress } | null;
    // A successful response with nothing useful in it is still an answer: it is
    // worth remembering so we stop asking about the middle of a field.
    return { ok: true, label: formatPlace(body?.address) };
  } catch (error) {
    // AbortError on timeout, TypeError when the network is unreachable.
    logError("place:nominatim", error);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  // Signed-in callers only: this reaches an external service and writes to our
  // tables, so it must not be an open proxy for anyone's geocoding.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false as const, message: "Please sign in again." },
      { status: 401 },
    );
  }

  let parsed;
  try {
    parsed = coordsSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false as const, message: "Send a latitude and a longitude." },
      { status: 400 },
    );
  }
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false as const, message: "Send a latitude and a longitude." },
      { status: 400 },
    );
  }

  const { latitude, longitude } = parsed.data;
  const cell = cellFor(latitude, longitude);
  const db = createAdminClient();

  // 1. Cache. A row with a null label means "asked, nothing there" — still a
  //    hit, and still a reason not to ask again.
  const cached = await db
    .from("place_cache")
    .select("label")
    .eq("cell", cell)
    .maybeSingle();

  if (cached.error) {
    // Most likely 0007 has not been run. Carry on to the service; the only
    // thing lost is the caching, and the stamp does not care.
    logError("place:cache-read", cached.error);
  } else if (cached.data) {
    return NextResponse.json({
      ok: true as const,
      label: cached.data.label,
      source: "cache" as const,
    });
  }

  // 2. Ask Ola Maps, if the client has given us a key. Skipped entirely
  //    otherwise, so an unconfigured deployment spends no time here at all and
  //    Nominatim below keeps the whole budget.
  const configured = olaConfigured();
  const startedAt = Date.now();
  let result: { ok: true; label: string | null } | { ok: false } = { ok: false };
  let source: "ola" | "openstreetmap" = "ola";

  if (configured) {
    result = await olaReverseGeocode(latitude, longitude, OLA_TIMEOUT_MS);
  }

  // 3. Fall back to OpenStreetMap. This runs whenever Ola had nothing to say,
  //    for ANY reason: no key, a refused key, a timeout, a rate limit, an
  //    unrecognised response. It gets whatever is left of the budget, and never
  //    less than its own share.
  if (!result.ok) {
    source = "openstreetmap";
    const spent = configured ? Date.now() - startedAt : 0;
    result = await lookup(
      latitude,
      longitude,
      Math.max(NOMINATIM_TIMEOUT_MS, TIMEOUT_MS - spent),
    );
  }

  // 4. Nobody could name it. Not an error: the caller omits the line, the photo
  //    still carries its coordinates and time, and the visit still saves.
  if (!result.ok) return miss("We could not name that area just now.");

  // 5. Remember the answer, including a definite "nothing here". A failure
  //    never reaches this line, so a timeout is not cached as an absence.
  //    The label is stored WITHOUT recording which service produced it: both
  //    write the same format, and a cache keyed on the answer rather than on
  //    its source is what lets credentials be added or removed later without
  //    invalidating a single row.
  const written = await db
    .from("place_cache")
    .upsert(
      { cell, label: result.label, latitude, longitude, cached_at: new Date().toISOString() },
      { onConflict: "cell" },
    );
  if (written.error) logError("place:cache-write", written.error);

  return NextResponse.json({ ok: true as const, label: result.label, source });
}
