import {
  METRICS,
  type MetricCounts,
} from "@/lib/validation/weekly";
import type { StatusCatalogue, StatusRow } from "@/lib/validation/institute";
import type { CellValue, SheetMerge, SheetSpec } from "@/lib/xlsx";

/**
 * The client's export template, as a grid.
 *
 * PURE ON PURPOSE. Everything here is a function of counts the caller has
 * already fetched, so the whole layout — the two-row header, which status
 * columns exist, where the bands start and stop — is testable without a
 * database. `activity-export.ts` does the reading; this decides the shape.
 *
 * THE TEMPLATE
 *
 *   Row 1:  Representative | DASHBOARD ACTIVITIES ...... | CLOSED STATUS ... | OPEN STATUS ...
 *   Row 2:  (blank)        | Meetings | Sessions | ...   | <status> | ...   | <status> | ...
 *   Row 3+: one rep per row, every cell a count.
 *
 * Column A is merged down both header rows; each band is merged across its own
 * columns. Nothing else is merged.
 */

/* ------------------------------------------------------------------ */
/* The six activity columns                                            */
/* ------------------------------------------------------------------ */

/**
 * SIX COLUMNS OUT OF EIGHT METRICS, and the fold is the one thing in this file
 * worth reading twice.
 *
 * Rule 7 counts EIGHT metrics, because Sessions and Campus Visits are each
 * counted twice — once as Set, once as Done — and the app shows all eight on
 * Targets and on the Team screen. The client's template asks for SIX columns,
 * one per activity, so the two lifecycle pairs are added back together here.
 *
 * That addition is exact rather than approximate.
 * `visits_lifecycle_matches_activity` (0001) REQUIRES a lifecycle on session
 * and campus_visit and forbids it everywhere else, so every session visit is
 * either Set or Done and never neither — which makes
 * `sessions_set + sessions_done` precisely the count of session visits. The
 * same holds for campus visits. No row is missed and none is counted twice.
 *
 * Meetings is not a fold. It comes from `daily_plans` where
 * `meetings_actual = 1`, never from the visits log — Rule 7's split — and
 * `tallyVisitMetrics()` deliberately refuses to count it, so the caller fills
 * it in. Taking it from `visits` here would produce a number that disagrees
 * with every other screen in the app.
 */
export const ACTIVITY_COLUMNS = [
  { label: "Meetings", from: ["meetings"] },
  { label: "Sessions", from: ["sessions_set", "sessions_done"] },
  { label: "Campus Visits", from: ["campus_visits_set", "campus_visits_done"] },
  { label: "Olympiad Registrations", from: ["olympiad"] },
  { label: "Applications", from: ["application"] },
  { label: "Admissions", from: ["admission"] },
] as const satisfies readonly {
  label: string;
  from: readonly (keyof MetricCounts)[];
}[];

/**
 * Every metric feeds exactly one column, checked here rather than trusted.
 *
 * If a ninth metric is ever added — `institutes_covered` is the one this
 * codebase has already added and removed once — it would otherwise be silently
 * absent from the export, which is the failure this whole file is written to
 * avoid. A test asserts this is empty.
 */
export function metricsMissingFromExport(): string[] {
  const covered = new Set<string>(ACTIVITY_COLUMNS.flatMap((c) => [...c.from]));
  return METRICS.map((m) => m.key).filter((key) => !covered.has(key));
}

export function activityCount(
  counts: MetricCounts,
  column: (typeof ACTIVITY_COLUMNS)[number],
): number {
  return column.from.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* The dynamic status columns                                          */
/* ------------------------------------------------------------------ */

export interface StatusColumn {
  /** The value stored in `visits.status_set_to`. The key for counting. */
  status: string;
  /** What the header cell says — the status, marked when it is retired. */
  label: string;
  retired: boolean;
}

export interface StatusColumns {
  closed: StatusColumn[];
  open: StatusColumn[];
}

/** How a retired status is marked in the header. */
export const RETIRED_SUFFIX = " (retired)";

/**
 * Which status columns this export has, derived at export time.
 *
 * NEVER A HARDCODED LIST. This is the client's central ask, and it falls out of
 * migration 0026: `institutes.status` and `visits.status_set_to` are foreign
 * keys to `public.institute_statuses`, so the vocabulary lives in a table an
 * admin extends from Settings. A status added this morning has a column this
 * afternoon, in the right band, without a deploy — because the only thing this
 * function knows is what the table said when it was called.
 *
 * ORDERING follows the CLIENT'S TEMPLATE, not `sort_order`. The nine statuses
 * the template names get its order, band by band (`TEMPLATE_COLUMN_ORDER`);
 * anything an admin has ADDED since is appended after them, still inside its
 * own band and still in catalogue order relative to its peers.
 *
 * This reverses the earlier rule, which was `sort_order` then name so that a
 * column's position in the sheet matched its position in the app's pickers.
 * The template is a file the client already has formulas and pivots written
 * against, and a sheet whose columns sit where they expect is worth more than
 * one that agrees with a picker they never see while reading it. Adding a
 * status still needs no deploy — it simply lands after the template's set
 * rather than in the middle of it.
 *
 * Matching is case-insensitive because the template writes Title Case and the
 * seeded rows are sentence case. It is on the STATUS TEXT, so renaming one in
 * Settings drops it out of the template set and appends it as an addition —
 * correct, if surprising: a renamed status is not the template's any more, and
 * guessing otherwise would be guessing.
 *
 * RETIRED STATUSES ARE INCLUDED WHEN, AND ONLY WHEN, THEY HAVE COUNTS IN THE
 * RANGE — and they sort to the END of their own band rather than into their
 * `sort_order` position. Three reasons, in order of weight:
 *
 *   1. Dropping them loses data with nothing to say so. Retiring is this app's
 *      ONLY removal path for a status (there is no delete, by design), so
 *      retired statuses accumulate and old visits keep pointing at them. An
 *      export of March that silently omits a status March actually used is a
 *      report whose columns do not add up to its own rows, and the reader has
 *      no way to notice.
 *   2. Appending rather than interleaving keeps the LIVE columns in a stable
 *      position from one export to the next, so a saved pivot or a formula
 *      written against last month's file does not shift when something is
 *      retired.
 *   3. Gating on "has counts" stops the sheet growing for ever. A status
 *      retired years ago with no activity in the range contributes nothing and
 *      gets no column.
 *
 * The header says so — `RETIRED_SUFFIX` — because a column that exists in one
 * month's export and not the next needs to explain itself on the page rather
 * than in a document nobody opens.
 */
export function statusColumnsFor(
  catalogue: StatusCatalogue,
  statusesWithCounts: ReadonlySet<string>,
): StatusColumns {
  const pick = (category: StatusRow["category"]): StatusColumn[] => {
    const inBand = catalogue.filter((row) => row.category === category);
    const active = inBand.filter((row) => row.isActive);

    // The template's own, in the template's order. `.filter()` already returns
    // a fresh array, so sorting it does not disturb the catalogue.
    const templated = active
      .filter((row) => templateIndexOf(category, row.status) >= 0)
      .sort(
        (a, b) =>
          templateIndexOf(category, a.status) - templateIndexOf(category, b.status),
      );

    // Everything an admin has added since, in catalogue order, after them.
    const added = active.filter((row) => templateIndexOf(category, row.status) < 0);

    const retired = inBand.filter(
      (row) => !row.isActive && statusesWithCounts.has(row.status),
    );
    return [...templated, ...added, ...retired].map((row) => ({
      status: row.status,
      label: row.isActive ? row.status : row.status + RETIRED_SUFFIX,
      retired: !row.isActive,
    }));
  };

  return { closed: pick("closed"), open: pick("open") };
}

/**
 * The column order the client's own spreadsheet uses, band by band.
 *
 * Written with the SEEDED spellings (`SEED_STATUS_CATALOGUE`), which are what
 * the database actually holds — the template's headers are the same nine in
 * Title Case, and its "Invite Principal for Event" is this app's "Invited
 * principal for event". Matching is case-insensitive, so the two spellings meet
 * in the middle; the wording difference is why this list is written against the
 * database rather than copied from the sheet.
 *
 * A status NOT named here is not an error — it is an addition, and
 * `statusColumnsFor()` appends it after these. That is the whole design: the
 * template's columns hold still, and new ones grow off the end.
 */
const TEMPLATE_COLUMN_ORDER: Record<StatusRow["category"], readonly string[]> = {
  closed: ["Campus visit done", "Session done", "RSVP received", "Will not come"],
  open: [
    "Session scheduled",
    "Campus visit scheduled",
    "First meeting done",
    "Pending for management approval",
    "Invited principal for event",
  ],
};

/** Where a status sits in its band's template order, or -1 if it is an addition. */
function templateIndexOf(category: StatusRow["category"], status: string): number {
  const needle = status.trim().toLowerCase();
  return TEMPLATE_COLUMN_ORDER[category].findIndex(
    (name) => name.toLowerCase() === needle,
  );
}

/**
 * Statuses that were counted but have no column, which should always be empty.
 *
 * The one way it will not be: `listStatusCatalogue()` falls back to the seeded
 * nine when its read fails, so a database whose catalogue could not be read
 * would produce a sheet missing every status an admin has added — quietly, and
 * with the counts for those visits simply absent. The route treats a non-empty
 * result here as a failure rather than exporting a sheet that does not add up.
 */
export function statusesWithoutColumns(
  columns: StatusColumns,
  statusesWithCounts: ReadonlySet<string>,
): string[] {
  const known = new Set(
    [...columns.closed, ...columns.open].map((c) => c.status),
  );
  return [...statusesWithCounts].filter((s) => !known.has(s)).sort();
}

/* ------------------------------------------------------------------ */
/* The grid                                                            */
/* ------------------------------------------------------------------ */

export interface RepRow {
  /**
   * OPTIONAL, because the .xlsx has no use for it.
   *
   * Set only when a grid's cells link somewhere — the per-institute status
   * report keys its hrefs on it. `buildActivityGrid()` reads `name`,
   * `activities` and `statuses` and nothing else, so adding this changes no
   * cell of the workbook; the byte-identity test in activity-grid-bands proves
   * that rather than asserting it.
   */
  id?: string;
  name: string;
  activities: MetricCounts;
  /** Visits in range by `status_set_to`. Absent key means zero. */
  statuses: Record<string, number>;
}

export interface GridInput {
  reps: RepRow[];
  columns: StatusColumns;
  /**
   * Whether to draw the DASHBOARD ACTIVITIES band. Defaults to TRUE, and the
   * default is the load-bearing part.
   *
   * The client asked for the six activity columns to come off the SCREEN — they
   * read the status bands, and the activity counts were repeating what /team
   * and /report already say. They did NOT ask for them to leave the .xlsx,
   * which is their own template with formulas and pivots written against it
   * (see TEMPLATE_COLUMN_ORDER below for why column positions are load-bearing
   * in that file).
   *
   * So this is the ONE place the "the table and the download are two renderings
   * of one array" invariant at the head of this file is deliberately broken,
   * and it is broken by OMISSION AT THE CALLER rather than by a second code
   * path: `activitySheet()` never passes it, so the export takes the default
   * and is byte-for-byte what it was. Only the two screen callers opt out.
   * Anything that forgets to pass it gets the full grid, which is the safe way
   * round for a flag whose wrong value silently deletes six columns from a
   * client's spreadsheet.
   */
  showActivities?: boolean;
  /**
   * Columns the READER has folded away (change-doc item 7). Keys are the ones
   * this builder returns in `columns`.
   *
   * ⚠ SCREEN ONLY, AND THE EXPORT NEVER PASSES IT. `activitySheet()` does not
   * know this field exists, so the .xlsx is byte-for-byte what it was — the
   * same arrangement `showActivities` already has, and for a sharper reason:
   * the workbook is the client's own template with formulas written against
   * column positions, and one reader's preference must never reach it.
   *
   * FILTERED HERE RATHER THAN IN THE RENDERER, because the bands, the merges,
   * the sort keys and both totals are all derived from these three lists. Hide
   * a column downstream and the band header above it still spans the old width,
   * so every column to its right slides out from under its own heading — a
   * report that looks fine and is wrong, which is the failure 0033's comments
   * call out elsewhere in this file. Filtering at the source makes that
   * unspellable.
   *
   * The TOTAL therefore counts only what is shown. That is the honest answer
   * for a table whose row total must equal the cells beside it: a figure that
   * included columns the reader cannot see would be a sum of something else.
   */
  hiddenColumns?: readonly string[];
  /**
   * A third band, for institutes that have no status at all.
   *
   * Its own band rather than an extra entry in OPEN or CLOSED, because null is
   * neither — "registered and not yet reached" is not a stage of the process,
   * it is the absence of one, and folding it into CLOSED would say the
   * opposite of the truth. Omitted entirely by the activity report, whose
   * counts come from `visits.status_set_to` where FO024 makes a null
   * impossible.
   */
  unsetColumn?: StatusColumn;
  /**
   * Turns a NON-ZERO status cell into a link to the rows behind it.
   *
   * Returning null leaves the cell as plain text. Zero cells never ask: there
   * is nothing behind them, and a link that lands on an empty list is a broken
   * promise rather than a drill-down.
   */
  hrefFor?: (rep: RepRow, status: string) => string | null;
  /**
   * Whether to compute the TOTAL column, the total row and the grand total.
   *
   * DEFAULTS TO TRUE, and unlike `showActivities` above the default here means
   * every caller agrees rather than one caller opting out. That is the point:
   * the screen and the download are two renderings of one computation, so a
   * total that existed in one and not the other would be the seam this file's
   * opening paragraph exists to close. No caller passes it; the flag is here
   * so the byte-identity test can ask for the pre-totals grid and prove the
   * change is confined to the new field.
   *
   * WHAT IT IS NOT: a row appended to `rows`. See the `totals` field on the
   * return value for why that would have been wrong three separate ways.
   */
  showTotals?: boolean;
}

export const GROUP_HEADERS = {
  representative: "Representative",
  activities: "DASHBOARD ACTIVITIES",
  closed: "CLOSED STATUS",
  open: "OPEN STATUS",
  unset: "NO STATUS",
  /**
   * LAST, AFTER NO STATUS, and the position is the whole of the client
   * compatibility argument.
   *
   * The .xlsx is the client's own template with formulas and pivots written
   * against fixed column positions — the reason `TEMPLATE_COLUMN_ORDER` exists
   * at all. A total column inserted anywhere else would shift every column to
   * its right and silently break all of them; placed at the far end it is
   * additive, and every existing column keeps the letter it had.
   *
   * Same rule NO STATUS itself follows, for the same reason.
   */
  total: "TOTAL",
} as const;

/** What the TOTAL column's second-row header cell says. */
export const TOTAL_COLUMN_LABEL = "Total";

/** What the total ROW's first cell says, in column A. */
export const TOTAL_ROW_LABEL = "All reps";

/**
 * The totals, computed once and rendered twice.
 *
 * `perRow` is parallel to the BODY rows (not to `rows`, which carries the two
 * header rows in front of them), `perColumn` is parallel to one body row
 * including column A, and `grand` is the bottom-right cell.
 */
export interface GridTotals {
  /**
   * Each rep's row total — THE STATUS COLUMNS ONLY.
   *
   * The six activity columns are deliberately excluded, and this is the single
   * most important line of arithmetic in the file. Meetings comes from
   * `daily_plans where meetings_actual = 1`; the other five activity columns
   * fold eight metrics counted from `visits`. The status columns count those
   * same visits again, by where they left the institute. So a row total
   * spanning both bands would count every visit twice AND add a figure from a
   * different table to it — a number that looks like a sum and means nothing.
   */
  perRow: number[];
  /**
   * Each column's sum down the rep axis, parallel to a body row.
   *
   * Column A is null — a column of names has no sum. Every other column,
   * activity band INCLUDED, gets one: "how many meetings did the team hold" is
   * a real question and the same arithmetic /team already answers. The
   * asymmetry with `perRow` is not an inconsistency; summing one column is
   * always meaningful, summing across bands is not.
   */
  perColumn: (number | null)[];
  /**
   * The bottom-right cell: the status bands' own total.
   *
   * Reachable two ways — the sum of `perRow`, or the sum of `perColumn`'s
   * status half — and the two MUST agree. `activity-grid-bands.test.ts`
   * asserts both routes, because that equality is what makes the figure
   * reconcile with the "T institutes in all" header on the pipeline report.
   */
  grand: number;
}

/**
 * The template, built.
 *
 * A band with no columns is omitted entirely rather than emitted as an empty
 * merged cell — a database with no open statuses would otherwise produce a
 * header band hanging over nothing. `mergeCells` with a colSpan of 1 is also
 * skipped by the writer, so a single-column band still renders correctly.
 */
export function buildActivityGrid(input: GridInput): {
  rows: CellValue[][];
  merges: SheetMerge[];
  /**
   * Parallel to `rows`, cell for cell — header rows included, filled with
   * nulls. Emitted here rather than recomputed by the renderer for the same
   * reason `merges` is: the column order is decided in this function, and a
   * second place that worked out which column is which status would be the
   * seam the links and the headers could drift through.
   */
  hrefs: (string | null)[][];
  /**
   * The row totals, the column totals and the grand total.
   *
   * SEPARATE FROM `rows`, NOT APPENDED TO IT, and the separation is the design
   * rather than a detail. Appending a total row would be wrong three ways, and
   * all three are visible in the existing callers: `activity-grid-table.tsx`
   * destructures `[groupRow, labelRow, ...bodyRows]` and renders every
   * remaining row as a rep — sticky name cell, hover state and all; `hrefs` is
   * asserted to be the same shape as `rows`, so it would need a parallel null
   * row or go silently out of alignment; and the "sums to the number of
   * institutes behind it" test iterates every body row, so a total row would
   * double its answer and the test would have to be loosened to accommodate a
   * bug it was written to catch.
   *
   * Keeping them here leaves every one of those untouched: the body is still
   * exactly the reps, and the renderer puts the totals where a total belongs.
   *
   * Null when `showTotals` is false.
   */
  totals: GridTotals | null;
  /**
   * Which sort key each column answers to, parallel to one body row.
   *
   * EMITTED HERE FOR THE REASON `merges` AND `hrefs` ARE. This function decides
   * the column order, so anything that needs to know "which column is which"
   * has to be told by it rather than work it out again — a second derivation
   * is the seam through which a header's sort link and the column under it
   * drift apart, and the failure would be a table that sorts by the wrong
   * status while looking perfectly correct.
   *
   * `"rep"` for column A, the status text for each status column (the NO
   * STATUS sentinel included, since it is a real column), `"total"` for the
   * TOTAL column, and **null for every activity column** — those are folds of
   * eight metrics into six and sorting a report of pipeline positions by them
   * answers no question the screen is asking.
   */
  sortKeys: (string | null)[];
  /**
   * One entry per column, in the order the rows carry them.
   *
   * ⚠ FOR THE SCREEN ONLY. The workbook reads `rows` and `merges` and nothing
   * else, so this changes no cell of the .xlsx — the byte-identity test in
   * activity-grid-bands proves that rather than asserting it, the same way
   * `RepRow.id` was added.
   *
   * It exists because `sortKeys` CANNOT serve as a column identity: it is null
   * for every activity column by design (sorting a pipeline report by a fold of
   * eight metrics answers no question the screen asks), and the view picker has
   * to be able to name one. `band` is what the picker groups by, and is null for
   * column A, which is never foldable — a table of counts belonging to nobody
   * is not a table.
   */
  columns: { key: string; label: string; band: string | null }[];
} {
  const {
    reps,
    columns,
    showActivities = true,
    unsetColumn,
    hrefFor,
    showTotals = true,
    hiddenColumns,
  } = input;

  /*
   * Folded away by the reader, before anything is derived from the lists.
   *
   * An empty or absent set is the default and must cost nothing — `keep()` is
   * then a function that always returns true, and every array below is the one
   * it has always been. That is what keeps the export and the two screens that
   * do not offer a picker byte-identical to before this field existed.
   */
  const hidden = new Set(hiddenColumns ?? []);
  const keep = (key: string) => !hidden.has(key);

  /*
   * ONE list, read by BOTH the header band and the body cells below.
   *
   * This is why it is a variable rather than two conditions. The band headers
   * and the row cells are built by separate loops, so dropping the band from
   * one and not the other would not fail — it would silently shift every
   * status count six columns out of line with its own header, which is a
   * report that looks fine and is wrong. Deriving both from this makes that
   * particular mistake unspellable.
   */
  const activityColumns: readonly (typeof ACTIVITY_COLUMNS)[number][] =
    showActivities
      ? ACTIVITY_COLUMNS.filter((c) => keep(`activity:${c.from[0]}`))
      : [];

  // The two status bands and the unset column, narrowed the same way. Named
  // here so the bands, the body cells, the sort keys and the column descriptor
  // below all read ONE narrowed list rather than each narrowing their own.
  const closedColumns = columns.closed.filter((c) => keep(`status:${c.status}`));
  const openColumns = columns.open.filter((c) => keep(`status:${c.status}`));
  const unset =
    unsetColumn && keep(`status:${unsetColumn.status}`) ? unsetColumn : undefined;

  const bands: { title: string; labels: string[] }[] = [
    {
      title: GROUP_HEADERS.activities,
      labels: activityColumns.map((c) => c.label),
    },
    { title: GROUP_HEADERS.closed, labels: closedColumns.map((c) => c.label) },
    { title: GROUP_HEADERS.open, labels: openColumns.map((c) => c.label) },
    // Last, so the template's bands keep the positions they already have.
    { title: GROUP_HEADERS.unset, labels: unset ? [unset.label] : [] },
    // ...and TOTAL after even that, for the same reason one more time over.
    { title: GROUP_HEADERS.total, labels: showTotals ? [TOTAL_COLUMN_LABEL] : [] },
  ].filter((band) => band.labels.length > 0);

  const groupRow: CellValue[] = [GROUP_HEADERS.representative];
  const labelRow: CellValue[] = [null];
  const merges: SheetMerge[] = [
    // Column A spans both header rows.
    { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
  ];

  let col = 1;
  for (const band of bands) {
    merges.push({ row: 0, col, rowSpan: 1, colSpan: band.labels.length });
    for (let i = 0; i < band.labels.length; i += 1) {
      groupRow.push(i === 0 ? band.title : null);
      labelRow.push(band.labels[i]);
    }
    col += band.labels.length;
  }

  const statusColumns = [
    ...closedColumns,
    ...openColumns,
    ...(unset ? [unset] : []),
  ];

  const bodyRows: CellValue[][] = [];
  const bodyHrefs: (string | null)[][] = [];
  const perRow: number[] = [];

  for (const rep of reps) {
    const row: CellValue[] = [rep.name];
    // Column A never links: the row already belongs to that person, and the
    // report's own caller decides whether a name goes anywhere.
    const hrefRow: (string | null)[] = [null];

    for (const column of activityColumns) {
      row.push(activityCount(rep.activities, column));
      hrefRow.push(null);
    }

    // Accumulated as the status cells are written rather than re-derived
    // afterwards, so the figure in the TOTAL column is arithmetically the same
    // cells the reader can see to its left. A second pass over `row` would be
    // a second chance to pick the wrong slice.
    let rowTotal = 0;
    for (const column of statusColumns) {
      const count = rep.statuses[column.status] ?? 0;
      row.push(count);
      rowTotal += count;
      // Zero is real data and is not a door. See `hrefFor`.
      hrefRow.push(count > 0 && hrefFor ? hrefFor(rep, column.status) : null);
    }
    perRow.push(rowTotal);

    if (showTotals) {
      row.push(rowTotal);
      /*
       * A TOTAL IS NEVER A DOOR, and `hrefFor` is not even consulted for it.
       *
       * CountLink's rule is that a count and the page it opens must agree, and
       * for a total there is no single page: it spans every status in the row.
       * A link here would land on one cohort while displaying the size of
       * several. Pushing null unconditionally is what makes that unspellable
       * rather than merely unwritten.
       */
      hrefRow.push(null);
    }

    bodyRows.push(row);
    bodyHrefs.push(hrefRow);
  }

  const blank = (row: CellValue[]) => row.map(() => null);

  /*
   * THE COLUMN SUMS, down the rep axis, over the rows as they were just built.
   *
   * Derived from `bodyRows` rather than from `reps` on purpose: the rows are
   * where the column ORDER was decided a few lines above, so summing them
   * cannot disagree with the headers. Recomputing from the rep objects would
   * mean a second place that knows which column is which, which is the seam
   * `merges` and `hrefs` are both emitted here to avoid.
   *
   * Column A is null — a column of names has no sum.
   */
  let totals: GridTotals | null = null;
  if (showTotals) {
    const width = labelRow.length;
    const perColumn: (number | null)[] = Array.from({ length: width }, (_, c) => {
      if (c === 0) return null;
      return bodyRows.reduce<number>(
        (sum, row) => sum + (typeof row[c] === "number" ? (row[c] as number) : 0),
        0,
      );
    });
    totals = {
      perRow,
      perColumn,
      // The sum of the row totals. The test asserts this also equals the sum of
      // `perColumn`'s status half — two routes, one number, which is what makes
      // it reconcile with the pipeline report's own header.
      grand: perRow.reduce((sum, n) => sum + n, 0),
    };
  }

  // Built from the same three lists the columns were, in the same order.
  const sortKeys: (string | null)[] = [
    SORT_BY_REP,
    ...activityColumns.map(() => null),
    ...statusColumns.map((column) => column.status),
    ...(showTotals ? [SORT_BY_TOTAL] : []),
  ];

  /*
   * The same three lists once more, this time naming every column.
   *
   * NAMESPACED KEYS (`activity:` / `status:`) because an activity and a status
   * could share a label — "Admission" is already both an activity column and a
   * plausible status — and a view preference that confused the two would fold
   * away the wrong column. The prefix makes them distinct in storage for ever.
   *
   * The status key is the STATUS, not the label: a retired status renders as
   * "Name (retired)" and a reader who hid it before it was retired must not
   * find it back on screen under a new label.
   */
  const columnKeys: { key: string; label: string; band: string | null }[] = [
    { key: SORT_BY_REP, label: GROUP_HEADERS.representative, band: null },
    // Keyed on `from[0]` — the first metric the column folds — because
    // ACTIVITY_COLUMNS has no key of its own and the label is display text that
    // could be reworded. `from` is the METRICS keys, which are the vocabulary
    // Rule 7 counts by and the one thing here that cannot be renamed without a
    // migration.
    ...activityColumns.map((c) => ({
      key: `activity:${c.from[0]}`,
      label: c.label,
      band: GROUP_HEADERS.activities,
    })),
    ...closedColumns.map((c) => ({
      key: `status:${c.status}`,
      label: c.label,
      band: GROUP_HEADERS.closed,
    })),
    ...openColumns.map((c) => ({
      key: `status:${c.status}`,
      label: c.label,
      band: GROUP_HEADERS.open,
    })),
    ...(unset
      ? [
          {
            key: `status:${unset.status}`,
            label: unset.label,
            band: GROUP_HEADERS.unset,
          },
        ]
      : []),
    ...(showTotals
      ? [{ key: SORT_BY_TOTAL, label: TOTAL_COLUMN_LABEL, band: null }]
      : []),
  ];

  return {
    columns: columnKeys,
    rows: [groupRow, labelRow, ...bodyRows],
    merges,
    hrefs: [blank(groupRow), blank(labelRow), ...bodyHrefs],
    totals,
    sortKeys,
  };
}

/** The default sort: the rep's own name, which is column A. */
export const SORT_BY_REP = "rep";

/** Sorting by the TOTAL column. Not a status, so it needs its own key. */
export const SORT_BY_TOTAL = "total";

/** Column A wide enough for a name; the count columns sized for their header. */
function widthsFor(rows: CellValue[][]): number[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, i) => {
    if (i === 0) return 28;
    const label = String(rows[1]?.[i] ?? "");
    return Math.min(Math.max(12, label.length + 2), 24);
  });
}

/**
 * The finished sheet, ready for `buildWorkbook`.
 *
 * THE ONE PLACE A TOTAL ROW BECOMES A ROW. A worksheet is literally a list of
 * rows, so the `<tfoot>` the screen renders has to be flattened into one here —
 * and this is the only code that does it, which is why `rows` stays exactly the
 * reps everywhere else. The sheet grows by one column and one row and nothing
 * moves: every existing column keeps its letter and every rep keeps its row
 * number, which is what the client's formulas and pivots are written against.
 */
export function activitySheet(input: GridInput, name: string): SheetSpec {
  const { rows, merges, totals } = buildActivityGrid(input);

  const sheetRows = totals
    ? [
        ...rows,
        // Column A names the row; every other cell is that column's sum,
        // including the activity band. `perColumn[0]` is null by construction.
        [TOTAL_ROW_LABEL, ...totals.perColumn.slice(1)] as CellValue[],
      ]
    : rows;

  return {
    name,
    rows: sheetRows,
    merges,
    // The total row is bold like the two header rows, so a reader scanning the
    // sheet does not mistake it for the last rep on the team.
    boldRows: totals ? [0, 1, sheetRows.length - 1] : [0, 1],
    widths: widthsFor(sheetRows),
    freezeRows: 2,
  };
}
