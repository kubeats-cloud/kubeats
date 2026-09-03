import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureAreas,
  ensureCity,
  ensureState,
  type AreaNode,
} from "@/lib/locations";
import { logError } from "@/lib/errors";

/**
 * Rule 13 — PIN code lookup.
 *
 * Cache first, then India Post, then remember the answer. The lookup is a
 * convenience that must never become an obstacle: every failure path returns a
 * friendly message with 200 and `ok: false`, so the form can quietly fall back
 * to the manual cascading picker instead of showing a rep an error.
 *
 * The write side uses the service-role client because a new PIN may introduce a
 * state or city, and rule 11 only opens *areas* to non-admins.
 */

const PIN_PATTERN = /^[0-9]{6}$/;
const INDIA_POST = "https://api.postalpincode.in/pincode";
const TIMEOUT_MS = 5000;

interface PostOffice {
  Name?: string;
  District?: string;
  State?: string;
}

interface IndiaPostEntry {
  Status?: string;
  PostOffice?: PostOffice[] | null;
}

interface Resolved {
  state: string;
  district: string;
  localities: string[];
}

function fail(message: string) {
  // Deliberately 200: this is a normal, expected outcome the form handles by
  // falling back, not an error the browser should treat as a failed request.
  return NextResponse.json({ ok: false as const, message });
}

async function fetchFromIndiaPost(code: string): Promise<Resolved | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${INDIA_POST}/${code}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as IndiaPostEntry[] | null;
    const entry = Array.isArray(body) ? body[0] : null;
    if (!entry || entry.Status !== "Success") return null;

    const offices = entry.PostOffice ?? [];
    const first = offices[0];
    if (!first?.State || !first?.District) return null;

    return {
      state: first.State.trim(),
      district: first.District.trim(),
      localities: [
        ...new Set(
          offices
            .map((o) => o.Name?.trim())
            .filter((n): n is string => Boolean(n)),
        ),
      ],
    };
  } catch (error) {
    // AbortError on timeout, TypeError when offline. Both are expected.
    logError("pincode:india-post", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  // Signed-in callers only — this endpoint reaches an external service and
  // writes to our tables, so it must not be an open proxy.
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

  const { code } = await params;
  if (!PIN_PATTERN.test(code)) {
    return NextResponse.json(
      { ok: false as const, message: "A PIN code is exactly 6 digits." },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // 1. Cache.
  let resolved: Resolved | null = null;
  let source: "cache" | "india-post" = "cache";

  const cached = await db
    .from("pincodes_cache")
    .select("state, district, localities")
    .eq("pincode", code)
    .maybeSingle();

  if (cached.error) logError("pincode:cache-read", cached.error);

  if (cached.data?.state && cached.data?.district) {
    resolved = {
      state: cached.data.state,
      district: cached.data.district,
      localities: cached.data.localities ?? [],
    };
  }

  // 2. India Post on a miss.
  if (!resolved) {
    source = "india-post";
    resolved = await fetchFromIndiaPost(code);

    if (!resolved) {
      return fail(
        "We could not look up that PIN code just now. Please choose the location manually.",
      );
    }

    const { error } = await db.from("pincodes_cache").upsert(
      {
        pincode: code,
        state: resolved.state,
        district: resolved.district,
        localities: resolved.localities,
      },
      { onConflict: "pincode" },
    );
    if (error) logError("pincode:cache-write", error);
  }

  // 3. Fold the answer into the locations tree so the picker can offer it.
  const state = await ensureState(db, resolved.state);
  if (!state) {
    return fail("We could not save that location. Please choose it manually.");
  }

  const city = await ensureCity(db, state.id, resolved.district);
  if (!city) {
    return fail("We could not save that location. Please choose it manually.");
  }

  let areas: AreaNode[] = [];
  try {
    areas = await ensureAreas(db, city.id, resolved.localities);
  } catch (error) {
    logError("pincode:areas", error);
  }

  // `state` and `city` carry the names as stored, not as India Post spelled
  // them, so the form fills in and submits the spelling the rest of the data
  // already uses.
  return NextResponse.json({
    ok: true as const,
    pincode: code,
    source,
    state,
    city,
    areas,
  });
}
