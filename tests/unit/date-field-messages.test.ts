import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import {
  eventDateLabel,
  eventDateRequired,
  fieldLabel,
  makeVisitSchema,
} from "@/lib/validation/visit";

/**
 * The two things a rep reads about the date field, and what was wrong with each.
 *
 * #14 THE ARTICLE. `Pick a ${eventDateLabel(...)}` produced "Pick a Expected
 *     Session Date." — because the label starts with a vowel on every OPEN
 *     status, which is the half of the vocabulary a rep meets most. Fixed by
 *     rewording rather than by choosing between "a" and "an": there is one date
 *     being asked about, so "the" is both correct and immune to the next label.
 *
 * #5  THE STALE ERROR, AND THE THIRD NAME. Submitting "Session scheduled" with
 *     no date and then switching to "RSVP received" left the refusal on screen,
 *     pointing at a control the switch had just unmounted — and the summary
 *     titled it "Tentative date" while the message inside it said "Session
 *     Date", so it read as two different fields.
 */

const CATALOGUE = SEED_STATUS_CATALOGUE;
const schema = makeVisitSchema(CATALOGUE);

const ASKS_A_DATE = [
  "Session scheduled",
  "Session done",
  "Campus visit scheduled",
  "Campus visit done",
] as const;

/* ------------------------------------------------------------------ */
/* #14 — the article                                                   */
/* ------------------------------------------------------------------ */

describe("the missing-date message is grammatical for every status", () => {
  const refusalFor = (status: string) => {
    const parsed = schema.safeParse({
      activity: "session",
      institute_id: "6d9c2a7e-3f0b-4c1a-9b2e-5a7c8d1e4f30",
      daily_plan_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      lifecycle_status: status.endsWith("done") ? "Done" : "Set",
      expected_date: "",
      status_set_to: status,
      follow_up_date: "2026-03-25",
      follow_up_time: "",
      notes: "Went well.",
      photo_path: "aaaaaaaa/visit.jpg",
      latitude: "23.0225",
      longitude: "72.5714",
    });
    if (parsed.success) return null;
    return parsed.error.issues.find((i) => i.path[0] === "expected_date")?.message ?? null;
  };

  it.each(ASKS_A_DATE)("%s is refused with a sentence that reads", (status) => {
    const message = refusalFor(status);
    expect(message, "the date is still required").not.toBeNull();

    // THE REGRESSION. "a Expected ..." was the exact output for the two open
    // statuses, and "an Session ..." would be the mirror-image mistake if
    // somebody "fixed" it by flipping the article instead of rewording.
    expect(message).not.toMatch(/\ba (?=[AEIOU])/);
    expect(message).not.toMatch(/\ban (?=[^AEIOU])/);

    // And it still names the box the rep is looking at, which is the whole
    // reason the label is interpolated rather than hard-coded.
    expect(message).toContain(eventDateLabel(CATALOGUE, status));
  });

  it("says the same thing about every label the function can produce", () => {
    // eventDateLabel is derived from the status NAME and CATEGORY, so a status
    // an admin adds produces a label this message has never seen. The wording
    // has to be correct for all of them, not just the seeded four.
    for (const status of ASKS_A_DATE) {
      expect(refusalFor(status)).toBe(
        `Pick the ${eventDateLabel(CATALOGUE, status)}.`,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* #5 — the stale error and the mismatched label                       */
/* ------------------------------------------------------------------ */

/**
 * The filter Log Visit applies, restated here as the rule it encodes.
 *
 * The component holds this inline — there is no DOM environment to render it in
 * — so this asserts the DECISION that drives it: which of the two conditional
 * fields a given status still asks for. If the filter and this ever disagree,
 * one of them is showing an error about a field nobody can see.
 */
describe("an error about a field the status no longer asks for is dropped", () => {
  const surviving = (status: string | null, keys: string[]) =>
    keys.filter((key) => {
      if (key === "expected_date") return eventDateRequired(CATALOGUE, status);
      if (key === "follow_up_date") {
        const row = CATALOGUE.find((entry) => entry.status === status);
        return row?.category === "open";
      }
      return true;
    });

  it("keeps the date error while the status still wants a date", () => {
    expect(surviving("Session scheduled", ["expected_date"])).toEqual([
      "expected_date",
    ]);
  });

  it("drops it the moment the status stops wanting one", () => {
    // The reported path: "Session scheduled" refused, then switched to "RSVP
    // received", whose panel has no date box at all.
    expect(surviving("RSVP received", ["expected_date"])).toEqual([]);
    expect(surviving("First meeting done", ["expected_date"])).toEqual([]);
  });

  it("drops a stale follow-up error the same way", () => {
    // Not in the report, but the same shape and the same two lines: an open
    // status demands a follow-up, a closed one does not.
    expect(surviving("Session scheduled", ["follow_up_date"])).toEqual([
      "follow_up_date",
    ]);
    expect(surviving("Session done", ["follow_up_date"])).toEqual([]);
  });

  it("never drops an error about a field that is always on screen", () => {
    // The filter must be narrow. Photo, notes and the status itself are not
    // conditional, so no status may hide their errors.
    expect(
      surviving("RSVP received", ["photo_path", "notes", "status_set_to"]),
    ).toEqual(["photo_path", "notes", "status_set_to"]);
  });

  it("drops everything conditional before a status is chosen at all", () => {
    expect(surviving(null, ["expected_date", "follow_up_date"])).toEqual([]);
  });
});

describe("the date field has ONE name", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../src/components/visits/log-visit-form.tsx", import.meta.url),
    ),
    "utf8",
  );

  it("labels the error summary with the same words as the control", () => {
    // The summary read "Tentative date" while the control read "Expected
    // Session Date" and the message read "Session Date". Three names, one box.
    expect(source).toContain("labelFor={labelForField}");
    expect(source).toContain(
      'key === "expected_date" ? eventDateLabel(catalogue, status) : fieldLabel(key)',
    );
  });

  it("filters both conditional fields out of the errors it shows", () => {
    expect(source).toContain('if (key === "expected_date") return needsDate;');
    expect(source).toContain('if (key === "follow_up_date") return needsFollowUp;');
  });

  it("leaves fieldLabel's own answer alone for every other caller", () => {
    // Other screens have no status to ask, so the map still needs an entry.
    expect(fieldLabel("expected_date")).toBe("Tentative date");
  });
});
