import { describe, expect, it } from "vitest";
import type { VisitRow } from "@/lib/admin-workspace";
import type { CallReport } from "@/lib/call-reports";
import {
  callToReviewRow,
  mergeReviewFeed,
  reviewKinds,
} from "@/lib/review-feed";

function visit(id: string, date: string): VisitRow {
  return {
    id,
    date,
    activity: "meeting",
    activityLabel: "Meeting",
    lifecycle: null,
    status: "Session scheduled",
    notes: null,
    reportedAt: null,
    standing: "Session scheduled",
    memberId: "member-1",
    memberName: "Rep One",
    instituteId: "institute-1",
    instituteName: "Institute One",
    city: null,
    photo: null,
    instituteStatusUpdatedAt: null,
    instituteFollowUpDate: null,
  };
}

function call(id: string, reportedAt: string): CallReport {
  return {
    id,
    member: "member-1",
    institute_id: "institute-1",
    reported_at: reportedAt,
    status_set_to: "Session scheduled",
    expected_date: null,
    follow_up_date: null,
    students_attended: null,
    session_topic: null,
    session_taken_by: null,
    call_notes: "Spoke to the principal.",
    next_action: null,
    note: null,
    due_date: reportedAt.slice(0, 10),
    outcome: "done",
    custom_fields: null,
    profiles: { name: "Rep One" },
    institutes: { name: "Institute One", call_status: "Session scheduled" },
  };
}

describe("the Review feed's kind filter", () => {
  it("shows only calls for Activity=Call", () => {
    expect(reviewKinds({ activity: "call" })).toEqual({
      visits: false,
      calls: true,
    });
  });

  it("shows only visits for every other activity", () => {
    expect(reviewKinds({ activity: "meeting" })).toEqual({
      visits: true,
      calls: false,
    });
  });

  it("lets a chosen activity outrank the Call Reports report filter", () => {
    expect(reviewKinds({ activity: "meeting", reported: "calls" })).toEqual({
      visits: true,
      calls: false,
    });
  });

  it("shows only calls for the Call Reports report filter", () => {
    expect(reviewKinds({ reported: "calls" })).toEqual({
      visits: false,
      calls: true,
    });
  });

  it("shows both when no kind is chosen", () => {
    expect(reviewKinds({})).toEqual({ visits: true, calls: true });
  });

  /*
   * The two status filters are per-register since 0070. Neither may leave the
   * other register on screen unfiltered, because its rows would not satisfy the
   * filter the user just chose.
   */
  it("narrows to visits for the visit-status filter", () => {
    expect(reviewKinds({ visitStatus: "Session scheduled" })).toEqual({
      visits: true,
      calls: false,
    });
  });

  it("narrows to calls for the call-status filter", () => {
    expect(reviewKinds({ callStatus: "Session scheduled" })).toEqual({
      visits: false,
      calls: true,
    });
  });

  it("lets the call-status filter win when both status filters are set", () => {
    expect(
      reviewKinds({ visitStatus: "Session scheduled", callStatus: "Connected" }),
    ).toEqual({ visits: false, calls: true });
  });
});

describe("merging Call Reports with visit reports", () => {
  const visits = [visit("v1", "2026-10-20"), visit("v2", "2026-10-22")];
  const calls = [
    call("c1", "2026-10-21T09:00:00+05:30"),
    call("c2", "2026-10-22T10:00:00+05:30"),
  ];

  it("sorts the union newest first and paginates it", () => {
    const first = mergeReviewFeed({
      visits,
      calls,
      visitTotal: 2,
      callTotal: 2,
      requestedPage: 1,
      pageSize: 2,
    });
    expect(first.total).toBe(4);
    expect(first.visitTotal).toBe(2);
    expect(first.callTotal).toBe(2);
    expect(first.pageCount).toBe(2);
    expect(first.rows.map((row) => row.id)).toEqual(["c2", "v2"]);

    const second = mergeReviewFeed({
      visits,
      calls,
      visitTotal: 2,
      callTotal: 2,
      requestedPage: 2,
      pageSize: 2,
    });
    expect(second.rows.map((row) => row.id)).toEqual(["c1", "v1"]);
  });

  it("keeps the visit total unchanged when no calls match", () => {
    const feed = mergeReviewFeed({
      visits,
      calls: [],
      visitTotal: 2,
      callTotal: 0,
      requestedPage: 1,
      pageSize: 50,
    });
    expect(feed.total).toBe(2);
    expect(feed.visitTotal).toBe(2);
    expect(feed.rows.every((row) => row.kind === "visit")).toBe(true);
  });

  it("keeps page boundaries stable when a deeper page fetches more candidates", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      visit(`v${String(i).padStart(3, "0")}`, "2026-10-21"),
    );
    const first = mergeReviewFeed({
      visits: many.slice(0, 50),
      calls,
      visitTotal: 100,
      callTotal: calls.length,
      requestedPage: 1,
      pageSize: 50,
    });
    const second = mergeReviewFeed({
      visits: many,
      calls,
      visitTotal: 100,
      callTotal: calls.length,
      requestedPage: 2,
      pageSize: 50,
    });
    const firstKeys = new Set(first.rows.map((row) => `${row.kind}-${row.id}`));
    expect(second.rows.some((row) => firstKeys.has(`${row.kind}-${row.id}`))).toBe(
      false,
    );
    expect(second.rows).toHaveLength(50);
  });

  it("labels a call row without inventing a photo or a visit report", () => {
    const row = callToReviewRow(calls[0]);
    expect(row.kind).toBe("call");
    expect(row.reportLabel).toBe("Call Report");
    expect(row.activityLabel).toBe("Call");
    expect(row.photo).toBeNull();
    expect(row.notes).toBe("Spoke to the principal.");
    expect(row.href).toBe("/review/c1?kind=call");
  });
});
