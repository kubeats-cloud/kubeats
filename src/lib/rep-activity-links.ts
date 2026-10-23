/** URL builders for the rep-wise Activity report's drill-downs. */

/** The rep's existing hub: /team/[memberId], not a second activity screen. */
export function repActivityHref(memberId: string): string {
  return `/team/${memberId}`;
}

/**
 * The visits behind one status cell: Review filtered by rep, the visit's own
 * status and the report's date range.
 */
export function repStatusReviewHref(input: {
  memberId: string;
  status: string;
  range: { start: string; end: string };
}): string {
  const params = new URLSearchParams({
    member: input.memberId,
    visitStatus: input.status,
    from: input.range.start,
    to: input.range.end,
  });
  return `/review?${params.toString()}`;
}
