import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { slabSetKey, type SlabScope, type SlabStatus } from "@/lib/validation/slabs";

/**
 * Reading an institute's admission slabs (change-doc: Slabs).
 *
 * ⚠ SCOPING IS RLS'S, AND THERE IS NO FILTER HERE. `institute_slabs_select`
 * reaches through the parent institute with supervises(), so a rep sees their
 * own, a team lead their reps', an admin everyone's — the same predicate every
 * other child of `institutes` carries since 0042. A member filter in this file
 * would restate that boundary in a second place that could drift from it.
 *
 * ⚠ AND NOTHING HERE READS AN ADMISSION COUNT. These are ranges; the number
 * that would pick one has no source yet, so no function in this module answers
 * "which slab is this institute in". 0044's header is the long version.
 */

export interface SlabRecord {
  id: string;
  scope: SlabScope;
  college: string | null;
  program: string | null;
  start: number;
  /** Null is the open-ended last slab, never a missing value. */
  end: number | null;
  status: SlabStatus;
  note: string | null;
  decidedAt: string | null;
}

/** One scope's slabs, which is the unit everything here deals in. */
export interface SlabSet {
  key: string;
  scope: SlabScope;
  college: string | null;
  program: string | null;
  /** Ordered by start, which is the order the rules are written in. */
  slabs: SlabRecord[];
  /**
   * The set's status.
   *
   * Read off the rows rather than stored separately: `decide_slabs()` moves the
   * whole set together and FO035 refuses any other path, so every row in a set
   * carries the same value. Taken from the first row, with a loud fallback —
   * a mixed set would mean one of those two guarantees had failed.
   */
  status: SlabStatus;
  note: string | null;
}

const SELECT =
  "id, scope, college, program, start_count, end_count, status, note, decided_at";

interface RawSlab {
  id: string;
  scope: string;
  college: string | null;
  program: string | null;
  start_count: number;
  end_count: number | null;
  status: string;
  note: string | null;
  decided_at: string | null;
}

/**
 * Every slab set for one institute, grouped.
 *
 * ORDERED BY start IN SQL, not in TypeScript: the contiguity rule is about
 * order, so the order has to come from the one place that cannot disagree with
 * what was stored.
 */
export async function listSlabSets(
  instituteId: string,
): Promise<{ ok: true; sets: SlabSet[] } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institute_slabs")
    .select(SELECT)
    .eq("institute_id", instituteId)
    .order("scope", { ascending: true })
    .order("college", { ascending: true, nullsFirst: true })
    .order("program", { ascending: true, nullsFirst: true })
    .order("start_count", { ascending: true });

  if (error) {
    logError("slabs:list", error);
    return { ok: false };
  }

  const grouped = new Map<string, SlabSet>();
  for (const raw of (data ?? []) as unknown as RawSlab[]) {
    const scope = raw.scope as SlabScope;
    const key = slabSetKey({ scope, college: raw.college, program: raw.program });

    const record: SlabRecord = {
      id: raw.id,
      scope,
      college: raw.college,
      program: raw.program,
      start: raw.start_count,
      end: raw.end_count,
      status: raw.status as SlabStatus,
      note: raw.note,
      decidedAt: raw.decided_at,
    };

    const existing = grouped.get(key);
    if (existing) {
      existing.slabs.push(record);
      continue;
    }
    grouped.set(key, {
      key,
      scope,
      college: raw.college,
      program: raw.program,
      slabs: [record],
      status: record.status,
      note: record.note,
    });
  }

  return { ok: true, sets: [...grouped.values()] };
}

/**
 * Whether this institute counts as EMPANELLED — at least one approved slab.
 *
 * ⚠ COMPUTED ON EVERY READ, NEVER STORED. Revoking the last approved set drops
 * the badge with no second write and nothing to go stale; a column would be a
 * cached answer the revoke path had to remember to clear. The database says the
 * same thing in `institute_is_empanelled()`, which exists for callers that are
 * already in SQL.
 *
 * Derived from the sets the caller can already see rather than asked for
 * separately: one fewer round trip, and it cannot disagree with what is on
 * screen beside it.
 */
export function isEmpanelled(sets: SlabSet[]): boolean {
  return sets.some((set) => set.status === "approved");
}

/** Sets still waiting on an admin, for the approval queue. */
export function pendingSets(sets: SlabSet[]): SlabSet[] {
  return sets.filter((set) => set.status === "pending");
}
