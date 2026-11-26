export interface HeldVisitEntry {
  checkoutAt: string | null;
  /** Present in raw/test rows; getTodayPlan already removes cancelled entries. */
  cancelledAt?: string | null;
}

/** Today's Held card counts recorded departures, regardless of visit activity. */
export function countHeldVisits(entries: readonly HeldVisitEntry[]): number {
  return entries.filter(
    (entry) =>
      (entry.cancelledAt === null || entry.cancelledAt === undefined) &&
      entry.checkoutAt !== null,
  ).length;
}
