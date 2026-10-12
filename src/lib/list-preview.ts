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
