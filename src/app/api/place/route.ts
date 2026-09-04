import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeLookupContact } from "@/lib/env";
import { cellFor, formatPlace, type NominatimAddress } from "@/lib/places";
import { logError } from "@/lib/errors";

/**
 * Reverse geocoding for the photo stamp — cache first, then OpenStreetMap.
 *
 * Server-side on purpose, for three reasons. Nominatim's usage policy asks for
 * an identifying User-Agent, which a browser will not let us set. It asks that
 * you not hammer it, which we can only promise if the requests come from one
 * place we control. And doing it here means the answer lands in a shared cache,
 * so twenty reps working the same neighbourhoods ask the service once between
 * them rather than once each.
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
 * Short on purpose. The stamp waits for this, so it is a delay a rep feels;
 * better a photo with no area name than a photo they waited ten seconds for.
 */
const TIMEOUT_MS = 3500;

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
): Promise<{ ok: true; label: string | null } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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

  // 2. Ask OpenStreetMap.
  const result = await lookup(latitude, longitude);
  if (!result.ok) return miss("We could not name that area just now.");

  // 3. Remember the answer, including a definite "nothing here". A failure
  //    never reaches this line, so a timeout is not cached as an absence.
  const written = await db
    .from("place_cache")
    .upsert(
      { cell, label: result.label, latitude, longitude, cached_at: new Date().toISOString() },
      { onConflict: "cell" },
    );
  if (written.error) logError("place:cache-write", written.error);

  return NextResponse.json({
    ok: true as const,
    label: result.label,
    source: "openstreetmap" as const,
  });
}
