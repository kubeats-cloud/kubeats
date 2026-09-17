import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import {
  eventDateRequired,
  makeVisitSchema,
  postedEventDate,
} from "@/lib/validation/visit";

/**
 * Defect A: "Session done" and "Campus visit done" could not be saved at all.
 *
 * WHAT THE BUG WAS. Log Visit shows its date box when the chosen STATUS asks
 * for one — `needsDate = eventDateRequired(catalogue, status)`, which migration
 * 0026 put on `institute_statuses` and stage D3 wired the visible field and
 * `visitSchema` to. The HIDDEN input that carries the typed value up was never
 * moved with them: it still read the planned PURPOSE's lifecycle,
 * `value={lifecycleStatus === "Set" ? expectedDate : ""}`.
 *
 * For the two "done" statuses those two questions give opposite answers. A rep
 * completing a session planned under "Complete a session" (lifecycle "Done")
 * saw the date field, filled it in, submitted — and posted an empty string. The
 * schema refused the visit for a date that was on the screen in front of them,
 * and retrying could not help, because the box they were being pointed at was
 * already full. A completed session was unsaveable.
 *
 * WHY THIS TESTS A FUNCTION AND NOT THE DOM. This project has no DOM test
 * environment on purpose — vitest.config.mts documents the split, and
 * log-visit-form.test.ts explains why adding one is an architectural decision
 * rather than a side effect of a bug fix. So the rule the hidden input applies
 * lives in `postedEventDate()`, which is pure, and the form is checked at
 * source level for still calling it. Between them that is the whole regression.
 */

const CATALOGUE = SEED_STATUS_CATALOGUE;
const TYPED = "2026-03-18";

/**
 * The four statuses that ask for a date, and the reason each pair exists.
 *
 * SCHEDULED is a plan about a future day; DONE is the record of the day it
 * happened on. The bug only ever showed on the second pair — those are the two
 * a rep reaches while planned under a "Done" purpose — which is exactly why
 * both pairs are listed here rather than only the broken ones. A fix that
 * repaired "done" by breaking "scheduled" would pass a narrower test.
 */
const ASKS_A_DATE = [
  "Session done",
  "Campus visit done",
  "Session scheduled",
  "Campus visit scheduled",
] as const;

const ASKS_NO_DATE = [
  "First meeting done",
  "Pending for management approval",
  "Invited principal for event",
  "RSVP received",
  "Will not come",
] as const;

describe("the hidden expected_date carries what the rep typed", () => {
  it.each(ASKS_A_DATE)("%s transports the date", (status) => {
    // The visible field is shown for these...
    expect(eventDateRequired(CATALOGUE, status), "shows the box").toBe(true);
    // ...so the hidden one must post what was typed into it. This is the
    // assertion that was false for the two "done" statuses.
    expect(postedEventDate(CATALOGUE, status, TYPED)).toBe(TYPED);
  });

  it.each(ASKS_NO_DATE)("%s posts nothing, even after a date was typed", (status) => {
    expect(eventDateRequired(CATALOGUE, status), "hides the box").toBe(false);
    // The smaller half of the same defect: a rep who chose "Session scheduled",
    // typed a date and then changed to a status with no date must not carry the
    // stale one up. expected_date is a plan about a future day; on a status
    // with no such day it would mean nothing.
    expect(postedEventDate(CATALOGUE, status, TYPED)).toBe("");
  });

  it("posts nothing before a status has been chosen at all", () => {
    expect(postedEventDate(CATALOGUE, null, TYPED)).toBe("");
  });

  it("covers every status in the catalogue, so a new one cannot be missed", () => {
    // If someone seeds a tenth status, this fails until it is classified above
    // rather than quietly going untested.
    const listed = [...ASKS_A_DATE, ...ASKS_NO_DATE].toSorted();
    expect(CATALOGUE.map((row) => row.status).toSorted()).toEqual(listed);
  });
});

/**
 * The end the rep actually feels: what the form posts is what the schema wants.
 *
 * The two halves were checked against different questions, so proving they now
 * agree means running the value the form produces through the validator that
 * refused it. This is the test that would have caught the defect from either
 * side — moving the hidden field back, or moving the schema.
 */
describe("what the form posts is what the schema accepts", () => {
  const schema = makeVisitSchema(CATALOGUE);

  const post = (status: string) => ({
    activity: "session",
    institute_id: "6d9c2a7e-3f0b-4c1a-9b2e-5a7c8d1e4f30",
    daily_plan_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    lifecycle_status: status.endsWith("done") ? "Done" : "Set",
    // The one field under test, produced exactly as the form produces it.
    expected_date: postedEventDate(CATALOGUE, status, TYPED),
    status_set_to: status,
    follow_up_date: "",
    // Dormant since 0023, still a key the form posts. See visitSchema.
    follow_up_time: "",
    notes: "Held as planned.",
    photo_path: `${"a".repeat(8)}/visit.jpg`,
    latitude: "23.0225",
    longitude: "72.5714",
  });

  it.each(["Session done", "Campus visit done"])(
    "%s saves — the defect made this impossible",
    (status) => {
      const parsed = schema.safeParse(post(status));
      // Before the fix this failed on expected_date with the box filled in.
      expect(
        parsed.success ? null : parsed.error.issues.map((i) => i.path.join(".")),
        "no field should be rejected",
      ).toBeNull();
    },
  );

  it.each(["Session scheduled", "Campus visit scheduled"])(
    "%s still saves, with the follow-up its open category demands",
    (status) => {
      // Both are OPEN, so Rule 5 wants a follow-up date as well. Asserted here
      // so a fix that quietly loosened the open-status rule would show up.
      const withoutFollowUp = schema.safeParse(post(status));
      expect(withoutFollowUp.success, "open status still needs a follow-up").toBe(
        false,
      );

      const parsed = schema.safeParse({
        ...post(status),
        follow_up_date: "2026-03-25",
      });
      expect(
        parsed.success ? null : parsed.error.issues.map((i) => i.path.join(".")),
      ).toBeNull();
    },
  );
});

/**
 * The form still asks the status, not the purpose.
 *
 * `postedEventDate` cannot prevent the regression on its own — the defect was
 * the form not calling it. Source-level, for the same reason
 * log-visit-form.test.ts is: there is no DOM here to render into.
 */
describe("Log Visit drives the hidden field off the status", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../src/components/visits/log-visit-form.tsx", import.meta.url)),
    "utf8",
  );

  it("posts expected_date through postedEventDate", () => {
    expect(source).toContain('name="expected_date"');
    expect(source).toContain("postedEventDate(catalogue, status, expectedDate)");
  });

  it("never keys the date off the planned lifecycle again", () => {
    // The exact shape of the bug. `lifecycleStatus` itself stays — it is what
    // the lifecycle_status field carries — so this looks for the TEST, not the
    // variable.
    expect(source).not.toMatch(/lifecycleStatus\s*===\s*"Set"\s*\?/);
  });

  it("shows the visible field off the same question", () => {
    // Both halves read eventDateRequired, one directly and one through the
    // helper. If the visible field is ever moved back onto the lifecycle, this
    // is the line that says they have to travel together.
    expect(source).toContain("const needsDate = eventDateRequired(catalogue, status)");
  });
});
