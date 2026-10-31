/**
 * The institute's status journey as ONE list, from two parallel histories.
 *
 * Pure and deliberately outside `institutes.ts` so it can be tested without a
 * database or a Next.js request. `institutes.ts` does the two reads and hands
 * the rows here.
 *
 * WHY TWO TABLES AT ALL. Visit changes live in `institute_status_history`
 * (0011); call changes live in `institute_call_status_history` (0072). A
 * foreign key cannot point at two parents, and each history belongs beside the
 * status column it explains — that is also what lets 0074 retarget the call FK
 * without rewriting the visit history. The screen, however, should tell one
 * story, so the two are merged here.
 */

export interface StatusChange {
  id: string;
  status: string;
  changedAt: string;
  changedBy: string | null;
  /** Resolved by the caller afterwards; null when RLS hides that profile. */
  changedByName: string | null;
  /** The visit that caused it, when one did. */
  visitId: string | null;
  /** The call report that caused it, when the CALL track produced this entry. */
  callId: string | null;
  /**
   * WHICH TRACK this change belongs to. The status NAME is only meaningful
   * against that track's vocabulary — the two lists start as copies and are
   * admin-editable separately — so a renderer must choose the catalogue by
   * this, not by the name alone.
   */
  source: "visit" | "call";
}

export interface VisitHistoryRow {
  id: string;
  status: string;
  changed_at: string;
  changed_by: string | null;
  visit_id: string | null;
}

export interface CallHistoryRow {
  id: string;
  status: string;
  changed_at: string;
  changed_by: string | null;
  call_id: string | null;
}

/**
 * Newest first, across both tracks.
 *
 * A tie keeps the visit line first, which only matters for changes recorded in
 * the same millisecond — both triggers stamp `now()` for a visit or a call, and
 * the two writes cannot share a transaction here. The order is still stable, so
 * the list cannot reshuffle between two renders of the same data.
 */
export function mergeStatusHistories(
  visitRows: readonly VisitHistoryRow[],
  callRows: readonly CallHistoryRow[],
): StatusChange[] {
  return [
    ...visitRows.map(
      (row): StatusChange => ({
        id: row.id,
        status: row.status,
        changedAt: row.changed_at,
        changedBy: row.changed_by,
        changedByName: null,
        visitId: row.visit_id,
        callId: null,
        source: "visit",
      }),
    ),
    ...callRows.map(
      (row): StatusChange => ({
        id: row.id,
        status: row.status,
        changedAt: row.changed_at,
        changedBy: row.changed_by,
        changedByName: null,
        visitId: null,
        callId: row.call_id,
        source: "call",
      }),
    ),
  ].sort((a, b) => {
    const delta = Date.parse(b.changedAt) - Date.parse(a.changedAt);
    if (delta !== 0) return delta;
    return a.source === "visit" ? -1 : b.source === "visit" ? 1 : 0;
  });
}
