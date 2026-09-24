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
}

export const GROUP_HEADERS = {
  representative: "Representative",
  activities: "DASHBOARD ACTIVITIES",
  closed: "CLOSED STATUS",
  open: "OPEN STATUS",
  unset: "NO STATUS",
} as const;

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
} {
  const { reps, columns, showActivities = true, unsetColumn, hrefFor } = input;

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
    showActivities ? ACTIVITY_COLUMNS : [];

  const bands: { title: string; labels: string[] }[] = [
    {
      title: GROUP_HEADERS.activities,
      labels: activityColumns.map((c) => c.label),
    },
    { title: GROUP_HEADERS.closed, labels: columns.closed.map((c) => c.label) },
    { title: GROUP_HEADERS.open, labels: columns.open.map((c) => c.label) },
    // Last, so the template's bands keep the positions they already have.
    { title: GROUP_HEADERS.unset, labels: unsetColumn ? [unsetColumn.label] : [] },
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
    ...columns.closed,
    ...columns.open,
    ...(unsetColumn ? [unsetColumn] : []),
  ];

  const bodyRows: CellValue[][] = [];
  const bodyHrefs: (string | null)[][] = [];

  for (const rep of reps) {
    const row: CellValue[] = [rep.name];
    // Column A never links: the row already belongs to that person, and the
    // report's own caller decides whether a name goes anywhere.
    const hrefRow: (string | null)[] = [null];

    for (const column of activityColumns) {
      row.push(activityCount(rep.activities, column));
      hrefRow.push(null);
    }

    for (const column of statusColumns) {
      const count = rep.statuses[column.status] ?? 0;
      row.push(count);
      // Zero is real data and is not a door. See `hrefFor`.
      hrefRow.push(count > 0 && hrefFor ? hrefFor(rep, column.status) : null);
    }

    bodyRows.push(row);
    bodyHrefs.push(hrefRow);
  }

  const blank = (row: CellValue[]) => row.map(() => null);

  return {
    rows: [groupRow, labelRow, ...bodyRows],
    merges,
    hrefs: [blank(groupRow), blank(labelRow), ...bodyHrefs],
  };
}

/** Column A wide enough for a name; the count columns sized for their header. */
function widthsFor(rows: CellValue[][]): number[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, i) => {
    if (i === 0) return 28;
    const label = String(rows[1]?.[i] ?? "");
    return Math.min(Math.max(12, label.length + 2), 24);
  });
}

/** The finished sheet, ready for `buildWorkbook`. */
export function activitySheet(input: GridInput, name: string): SheetSpec {
  const { rows, merges } = buildActivityGrid(input);
  return {
    name,
    rows,
    merges,
    boldRows: [0, 1],
    widths: widthsFor(rows),
    freezeRows: 2,
  };
}
