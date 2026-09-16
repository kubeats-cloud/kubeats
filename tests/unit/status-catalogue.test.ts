import { describe, expect, it } from "vitest";
import {
  SEED_STATUSES,
  SEED_STATUS_CATALOGUE,
  STATUS_CATEGORIES,
  STATUS_TONES,
  isClosedStatus,
  isOpenStatus,
  selectableStatuses,
  statusCategory,
  statusRow,
  statusesInCategory,
  type StatusCatalogue,
} from "@/lib/validation/institute";
import { eventDateRequired, makeVisitSchema } from "@/lib/validation/visit";

/**
 * Stage 4a — the status vocabulary is data, and the app asks rather than knows.
 *
 * Migration 0026 converted `institutes.status` and `visits.status_set_to` from
 * CHECK constraints listing nine literals into foreign keys to
 * `public.institute_statuses`. So the app can no longer hold the list: an admin
 * can add a status, and a constant in the bundle could not know about it.
 *
 * `SEED_STATUS_CATALOGUE` is what is left — the nine a fresh database is
 * created with, and the fallback if the read fails. These tests are about the
 * SHAPE of an arbitrary catalogue, not about those nine, because that is what
 * has to keep working when the vocabulary grows.
 */

/** A catalogue with a status no constant in this repo has ever heard of. */
const WITH_ADMIN_ADDED: StatusCatalogue = [
  ...SEED_STATUS_CATALOGUE,
  {
    status: "Awaiting trustee sign-off",
    category: "open",
    tone: "danger",
    sortOrder: 100,
    isActive: true,
    asksExpectedDate: false,
    asksSessionDetail: false,
    asksHeadCount: false,
  },
  {
    status: "Merged into another campus",
    category: "closed",
    tone: "neutral",
    sortOrder: 101,
    isActive: false,
    asksExpectedDate: false,
    asksSessionDetail: false,
    asksHeadCount: false,
  },
];

describe("the seed still describes the nine correctly", () => {
  it("has nine statuses, each with a valid category and tone", () => {
    expect(SEED_STATUS_CATALOGUE).toHaveLength(9);
    for (const row of SEED_STATUS_CATALOGUE) {
      expect(STATUS_CATEGORIES, row.status).toContain(row.category);
      expect(STATUS_TONES, row.status).toContain(row.tone);
      expect(row.isActive, row.status).toBe(true);
    }
  });

  it("asks for session detail on exactly one status, and a head count on two", () => {
    // These two facts were `needsSessionDetail()` and `needsCampusCount()`,
    // each comparing the status to a literal. Migration 0026 asserts the same
    // pairing against the live table, so the two halves cannot drift.
    expect(
      SEED_STATUS_CATALOGUE.filter((r) => r.asksSessionDetail).map((r) => r.status),
    ).toEqual(["Session done"]);
    expect(
      SEED_STATUS_CATALOGUE.filter((r) => r.asksHeadCount).map((r) => r.status),
    ).toEqual(["Session done", "Campus visit done"]);
  });

  it("never asks for a head count without meaning it", () => {
    // A status that asks for session detail must also take the count: a topic
    // and who ran it, with no idea how many were there, is a worse record than
    // either alone.
    for (const row of SEED_STATUS_CATALOGUE) {
      if (row.asksSessionDetail) expect(row.asksHeadCount, row.status).toBe(true);
    }
  });
});

describe("the helpers work on a catalogue they have never seen", () => {
  it("resolves a status an admin added", () => {
    // The whole point of stage 4a. Before it, this status was not in any
    // constant, so it had no category — and `isOpenStatus()` would answer
    // false, FO016 would still demand a follow-up, and the rep would be refused
    // by the database with nothing on screen explaining why.
    expect(statusCategory(WITH_ADMIN_ADDED, "Awaiting trustee sign-off")).toBe("open");
    expect(isOpenStatus(WITH_ADMIN_ADDED, "Awaiting trustee sign-off")).toBe(true);
    expect(statusRow(WITH_ADMIN_ADDED, "Awaiting trustee sign-off")?.tone).toBe(
      "danger",
    );
  });

  it("still answers null for a status no catalogue has", () => {
    // Unknown is NOT closed. Treating it as closed would quietly finish a loop
    // that nobody finished.
    expect(statusCategory(WITH_ADMIN_ADDED, "Principal said maybe")).toBeNull();
    expect(isOpenStatus(WITH_ADMIN_ADDED, "Principal said maybe")).toBe(false);
    expect(isClosedStatus(WITH_ADMIN_ADDED, "Principal said maybe")).toBe(false);
    expect(statusCategory(WITH_ADMIN_ADDED, null)).toBeNull();
  });

  it("offers an admin-added status, and never a retired one", () => {
    const open = statusesInCategory(WITH_ADMIN_ADDED, "open");
    const closed = statusesInCategory(WITH_ADMIN_ADDED, "closed");

    expect(open).toContain("Awaiting trustee sign-off");
    // Retired: gone from the picker, and still resolvable for the visits that
    // already carry it. That is the difference between retiring and deleting,
    // and it is why 0026's foreign keys restrict a delete.
    expect(closed).not.toContain("Merged into another campus");
    expect(statusCategory(WITH_ADMIN_ADDED, "Merged into another campus")).toBe(
      "closed",
    );
  });

  it("orders by sortOrder and breaks ties by name", () => {
    // 0026 drops the UNIQUE on sort_order — it was a trap for rows written by
    // people — so ties are possible and have to resolve the same way on every
    // render, or the dropdown reshuffles itself between requests.
    const tied: StatusCatalogue = [
      { ...SEED_STATUS_CATALOGUE[0], status: "Beta", sortOrder: 5 },
      { ...SEED_STATUS_CATALOGUE[0], status: "Alpha", sortOrder: 5 },
      { ...SEED_STATUS_CATALOGUE[0], status: "Early", sortOrder: 1 },
    ];
    expect(statusesInCategory(tied, "open")).toEqual(["Early", "Alpha", "Beta"]);
  });

  it("selectableStatuses is both categories, open first", () => {
    const all = selectableStatuses(WITH_ADMIN_ADDED);
    expect(all).toEqual([
      ...statusesInCategory(WITH_ADMIN_ADDED, "open"),
      ...statusesInCategory(WITH_ADMIN_ADDED, "closed"),
    ]);
    expect(all).not.toContain("Merged into another campus");
  });

  it("copes with an empty catalogue rather than throwing", () => {
    // Not reachable through listStatusCatalogue(), which falls back to the
    // seed — but these are pure functions and something else may call them one
    // day with whatever it has.
    expect(statusCategory([], "Session done")).toBeNull();
    expect(statusesInCategory([], "open")).toEqual([]);
    expect(selectableStatuses([])).toEqual([]);
  });
});

describe("SEED_STATUSES is a seed, not the vocabulary", () => {
  it("lists the seeded nine and nothing else", () => {
    expect(SEED_STATUSES).toHaveLength(9);
    expect(SEED_STATUSES).toEqual(SEED_STATUS_CATALOGUE.map((r) => r.status));
  });

  it("is a SUBSET of a catalogue that has grown, not the whole of it", () => {
    // The assertion that would have caught the old mistake: anything treating
    // this constant as the complete list is wrong the moment an admin adds one.
    for (const status of SEED_STATUSES) {
      expect(statusCategory(WITH_ADMIN_ADDED, status)).not.toBeNull();
    }
    expect(WITH_ADMIN_ADDED.length).toBeGreaterThan(SEED_STATUSES.length);
  });
});

/**
 * Stage 4b — a visit must say where it left the institute.
 *
 * "No change" was an option on Log Visit from 0001 until now, and it is gone.
 * Not as a tidy-up: stage 5 rebuilds Pending around institutes whose CURRENT
 * status is open, and a visit that set no status contributes nothing to that.
 * It is not a follow-up owed and it is not a closed loop — it is absent, for
 * ever, with nothing anywhere to say it went missing.
 *
 * `enforce_status_required()` (FO024, migration 0027) is the backstop and is
 * INSERT-only, so every visit logged under "No change" stays legal and
 * readable. These are what stop a rep reaching it.
 */
describe("a status is compulsory on a new visit", () => {
  const base = {
    activity: "olympiad",
    institute_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    daily_plan_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3399",
    lifecycle_status: "",
    expected_date: "",
    latitude: "",
    longitude: "",
    photo_path: "9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d/proof.jpg",
    notes: "",
    status_set_to: "RSVP received",
    follow_up_date: "",
    follow_up_time: "",
  };
  const schema = makeVisitSchema(SEED_STATUS_CATALOGUE);

  it("refuses a visit that names no status", () => {
    const result = schema.safeParse({ ...base, status_set_to: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "status_set_to");
      expect(issue?.message).toBe("Say where this visit leaves the institute.");
    }
  });

  it("refuses whitespace, which is what a tampered hidden field looks like", () => {
    expect(schema.safeParse({ ...base, status_set_to: "   " }).success).toBe(false);
  });

  it("accepts any status the catalogue offers", () => {
    for (const status of selectableStatuses(SEED_STATUS_CATALOGUE)) {
      const open = isOpenStatus(SEED_STATUS_CATALOGUE, status);
      const result = schema.safeParse({
        ...base,
        status_set_to: status,
        // Rule 5 is unchanged and orthogonal: an open status still owes a date.
        follow_up_date: open ? "2026-10-15" : "",
        // Rule 3 now hangs off the status too — asks_expected_date, rather than
        // the purpose's lifecycle — so four of the nine want this as well.
        expected_date: eventDateRequired(SEED_STATUS_CATALOGUE, status)
          ? "2026-10-20"
          : "",
      });
      expect(result.success, `${status}: ${result.error?.message}`).toBe(true);
    }
  });

  it("accepts a status an ADMIN added, built against that catalogue", () => {
    // The whole point of 4a + 4b together. A schema holding the seeded nine
    // would refuse the very value the database is about to accept.
    const admins = makeVisitSchema(WITH_ADMIN_ADDED);
    const result = admins.safeParse({
      ...base,
      status_set_to: "Awaiting trustee sign-off",
      follow_up_date: "2026-10-15", // it is open, so Rule 5 applies
    });
    expect(result.success, result.error?.message).toBe(true);

    // ...and the seeded schema, which has never heard of it, refuses it. That
    // is the failure this arrangement exists to prevent in production.
    expect(
      makeVisitSchema(SEED_STATUS_CATALOGUE).safeParse({
        ...base,
        status_set_to: "Awaiting trustee sign-off",
        follow_up_date: "2026-10-15",
      }).success,
    ).toBe(false);
  });

  it("refuses a RETIRED status, because it is no longer offered", () => {
    // Retired means "not for new visits". The visits already carrying it stay
    // readable — statusCategory() still resolves it — but a rep cannot pick it,
    // and the schema is what makes that true rather than just the dropdown.
    expect(
      makeVisitSchema(WITH_ADMIN_ADDED).safeParse({
        ...base,
        status_set_to: "Merged into another campus",
      }).success,
    ).toBe(false);
    expect(statusCategory(WITH_ADMIN_ADDED, "Merged into another campus")).toBe(
      "closed",
    );
  });
});
