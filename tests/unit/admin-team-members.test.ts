import { describe, expect, it, vi } from "vitest";

/**
 * listTeamMembers() must not lose a member to the hosted project's own
 * PostgREST row cap (`db.max_rows`) — Supabase ships every new project with
 * that set to 1000, and a project can be configured lower still. A bare
 * `.select()` with no `.range()` is silently capped at that figure: nothing
 * errors, the page just comes back short. Every screen that assigns a rep to
 * a team lead reads this list, so a rep past the cap never renders anywhere
 * and could never be assigned at all — not refused, just never offered.
 *
 * The fake client below enforces its own small "server" cap on `profiles`
 * regardless of the `.range()` window the caller asks for, exactly like a
 * real PostgREST instance would. The regression this guards is the loop
 * trusting a single page's length instead of paging until one comes back
 * short.
 */

const logError = vi.fn();
vi.mock("@/lib/errors", () => ({ logError: (...args: unknown[]) => logError(...args) }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "admin-1",
    email: "admin@example.com",
    profile: null,
    profileStatus: "ready",
    role: "admin",
    name: "Admin",
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }) } },
  }),
}));

/** A server whose PostgREST is configured with a small `db.max_rows`. */
function fakeServerClient(allProfiles: unknown[], serverMaxRows: number) {
  function builder(table: string) {
    let range: [number, number] | null = null;
    const api = {
      select: () => api,
      order: () => api,
      not: () => api,
      is: () => api,
      range: (from: number, to: number) => {
        range = [from, to];
        return api;
      },
      then: (
        resolve: (value: { data: unknown[]; error: null }) => void,
      ) => {
        if (table === "profiles") {
          const [from, to] = range ?? [0, allProfiles.length - 1];
          // The server clips the window to its own cap, whatever the client asked for.
          const cappedTo = Math.min(to, from + serverMaxRows - 1);
          resolve({ data: allProfiles.slice(from, cappedTo + 1), error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) };
}

function fakeProfile(i: number) {
  return {
    id: `rep-${i}`,
    name: `Rep ${i}`,
    role: "rep",
    created_at: null,
    campus_id: "campus-1",
    campuses: { name: "Campus 1" },
    created_by: null,
    team_lead_id: "lead-1",
  };
}

describe("listTeamMembers — paging past the server's own row cap", () => {
  it("returns every member even when the server caps each page far below the loop's step", async () => {
    const allProfiles = Array.from({ length: 25 }, (_, i) => fakeProfile(i));
    // Simulates a hosted project whose db.max_rows is 10 — far below the 1000
    // step the pagination loop requests per page.
    const client = fakeServerClient(allProfiles, 10);

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn().mockResolvedValue(client),
    }));

    const { listTeamMembers } = await import("@/lib/admin");
    const members = await listTeamMembers();

    expect(members).toHaveLength(25);
    expect(members.map((m) => m.id)).toEqual(allProfiles.map((p) => p.id));
    expect(logError).not.toHaveBeenCalled();

    vi.resetModules();
  });

  it("still returns every member when the server has no cap tighter than the loop's step", async () => {
    const allProfiles = Array.from({ length: 5 }, (_, i) => fakeProfile(i));
    const client = fakeServerClient(allProfiles, 1000);

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn().mockResolvedValue(client),
    }));

    const { listTeamMembers } = await import("@/lib/admin");
    const members = await listTeamMembers();

    expect(members).toHaveLength(5);

    vi.resetModules();
  });
});
