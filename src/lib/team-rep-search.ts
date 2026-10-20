/**
 * Admin #5 — filter the Team tab's existing rep rows by name.
 *
 * The list is already reps (`getTeamWeek` selects `role = 'rep'`). This only
 * narrows that array. It does not fetch, and it does not decide who may see
 * the control: the Team page shows the search to an admin only.
 */

export function repsMatchingName<T extends { name: string }>(
  members: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...members];
  return members.filter((member) =>
    member.name.toLocaleLowerCase().includes(needle),
  );
}
