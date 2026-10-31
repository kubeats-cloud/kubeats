import type { CallReport } from "@/lib/call-reports";
import type { VisitFilters, VisitRow } from "@/lib/admin-workspace";
import { todayISO } from "@/lib/dates";
import { instituteNameOr } from "@/lib/institute-scope";

export interface ReviewRow extends VisitRow {
  kind: "visit" | "call";
  href: string;
  reportLabel: "Log Visit Report" | "Call Report";
}

export interface ReviewFeed {
  rows: ReviewRow[];
  total: number;
  visitTotal: number;
  callTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function reviewKinds(filters: VisitFilters): {
  visits: boolean;
  calls: boolean;
} {
  if (filters.activity === "call") return { visits: false, calls: true };
  if (filters.activity) return { visits: true, calls: false };
  if (filters.reported === "calls") return { visits: false, calls: true };
  // THE TWO STATUS FILTERS ARE PER-REGISTER, and this is what enforces it. A
  // visit has a visit status and a call has a call status; showing the other
  // register unfiltered beneath a status filter would leave rows on screen
  // that the filter plainly did not match. Call status wins if both are set
  // on a hand-edited URL — it is the only one that can apply to a call, and
  // the wrong answer here is a wider list, not a missing one.
  if (filters.callStatus) return { visits: false, calls: true };
  if (filters.visitStatus) return { visits: true, calls: false };
  if (filters.lifecycle || filters.reported === "unreported") {
    return { visits: true, calls: false };
  }
  return { visits: true, calls: true };
}

export function visitToReviewRow(visit: VisitRow): ReviewRow {
  return {
    ...visit,
    kind: "visit",
    href: `/review/${visit.id}`,
    reportLabel: "Log Visit Report",
  };
}

export function callToReviewRow(report: CallReport): ReviewRow {
  return {
    id: report.id,
    date: todayISO(new Date(report.reported_at)),
    activity: "call",
    activityLabel: "Call",
    lifecycle: null,
    status: report.status_set_to,
    notes: report.call_notes,
    reportedAt: report.reported_at,
    standing: report.status_set_to,
    memberId: report.member,
    memberName: report.profiles?.name ?? "Unknown",
    instituteId: report.institute_id,
    instituteName: instituteNameOr(report.institutes?.name, "review-feed"),
    city: null,
    photo: null,
    instituteStatusUpdatedAt: null,
    instituteFollowUpDate: null,
    kind: "call",
    href: `/review/${report.id}?kind=call`,
    reportLabel: "Call Report",
  };
}

function sortTime(row: ReviewRow): number {
  if (row.kind === "call") {
    return row.reportedAt ? Date.parse(row.reportedAt) : 0;
  }
  return Date.parse(`${row.date}T00:00:00+05:30`);
}

function compareRows(a: ReviewRow, b: ReviewRow): number {
  return sortTime(b) - sortTime(a);
}

export function mergeReviewFeed(input: {
  visits: readonly VisitRow[];
  calls: readonly CallReport[];
  visitTotal: number;
  callTotal: number;
  requestedPage: number;
  pageSize: number;
}): ReviewFeed {
  const total = input.visitTotal + input.callTotal;
  const pageCount = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(
    Math.max(1, Number.isFinite(input.requestedPage) ? Math.floor(input.requestedPage) : 1),
    pageCount,
  );
  const rows = [
    ...input.visits.map(visitToReviewRow),
    ...input.calls.map(callToReviewRow),
  ].sort(compareRows);
  const start = (page - 1) * input.pageSize;
  return {
    rows: rows.slice(start, start + input.pageSize),
    total,
    visitTotal: input.visitTotal,
    callTotal: input.callTotal,
    page,
    pageSize: input.pageSize,
    pageCount,
  };
}
