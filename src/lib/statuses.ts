import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import {
  SEED_STATUS_CATALOGUE,
  STATUS_CATEGORIES,
  STATUS_TONES,
  type StatusCatalogue,
  type StatusCategory,
  type StatusRow,
  type StatusTone,
} from "@/lib/validation/institute";

/**
 * The status vocabulary, read from the database rather than from a constant.
 *
 * Migration 0026 converted `institutes.status` and `visits.status_set_to` from
 * CHECK constraints listing nine literals into foreign keys to
 * `public.institute_statuses`. The database now states the vocabulary once, and
 * an admin can extend it — so the app has to ask rather than assume. This is
 * where it asks, and it is the only place that does.
 *
 * READABLE BY EVERYONE. `institute_statuses_select` is `using (true)`: it is a
 * vocabulary, not anyone's data, and a rep needs it to render a badge. Writing
 * one is admin-only and arrives with the panel in stage 4b.
 *
 * NOT CACHED, deliberately. Every screen that needs it is already dynamic — the
 * whole app is — and ten rows on a request that is fetching visits anyway is
 * not the thing to optimise. A stale cache here would mean a rep being offered
 * a status an admin retired this morning, which is exactly the drift this
 * migration set exists to end.
 */
export async function listStatusCatalogue(): Promise<StatusCatalogue> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institute_statuses")
    .select(
      "status, category, tone, sort_order, is_active, asks_expected_date, asks_session_detail, asks_head_count",
    )
    .order("sort_order")
    .order("status");

  if (error) {
    /**
     * FALL BACK TO THE SEED RATHER THAN TO NOTHING.
     *
     * An empty catalogue is not a neutral failure: the status picker would be
     * blank, `isOpenStatus()` would answer false for everything, and a rep
     * standing in a school would be told their perfectly good visit has an
     * unknown status. The nine seeded values are correct for every database
     * this app has ever had, so they are a far better wrong answer than none.
     *
     * A status an admin added would be missing from the fallback, and a visit
     * carrying one would render its badge as "no status yet" until the read
     * recovers. That is the cost, and it is smaller than the alternative.
     */
    logError("statuses:list", error);
    return SEED_STATUS_CATALOGUE;
  }

  const rows = (data ?? []).map(toRow).filter((row): row is StatusRow => row !== null);

  // An empty table would be a database nobody seeded. Same reasoning as above:
  // nine right answers beat zero.
  return rows.length > 0 ? rows : SEED_STATUS_CATALOGUE;
}

/**
 * One row, or null if the database holds something this app cannot render.
 *
 * Both vocabularies are CHECK-constrained in the database, so neither branch
 * should ever fire. They are here because this is the boundary where untyped
 * data becomes typed, and a row with a category of "maybe" would otherwise
 * become a status that is neither open nor closed — silently, and everywhere.
 */
function toRow(raw: {
  status: string;
  category: string;
  tone: string | null;
  sort_order: number | null;
  is_active: boolean | null;
  asks_expected_date: boolean | null;
  asks_session_detail: boolean | null;
  asks_head_count: boolean | null;
}): StatusRow | null {
  if (!(STATUS_CATEGORIES as readonly string[]).includes(raw.category)) {
    logError("statuses:category", {
      message: `status ${raw.status} has category ${raw.category}`,
    });
    return null;
  }

  return {
    status: raw.status,
    category: raw.category as StatusCategory,
    // An unrecognised tone is a rendering question, not a correctness one, so
    // it degrades to neutral rather than dropping the status.
    tone: (STATUS_TONES as readonly string[]).includes(raw.tone ?? "")
      ? (raw.tone as StatusTone)
      : "neutral",
    sortOrder: raw.sort_order ?? 100,
    isActive: raw.is_active ?? true,
    asksExpectedDate: raw.asks_expected_date ?? false,
    asksSessionDetail: raw.asks_session_detail ?? false,
    asksHeadCount: raw.asks_head_count ?? false,
  };
}
