import { describe, expect, it, vi } from "vitest";

/**
 * getTeamWeek()'s rep list is "the rep list for the LEAD'S OWN TEAM" — RLS
 * (`profiles_select` = `supervises(id)`) already narrows a team lead's call
 * to their own reps before any server-side row cap applies, so a lead with
 * more reps than that cap would see their own roster on `/team` silently cut
 * short. Same defect class as listTeamMembers() (admin.ts), different query.
 *
 * The fake client below enforces its own small "server" cap on `profiles`
 * regardless of the `.range()` window asked for, exactly like a real
 * PostgREST instance configured with a small db.max_rows would. The
 * regression this guards is the pagination loop trusting a single page's
 * length instead of paging until one comes back short.
 */

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

function fakeClient(allReps: unknown[], serverMaxRows: number) {
  function builder(table: string) {
    let range: [number, number] | null = null;
    const api = {
      select: () => api,
      eq: () => api,
      gte: () => api,
      lte: () => api,
      order: () => api,
      range: (from: number, to: number) => {
        range = [from, to];
        return api;
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
        if (table === "profiles") {
          const [from, to] = range ?? [0, allReps.length - 1];
          // The server clips the window to its own cap, whatever was asked for.
          const cappedTo = Math.min(to, from + serverMaxRows - 1);
          resolve({ data: allReps.slice(from, cappedTo + 1), error: null });
          return;
        }
        // targets / daily_plans / visits: empty is enough for this test.
        resolve({ data: [], error: null });
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) };
}

function fakeRep(i: number) {
  return { id: `rep-${i}`, name: `Rep ${i}`, role: "rep" };
}

describe("getTeamWeek — paging the lead's own rep list past the server's row cap", () => {
  it("returns every rep even when the server caps each page far below the loop's step", async () => {
    const allReps = Array.from({ length: 25 }, (_, i) => fakeRep(i));
    // Simulates a hosted project whose db.max_rows is 10 — far below the 1000
    // step the pagination loop requests per page.
    const client = fakeClient(allReps, 10);

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn().mockResolvedValue(client),
    }));

    const { getTeamWeek } = await import("@/lib/week-summary");
    const result = await getTeamWeek("2026-01-05");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.members).toHaveLength(25);
      expect(result.members.map((m) => m.member)).toEqual(allReps.map((r) => r.id));
    }

    vi.resetModules();
  });
});
