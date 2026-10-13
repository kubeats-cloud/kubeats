/**
 * A compact preview of a list the screen already holds in full.
 *
 * The slice is a view. The array passed in is the complete set — the same
 * rows, in the same order — and expanding returns that array unchanged, so a
 * control that reveals "all" cannot drop, reorder or re-query anything.
 */
export function previewWindow<T>(
  items: readonly T[],
  limit: number | undefined,
  expanded: boolean,
): { visible: readonly T[]; canToggle: boolean } {
  const canToggle = limit !== undefined && items.length > limit;
  if (!canToggle || expanded) return { visible: items, canToggle };
  return { visible: items.slice(0, limit), canToggle };
}

/** Settings Team list: ten rows until "View all". */
export const SETTINGS_TEAM_PREVIEW = 10;

/**
 * Filter a name/email list, then apply the preview.
 *
 * The search runs FIRST, over the full array the page already loaded, so a
 * query that matches twelve people still caps at ten until "View all" — the
 * same window as an unfiltered list, just over a smaller set. Expanding
 * returns every match, not a second fetch.
 */
export function previewNamedList<T extends { name: string; email: string | null }>(
  items: readonly T[],
  query: string,
  expanded: boolean,
  limit: number = SETTINGS_TEAM_PREVIEW,
): { matched: readonly T[]; visible: readonly T[]; canToggle: boolean } {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          (item.email ?? "").toLowerCase().includes(needle),
      )
    : items;
  const window = previewWindow(matched, limit, expanded);
  return { matched, visible: window.visible, canToggle: window.canToggle };
}
