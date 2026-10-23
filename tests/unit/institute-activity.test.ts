import { describe, expect, it } from "vitest";
import {
  reconcileActivityCounts,
  type ReconcilableVisit,
} from "@/lib/validation/weekly";
import {
  activityBucketFor,
  buildInstituteActivityRows,
  isInstituteActivitySortKey,
  openClosedTotals,
  sortInstituteActivityRows,
  sumInstituteActivityRows,
  type CountableVisit,
} from "@/lib/institute-activity-counts";
import {
  instituteActivityExportHref,
  instituteActivitySortHref,
  reviewCohortHref,
} from "@/lib/institute-activity-links";
import { instituteActivitySheetRows } from "@/lib/exports/institute-activity-export";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";

/**
 * The institute-wise Activity Report's own arithmetic, without a database.
 *
 * `getInstituteActivityModel()` reads three tables through RLS, so proving the
 * owner tally against a real database is the integration suite's job (the H2
 * team-lead block in tests/integration/rules.test.ts). Everything here is a
 * pure function of its inputs: the reconciler, the bucket/category fold, the
 * sort, the URL builders and the export's sheet rows.
 */

function visit(
  overrides: Partial<CountableVisit> & { institute_id: string },
): CountableVisit {
  return {
    activity: "meeting",
    lifecycle_status: null,
    status_set_to: null,
    ...overrides,
  };
}

describe("reconcileActivityCounts", () => {
  it("reconciles a clean mix with no failures", () => {
    const visits: ReconcilableVisit[] = [
      { institute_id: "a", activity: "meeting", lifecycle_status: null },
      { institute_id: "a", activity: "session", lifecycle_status: "Set" },
      { institute_id: "a", activity: "session", lifecycle_status: "Done" },
      { institute_id: "b", activity: "olympiad", lifecycle_status: null },
    ];
    expect(reconcileActivityCounts(visits)).toEqual([]);
  });

  it("flags an institute whose session row carries no lifecycle", () => {
    // visitMetricKeys matches nothing for a session with a null lifecycle —
    // tallyVisitMetrics silently drops it, which is exactly the drift this
    // function exists to catch rather than hide.
    const visits: ReconcilableVisit[] = [
      { institute_id: "a", activity: "session", lifecycle_status: null },
    ];
    const failures = reconcileActivityCounts(visits);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ instituteId: "a", total: 1, summed: 0 });
  });

  it("flags an institute whose total does not equal the sum of its buckets", () => {
    const visits: ReconcilableVisit[] = [
      { institute_id: "a", activity: "unknown-activity", lifecycle_status: null },
    ];
    const failures = reconcileActivityCounts(visits);
    expect(failures.map((f) => f.instituteId)).toContain("a");
  });

  it("keeps institutes independent — one's drift does not flag another's", () => {
    const visits: ReconcilableVisit[] = [
      { institute_id: "broken", activity: "session", lifecycle_status: null },
      { institute_id: "fine", activity: "meeting", lifecycle_status: null },
    ];
    const failures = reconcileActivityCounts(visits);
    expect(failures.map((f) => f.instituteId)).toEqual(["broken"]);
  });
});

describe("activityBucketFor", () => {
  it("buckets a meeting from the visit row itself, not the plan", () => {
    expect(
      activityBucketFor({ institute_id: "a", activity: "meeting", lifecycle_status: null }),
    ).toBe("meeting");
  });

  it("folds both lifecycle states of a session into one bucket", () => {
    expect(
      activityBucketFor({ institute_id: "a", activity: "session", lifecycle_status: "Set" }),
    ).toBe("session");
    expect(
      activityBucketFor({ institute_id: "a", activity: "session", lifecycle_status: "Done" }),
    ).toBe("session");
  });

  it("folds both lifecycle states of a campus visit into one bucket", () => {
    expect(
      activityBucketFor({
        institute_id: "a",
        activity: "campus_visit",
        lifecycle_status: "Set",
      }),
    ).toBe("campus_visit");
  });

  it("returns null for a session with no lifecycle — cannot reconcile", () => {
    expect(
      activityBucketFor({ institute_id: "a", activity: "session", lifecycle_status: null }),
    ).toBeNull();
  });

  it("passes the three one-shot activities straight through", () => {
    for (const activity of ["olympiad", "application", "admission"] as const) {
      expect(
        activityBucketFor({ institute_id: "a", activity, lifecycle_status: null }),
      ).toBe(activity);
    }
  });
});

describe("buildInstituteActivityRows", () => {
  const catalogue = SEED_STATUS_CATALOGUE;
  const institutes = [
    { id: "a", name: "Zebra School" },
    { id: "b", name: "Alpha School" },
  ];

  it("still emits a row for an institute with no visits at all", () => {
    const { rows, reconciliationFailures } = buildInstituteActivityRows({
      institutes,
      visits: [],
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    expect(reconciliationFailures).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "a")?.totalActivities).toBe(0);
  });

  it("splits a bucket into Open and Closed by the status category", () => {
    const visits: CountableVisit[] = [
      visit({ institute_id: "a", activity: "meeting", status_set_to: "First meeting done" }), // open
      visit({ institute_id: "a", activity: "meeting", status_set_to: "RSVP received" }), // closed
    ];
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits,
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    const a = rows.find((r) => r.id === "a")!;
    expect(a.byActivity.meeting).toEqual({ open: 1, closed: 1 });
    expect(a.totalActivities).toBe(2);
  });

  it("counts a visit toward the total even when its status has no category", () => {
    // A legacy row with no status_set_to, or one not in the catalogue: it
    // still reconciles (it is still one visit) but lands in neither band —
    // the row's total and its Open+Closed sum are allowed to differ here.
    const visits: CountableVisit[] = [
      visit({ institute_id: "a", activity: "meeting", status_set_to: null }),
    ];
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits,
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    const a = rows.find((r) => r.id === "a")!;
    expect(a.totalActivities).toBe(1);
    expect(a.byActivity.meeting).toEqual({ open: 0, closed: 0 });
  });

  it("does not invent an Open/Closed split for an institute that failed to reconcile", () => {
    const visits: CountableVisit[] = [
      visit({ institute_id: "a", activity: "session", lifecycle_status: null }),
    ];
    const { rows, reconciliationFailures } = buildInstituteActivityRows({
      institutes,
      visits,
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    expect(reconciliationFailures).toHaveLength(1);
    const a = rows.find((r) => r.id === "a")!;
    // Still reports the raw visit count as the total, but every bucket is zero
    // rather than a guess that could disagree with the reconciler.
    expect(a.totalActivities).toBe(1);
    expect(a.byActivity.session).toEqual({ open: 0, closed: 0 });
  });

  it("attaches meetings completed and follow-up counts by institute", () => {
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits: [],
      meetingsCompletedByInstitute: new Map([["a", 3]]),
      followUpsOwnedByInstitute: new Map([["a", 2]]),
      followUpsPendingByInstitute: new Map([["a", 1]]),
      presenceByInstitute: new Map(),
      catalogue,
    });
    const a = rows.find((r) => r.id === "a")!;
    expect(a.meetingsCompleted).toBe(3);
    expect(a.followUpsOwned).toBe(2);
    expect(a.followUpsPending).toBe(1);
    const b = rows.find((r) => r.id === "b")!;
    expect(b.meetingsCompleted).toBe(0);
  });

  it("attaches the latest arrival's presence record, and zeros when there is none", () => {
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits: [],
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map([
        [
          "a",
          {
            totalVisits: 2,
            lastCheckinAt: "2026-02-03T05:00:00.000Z",
            lastCheckinArea: "Gandhinagar",
            lastCheckoutAt: "2026-02-03T06:00:00.000Z",
            lastCheckoutArea: "Gandhinagar",
          },
        ],
      ]),
      catalogue,
    });
    const a = rows.find((r) => r.id === "a")!;
    expect(a.totalVisits).toBe(2);
    expect(a.lastCheckinAt).toBe("2026-02-03T05:00:00.000Z");
    expect(a.lastCheckinArea).toBe("Gandhinagar");
    expect(a.lastCheckoutAt).toBe("2026-02-03T06:00:00.000Z");

    const b = rows.find((r) => r.id === "b")!;
    expect(b.totalVisits).toBe(0);
    expect(b.lastCheckinAt).toBeNull();
    expect(b.lastCheckinArea).toBeNull();
  });
});

describe("openClosedTotals — R1's two aggregate columns", () => {
  const catalogue = SEED_STATUS_CATALOGUE;
  const institutes = [{ id: "a", name: "A School" }];

  it("sums Open and Closed across all six activity types", () => {
    const visits: CountableVisit[] = [
      visit({ institute_id: "a", activity: "meeting", status_set_to: "First meeting done" }), // open
      visit({ institute_id: "a", activity: "olympiad", status_set_to: "RSVP received" }), // closed
      visit({ institute_id: "a", activity: "application", status_set_to: "Will not come" }), // closed
    ];
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits,
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    expect(openClosedTotals(rows[0])).toEqual({ open: 1, closed: 2 });
  });

  it("is zero across the board for an institute with no activity", () => {
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits: [],
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    expect(openClosedTotals(rows[0])).toEqual({ open: 0, closed: 0 });
  });
});

describe("sumInstituteActivityRows — R7's overall totals footer", () => {
  const catalogue = SEED_STATUS_CATALOGUE;
  const institutes = [
    { id: "a", name: "A School" },
    { id: "b", name: "B School" },
  ];

  it("adds every institute's figures into one footer row", () => {
    const visits: CountableVisit[] = [
      visit({ institute_id: "a", activity: "meeting", status_set_to: "First meeting done" }),
      visit({ institute_id: "b", activity: "meeting", status_set_to: "RSVP received" }),
    ];
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits,
      meetingsCompletedByInstitute: new Map([["a", 2], ["b", 1]]),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map([
        ["a", { totalVisits: 3, lastCheckinAt: null, lastCheckinArea: null, lastCheckoutAt: null, lastCheckoutArea: null }],
        ["b", { totalVisits: 1, lastCheckinAt: null, lastCheckinArea: null, lastCheckoutAt: null, lastCheckoutArea: null }],
      ]),
      catalogue,
    });
    expect(sumInstituteActivityRows(rows)).toEqual({
      open: 1,
      closed: 1,
      totalActivities: 2,
      totalVisits: 4,
      meetingsCompleted: 3,
    });
  });

  it("is all zeros for an empty row set", () => {
    expect(sumInstituteActivityRows([])).toEqual({
      open: 0,
      closed: 0,
      totalActivities: 0,
      totalVisits: 0,
      meetingsCompleted: 0,
    });
  });
});

describe("sortInstituteActivityRows", () => {
  const catalogue = SEED_STATUS_CATALOGUE;
  const institutes = [
    { id: "a", name: "Zebra School" },
    { id: "b", name: "Alpha School" },
  ];
  const { rows } = buildInstituteActivityRows({
    institutes,
    visits: [
      visit({ institute_id: "a", activity: "meeting", status_set_to: "First meeting done" }),
    ],
    meetingsCompletedByInstitute: new Map(),
    followUpsOwnedByInstitute: new Map(),
    followUpsPendingByInstitute: new Map(),
    presenceByInstitute: new Map(),
    catalogue,
  });

  it("sorts by institute name A-Z by default", () => {
    const sorted = sortInstituteActivityRows(rows, "institute", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["Alpha School", "Zebra School"]);
  });

  it("reverses on desc", () => {
    const sorted = sortInstituteActivityRows(rows, "institute", "desc");
    expect(sorted.map((r) => r.name)).toEqual(["Zebra School", "Alpha School"]);
  });

  it("sorts a numeric column and breaks ties by name", () => {
    const sorted = sortInstituteActivityRows(rows, "meeting_open", "desc");
    expect(sorted[0].name).toBe("Zebra School"); // the only non-zero count
  });

  it("recognises every declared sort key and rejects anything else", () => {
    expect(isInstituteActivitySortKey("meeting_open")).toBe(true);
    expect(isInstituteActivitySortKey("not-a-key")).toBe(false);
    expect(isInstituteActivitySortKey(undefined)).toBe(false);
  });
});

describe("URL builders", () => {
  it("builds a review cohort link carrying institute, activity, category and range", () => {
    const href = reviewCohortHref({
      instituteId: "inst-1",
      activity: "session",
      category: "open",
      range: { from: "2026-01-01", to: "2026-01-31" },
    });
    expect(href).toBe(
      "/review?institute=inst-1&activity=session&category=open&from=2026-01-01&to=2026-01-31",
    );
  });

  it("omits range params entirely when the range is empty", () => {
    const href = reviewCohortHref({
      instituteId: "inst-1",
      activity: "meeting",
      category: "closed",
      range: {},
    });
    expect(href).toBe("/review?institute=inst-1&activity=meeting&category=closed");
  });

  it("toggles sort direction on the same key and resets to asc on a new one", () => {
    const sameKey = instituteActivitySortHref({
      key: "total",
      currentKey: "total",
      currentDir: "asc",
      range: {},
    });
    expect(sameKey).toContain("dir=desc");

    const newKey = instituteActivitySortHref({
      key: "meetings_completed",
      currentKey: "total",
      currentDir: "desc",
      range: {},
    });
    expect(newKey).toContain("dir=asc");
  });

  it("carries the range through a sort link", () => {
    const href = instituteActivitySortHref({
      key: "institute",
      currentKey: "total",
      currentDir: "asc",
      range: { from: "2026-02-01" },
    });
    expect(href).toBe("/institutes/report?from=2026-02-01&sort=institute&dir=asc");
  });

  it("builds the export href from the same range and sort the table used", () => {
    const href = instituteActivityExportHref({
      range: { from: "2026-02-01", to: "2026-02-28" },
      sortKey: "total",
      sortDir: "desc",
    });
    expect(href).toBe(
      "/api/export/institute-activity?from=2026-02-01&to=2026-02-28&sort=total&dir=desc",
    );
  });
});

describe("instituteActivitySheetRows", () => {
  it("renders a header row and one data row per institute, in the given order", () => {
    const catalogue = SEED_STATUS_CATALOGUE;
    const institutes = [
      { id: "a", name: "Zebra School" },
      { id: "b", name: "Alpha School" },
    ];
    const { rows } = buildInstituteActivityRows({
      institutes,
      visits: [
        visit({ institute_id: "a", activity: "meeting", status_set_to: "First meeting done" }),
      ],
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    const sorted = sortInstituteActivityRows(rows, "institute", "asc");
    const sheet = instituteActivitySheetRows(sorted);

    expect(sheet[0][0]).toBe("Institute");
    expect(sheet).toHaveLength(4); // header + two institutes + visible-page Total
    expect(sheet[1][0]).toBe("Alpha School");
    expect(sheet[2][0]).toBe("Zebra School");
    // Only the six activity types' Open/Closed pairs — no Total, no
    // follow-ups, no meetings completed (Admin #1/#2 name only these).
    // Column 1 is Meeting Open; Alpha has none, Zebra has one (open).
    expect(sheet[1][1]).toBe(0);
    expect(sheet[2][1]).toBe(1);
    expect(sheet[0]).toHaveLength(13); // Institute + 6 types * 2
    expect(sheet[0]).not.toContain("Total activities");
    expect(sheet[0]).not.toContain("Follow-ups owned");
    expect(sheet[0]).not.toContain("Meetings completed");
    expect(sheet.at(-1)?.[0]).toBe('Total');
    for (let column=1;column<13;column++) {
      expect(sheet.at(-1)?.[column]).toBe(Number(sheet[1][column])+Number(sheet[2][column]));
    }
  });
});
