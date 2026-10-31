import { describe, expect, it } from "vitest";
import {
  mergeStatusHistories,
  type CallHistoryRow,
  type VisitHistoryRow,
} from "@/lib/status-history";

function visitRow(
  id: string,
  status: string,
  changedAt: string,
): VisitHistoryRow {
  return {
    id,
    status,
    changed_at: changedAt,
    changed_by: "member-1",
    visit_id: `visit-${id}`,
  };
}

function callRow(id: string, status: string, changedAt: string): CallHistoryRow {
  return {
    id,
    status,
    changed_at: changedAt,
    changed_by: "member-1",
    call_id: `call-${id}`,
  };
}

describe("the institute timeline's two-track union", () => {
  it("keeps both tracks, newest first", () => {
    const merged = mergeStatusHistories(
      [
        visitRow("v1", "First meeting done", "2026-10-01T10:00:00+05:30"),
        visitRow("v2", "Session scheduled", "2026-10-20T10:00:00+05:30"),
      ],
      [callRow("c1", "Connected", "2026-10-10T10:00:00+05:30")],
    );

    expect(merged.map((change) => change.id)).toEqual(["v2", "c1", "v1"]);
  });

  it("tags each entry with the track that produced it", () => {
    const merged = mergeStatusHistories(
      [visitRow("v1", "First meeting done", "2026-10-01T10:00:00+05:30")],
      [callRow("c1", "Connected", "2026-10-02T10:00:00+05:30")],
    );

    const visit = merged.find((change) => change.id === "v1");
    const call = merged.find((change) => change.id === "c1");
    expect(visit?.source).toBe("visit");
    expect(visit?.visitId).toBe("visit-v1");
    expect(visit?.callId).toBeNull();
    expect(call?.source).toBe("call");
    expect(call?.callId).toBe("call-c1");
    expect(call?.visitId).toBeNull();
  });

  it("leaves a caller-resolved name unset for both tracks", () => {
    const merged = mergeStatusHistories(
      [visitRow("v1", "First meeting done", "2026-10-01T10:00:00+05:30")],
      [callRow("c1", "Connected", "2026-10-02T10:00:00+05:30")],
    );
    expect(merged.every((change) => change.changedByName === null)).toBe(true);
  });

  it("keeps the visit line first on a timestamp tie", () => {
    const at = "2026-10-05T10:00:00+05:30";
    const merged = mergeStatusHistories(
      [visitRow("v1", "First meeting done", at)],
      [callRow("c1", "Connected", at)],
    );
    expect(merged.map((change) => change.source)).toEqual(["visit", "call"]);
  });

  it("returns the visit track alone when 0072's history is empty", () => {
    const merged = mergeStatusHistories(
      [visitRow("v1", "First meeting done", "2026-10-01T10:00:00+05:30")],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("visit");
  });

  it("returns the call track alone when an institute has no visits", () => {
    const merged = mergeStatusHistories(
      [],
      [callRow("c1", "Connected", "2026-10-02T10:00:00+05:30")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("call");
  });

  it("is empty when neither track has anything", () => {
    expect(mergeStatusHistories([], [])).toEqual([]);
  });
});
