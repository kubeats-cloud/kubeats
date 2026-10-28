"use client";

import { useMemo } from "react";
import {
  ActivityGridTable,
  type GridSortState,
} from "@/components/report/activity-grid-table";
import { ViewPicker, type ViewPickerGroup } from "@/components/ui/view-picker";
import { useTableView } from "@/lib/table-view";
import {
  buildActivityGrid,
  type RepRow,
  type StatusColumn,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import {
  cohortHref,
  sortHref,
  type PipelineRange,
} from "@/lib/validation/pipeline-report";
import {
  repActivityHref,
  repStatusReviewHref,
} from "@/lib/rep-activity-links";

/**
 * The grid report, with its columns and categories foldable (change-doc item 7).
 *
 * ⚠ WHY THIS IS A CLIENT COMPONENT AND THE TABLE IT WRAPS IS NOT. The reader's
 * choice lives in their browser, and the grid has to be REBUILT when it
 * changes — not merely restyled. Hiding a banded column with CSS looks like it
 * works and is wrong: the band header above it keeps its original `colSpan`, so
 * every column to the right slides out from under its own heading. The bands,
 * the merges, the sort keys and both totals are all derived from the same three
 * column lists, so the only correct place to narrow is the input, which means
 * `buildActivityGrid()` has to run where the preference is known.
 *
 * ⚠ THE EXPORT IS UNREACHABLE FROM HERE, which is the point. `activitySheet()`
 * builds the workbook from the same function and never passes `hiddenColumns`,
 * so the .xlsx is byte-for-byte what it was — the client's own template, with
 * formulas written against column positions, cannot be reshaped by one reader's
 * preference. The byte-identity test proves it rather than this comment.
 *
 * TWO FUNCTION PROPS BECAME DATA. `GridInput.hrefFor` and `sortHrefFor` are
 * functions, and a server page cannot hand a function to a client component —
 * so this takes what they are BUILT FROM (`linkCohorts`, `sort`, `range`) and
 * rebuilds them here. Both helpers are pure URL builders; `cohortHref` moved out
 * of the server-only module to make that possible, and is re-exported from its
 * old home so nothing else changed.
 */
export function CustomisableGrid({
  viewKey,
  reps,
  columns,
  caption,
  showActivities,
  showActivityStatuses,
  showGroupTotals,
  unsetColumn,
  linkCohorts = false,
  linkReps = false,
  reviewRange,
  totalsReps,
  sort,
  range,
  sortHrefs,
  heading,
}: {
  /** Storage key. One per SCREEN, not one per grid — see below. */
  viewKey: string;
  reps: RepRow[];
  columns: StatusColumns;
  caption: string;
  showActivities?: boolean;
  /**
   * The Overview's default layout: Open/Closed per activity. When set, the 18
   * per-status columns start folded away but stay in the picker — the 12 are
   * the reading the client asked for, and the statuses are the detail behind
   * it.
   */
  showActivityStatuses?: boolean;
  /** Call Activity Report only: Open total / Closed total before TOTAL. */
  showGroupTotals?: boolean;
  unsetColumn?: StatusColumn;
  /** Pipeline report only: every non-zero cell opens the institutes behind it. */
  linkCohorts?: boolean;
  /** A rep's name opens their existing team hub. */
  linkReps?: boolean;
  /** Date range applied to linked status-count drill-downs. */
  reviewRange?: { start: string; end: string };
  /** Full filtered rows used when the visible body is paginated. */
  totalsReps?: RepRow[];
  /** Pipeline report only: the current sort, so headers can reverse it. */
  sort?: GridSortState;
  /** Pipeline report only: carried through every sort link. */
  range?: PipelineRange;
  /** Prebuilt links for screens whose query keys differ from the pipeline. */
  sortHrefs?: Record<string, string>;
  /** Rendered beside the picker, so the control sits in the table's own header. */
  heading?: string;
}) {
  /*
   * The FULL grid, built once with nothing hidden, purely to discover what
   * columns exist.
   *
   * It has to be the full one: the picker must list a column in order to offer
   * it back, and a grid built from the reader's current choice no longer
   * contains the columns they folded away. Cheap — `buildActivityGrid` is a
   * handful of array maps over a few dozen rows — and `useMemo` keeps it to one
   * per data change rather than one per toggle.
   */
  const all = useMemo(
    () =>
      buildActivityGrid({
        reps,
        columns,
        showActivities,
        showActivityStatuses,
        showGroupTotals,
        unsetColumn,
      }),
    [reps, columns, showActivities, showActivityStatuses, showGroupTotals, unsetColumn],
  );

  /*
   * Column A and TOTAL are not offerable, and each for its own reason.
   *
   * Column A is the rep's name: a table of counts belonging to nobody is not a
   * table, it is a grid of numbers. TOTAL is the row's own arithmetic over the
   * cells beside it — hiding it would leave the sum of the visible columns
   * unstated while every one of them is still on screen, which is a worse
   * reading of the same data rather than a simpler one.
   *
   * `band: null` marks exactly those two, so this needs no list of its own.
   */
  const foldable = all.columns.filter((c) => c.band !== null);

  /*
   * The status columns start folded away on the Overview, but only there.
   * Derived from the same `columns` the grid is built from, so a status added
   * to the catalogue is default-hidden with its peers rather than appearing
   * uninvited.
   */
  const defaultHidden = useMemo(
    () =>
      showActivityStatuses
        ? [
            ...columns.closed.map((c) => `status:${c.status}`),
            ...columns.open.map((c) => `status:${c.status}`),
          ]
        : [],
    [columns, unsetColumn, showActivityStatuses],
  );

  const view = useTableView(
    viewKey,
    foldable.map((c) => c.key),
    defaultHidden,
  );

  /*
   * THE CATEGORIES ARE THE BANDS, which is what makes this a row-category
   * picker as well as a column one. "Open", "Closed", "Dashboard activities"
   * and "No status yet" are the groupings the report is organised by, and the
   * group header toggles the whole band in one tap — the client's "turn off the
   * closed statuses" asked as one question rather than nine.
   */
  const groups: ViewPickerGroup[] = useMemo(() => {
    const byBand = new Map<string, { key: string; label: string }[]>();
    for (const column of foldable) {
      const band = column.band as string;
      const list = byBand.get(band) ?? [];
      list.push({ key: column.key, label: column.label });
      byBand.set(band, list);
    }
    return [...byBand].map(([label, cols]) => ({ label, columns: cols }));
  }, [foldable]);

  const hidden = foldable
    .map((c) => c.key)
    .filter((key) => !view.shows(key));

  return (
    <>
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground min-w-0 text-xs break-words">{heading}</p>
        <ViewPicker
          view={view}
          groups={groups}
          label="Customise columns and categories"
        />
      </div>

      <ActivityGridTable
        data={{
          reps,
          columns,
          showActivities,
          showActivityStatuses,
          showGroupTotals,
          unsetColumn,
          hiddenColumns: hidden,
          totalsFrom: totalsReps,
          repHrefFor: linkReps
            ? (rep) => (rep.id ? repActivityHref(rep.id) : null)
            : undefined,
          hrefFor: linkCohorts
            ? (rep, status) => (rep.id ? cohortHref(rep.id, status) : null)
            : reviewRange
              ? (rep, status) =>
                  rep.id
                    ? repStatusReviewHref({
                        memberId: rep.id,
                        status,
                        range: reviewRange,
                      })
                    : null
              : undefined,
        }}
        caption={caption}
        sortHrefFor={
          sort && range
            ? (sortKey) => sortHref(sortKey, sort, range)
            : sortHrefs
              ? (sortKey) => sortHrefs[sortKey] ?? null
              : undefined
        }
        sortState={sort}
      />
    </>
  );
}
