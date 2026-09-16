import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_ACCURACY_FIELD,
  CHECKOUT_LAT_FIELD,
  CHECKOUT_LNG_FIELD,
  appendCheckoutFix,
  checkoutFixFromFormData,
} from "@/lib/validation/checkin";

/**
 * The check-out has a position of its own, and it is never the check-in's.
 *
 * WHAT CHANGED, AND WHAT DID NOT. `daily_plans` has carried `checkout_lat` and
 * `checkout_lng` since migration 0014 and `checkout_accuracy` since 0015, and
 * `close_visit()` has accepted and written all three since 0018. The app passed
 * literal nulls into them, so every departure in the database is a bare
 * timestamp. Nothing in the schema needed to move to fix that — only the two
 * client forms that end a visit, which now ask the device where the rep is as
 * they leave.
 *
 * THE FAILURE THIS GUARDS AGAINST is not "no position recorded". It is a
 * position recorded that was never taken: the arrival's coordinates copied
 * across, a remembered fix from earlier in the day, the institute's registered
 * address standing in for the ground the phone was on. Any of those would make
 * an admin's Field presence view read as though a rep left from the gate they
 * arrived at, whatever they actually did. An unlocated departure is a fact and
 * prints as one.
 *
 * Nothing here may refuse a submission either. A closing report that cannot be
 * filed is a visit that never happened, and a coordinate nobody asked the rep
 * for is not worth that.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

/**
 * The same source with its comments stripped out.
 *
 * Needed wherever an assertion is about what a rep or an admin READS. A comment
 * explaining that a sentence was removed contains that sentence, so a check for
 * its absence would fail on the note that documents its removal — and a file
 * that explains itself well would be the one that failed hardest.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

function formWith(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("reading a departure position off the form", () => {
  it("takes a complete reading", () => {
    const fix = checkoutFixFromFormData(
      formWith({
        [CHECKOUT_LAT_FIELD]: "23.2039",
        [CHECKOUT_LNG_FIELD]: "72.5844",
        [CHECKOUT_ACCURACY_FIELD]: "91",
      }),
    );
    expect(fix).toEqual({ latitude: 23.2039, longitude: 72.5844, accuracy: 91 });
  });

  it("keeps a position whose accuracy the browser declined to give", () => {
    const fix = checkoutFixFromFormData(
      formWith({
        [CHECKOUT_LAT_FIELD]: "23.2039",
        [CHECKOUT_LNG_FIELD]: "72.5844",
        [CHECKOUT_ACCURACY_FIELD]: "",
      }),
    );
    expect(fix).toEqual({
      latitude: 23.2039,
      longitude: 72.5844,
      accuracy: null,
    });
  });

  it("records nothing when the device said nothing", () => {
    expect(checkoutFixFromFormData(new FormData())).toEqual({
      latitude: null,
      longitude: null,
      accuracy: null,
    });
  });

  /**
   * `daily_plans_checkout_coords_paired` (0016) refuses half a position, and it
   * would refuse it on a submit the rep has no way to correct. Dropped whole
   * here instead.
   */
  it("drops half a position rather than letting the database refuse it", () => {
    const fix = checkoutFixFromFormData(
      formWith({ [CHECKOUT_LAT_FIELD]: "23.2039", [CHECKOUT_LNG_FIELD]: "" }),
    );
    expect(fix.latitude).toBeNull();
    expect(fix.longitude).toBeNull();
  });

  /**
   * An accuracy with no coordinates describes nothing, and would render as a
   * confident-looking "±91 m (good)" badge over no place at all.
   */
  it("never keeps an accuracy with no position under it", () => {
    const fix = checkoutFixFromFormData(
      formWith({ [CHECKOUT_ACCURACY_FIELD]: "91" }),
    );
    expect(fix.accuracy).toBeNull();
  });

  it.each([
    ["off the globe", { [CHECKOUT_LAT_FIELD]: "200", [CHECKOUT_LNG_FIELD]: "72.5" }],
    ["not a number", { [CHECKOUT_LAT_FIELD]: "here", [CHECKOUT_LNG_FIELD]: "72.5" }],
    [
      "a negative accuracy",
      {
        [CHECKOUT_LAT_FIELD]: "23.2",
        [CHECKOUT_LNG_FIELD]: "72.5",
        [CHECKOUT_ACCURACY_FIELD]: "-1",
      },
    ],
  ])("gives back nothing rather than throwing on %s", (_case, values) => {
    expect(() => checkoutFixFromFormData(formWith(values))).not.toThrow();
    expect(checkoutFixFromFormData(formWith(values)).latitude).toBeNull();
  });
});

describe("putting a departure position onto the form", () => {
  it("writes all three when there is a reading", () => {
    const formData = new FormData();
    appendCheckoutFix(formData, {
      latitude: 23.2039,
      longitude: 72.5844,
      accuracy: 91,
    });
    expect(formData.get(CHECKOUT_LAT_FIELD)).toBe("23.2039");
    expect(formData.get(CHECKOUT_LNG_FIELD)).toBe("72.5844");
    expect(formData.get(CHECKOUT_ACCURACY_FIELD)).toBe("91");
  });

  /**
   * THE ONE THAT MATTERS. A null fix leaves the fields absent, so close_visit()
   * stores nulls and the admin's view says "Location unavailable". It must not
   * quietly become the arrival's position, and the arrival's own fields — which
   * ARE on the same form, as `latitude` and `longitude` for the visit photo —
   * must be left exactly as they were.
   */
  it("writes nothing at all when there is no reading", () => {
    const formData = formWith({ latitude: "23.0225", longitude: "72.5714" });
    appendCheckoutFix(formData, null);
    expect(formData.has(CHECKOUT_LAT_FIELD)).toBe(false);
    expect(formData.has(CHECKOUT_LNG_FIELD)).toBe(false);
    expect(formData.has(CHECKOUT_ACCURACY_FIELD)).toBe(false);
    // Untouched, and not the source of anything above.
    expect(formData.get("latitude")).toBe("23.0225");
  });

  it("round-trips through the reader", () => {
    const formData = new FormData();
    appendCheckoutFix(formData, {
      latitude: 23.2039,
      longitude: 72.5844,
      accuracy: null,
    });
    expect(checkoutFixFromFormData(formData)).toEqual({
      latitude: 23.2039,
      longitude: 72.5844,
      accuracy: null,
    });
  });
});

/**
 * The wiring, at the only level this project can reach.
 *
 * There is no DOM test environment here on purpose (vitest.config.mts), so the
 * two client forms and the server action are read as source — the same bargain
 * `log-visit-form.test.ts` and `capture-fields.test.ts` strike. What is checked
 * is the thing that would silently undo the feature: the three hard-coded nulls
 * coming back.
 */
describe("both paths that end a visit send the departure position", () => {
  const ACTIONS = read("src/lib/feedback-actions.ts");

  it("close_visit is no longer handed three nulls", () => {
    expect(ACTIONS).not.toContain("p_checkout_lat: null");
    expect(ACTIONS).not.toContain("p_checkout_lng: null");
    expect(ACTIONS).not.toContain("p_checkout_accuracy: null");
    expect(ACTIONS).toContain("p_checkout_lat: checkoutFix.latitude");
  });

  it("reads the position outside both validation schemas", () => {
    // Inside either one, a bad coordinate becomes a field error and a rep
    // cannot file their report. It has to be unable to do that.
    expect(ACTIONS).toContain("checkoutFixFromFormData(formData)");
    expect(ACTIONS.match(/checkoutFixFromFormData\(formData\)/g)).toHaveLength(2);
  });

  it.each([
    "src/components/visits/log-visit-form.tsx",
    "src/components/visits/feedback-only-form.tsx",
  ])("%s takes a fix at the submit that ends the visit", (file) => {
    const source = read(file);
    expect(source).toContain("checkoutFix()");
    expect(source).toContain("appendCheckoutFix(formData");
    // Taken at the tap, not at mount: a fix read when the form appeared would
    // be the arrival over again, which is the substitution this whole file is
    // about.
    expect(source).toMatch(/onSubmit=\{/);
    expect(source).not.toMatch(/useEffect\([^)]*checkoutFix/);
  });
});

/**
 * Both ends name their own square, or the address row can never be filled.
 *
 * Area names are read back out of `place_cache`, and only `/api/place` may
 * write to it. A position nobody has ever looked up has no name, however good
 * the coordinates are — so an arrival that never asks is an arrival whose
 * "Location / address" row reads "Area unavailable" for ever. That was the
 * state of the check-in until now; the photo's own lookup is taken later and at
 * a different position, so it covered the same cell only by coincidence.
 */
describe("both ends ask for the name of the place they recorded", () => {
  it.each([
    ["the arrival", "src/components/dashboard/check-buttons.tsx"],
    ["the departure", "src/lib/geolocate.ts"],
  ])("%s looks the area up", (_end, file) => {
    expect(read(file)).toContain("nameArea(");
  });

  it("never lets the lookup hold up the arrival", () => {
    // The coordinates are already captured by this point. A rep confirming a
    // check-in must not wait on decoration.
    expect(read("src/components/dashboard/check-buttons.tsx")).toContain(
      "void nameArea(",
    );
  });
});

/**
 * The admin's half: the same four facts on both sides, and no stand-ins.
 */
describe("Field presence shows both ends the same way", () => {
  const SUMMARY = read("src/components/report/activity-summary.tsx");

  it("renders both ends through one component", () => {
    // Two hand-written cells are what let the check-in and the check-out drift
    // apart in the first place. One component cannot drift from itself.
    expect(SUMMARY).toContain("function PresencePanel");
    expect(SUMMARY).toContain('title="Checked in"');
    expect(SUMMARY).toContain('title="Checked out"');
  });

  it.each([
    "Date & time",
    "GPS coordinates",
    "Location / address",
    "GPS accuracy",
  ])("asks both ends for %s", (label) => {
    expect(SUMMARY).toContain(`label="${label}"`);
  });

  it("says so plainly when a reading was never taken", () => {
    expect(SUMMARY).toContain("LOCATION_UNAVAILABLE");
    expect(SUMMARY).toContain("ACCURACY_UNAVAILABLE");
  });

  it("takes the duration from the two real timestamps", () => {
    // visitMinutes returns null unless it has both, so a swept or
    // admin-cleared visit reads "Not recorded" rather than a made-up figure.
    expect(SUMMARY).toContain("formatDuration(visit.minutes)");
  });

  it("never reaches for the arrival to fill in the departure", () => {
    // The specific substitution the client asked us to rule out: every prop the
    // check-out panel is given comes off a checkout* field.
    const from = SUMMARY.indexOf('title="Checked out"');
    expect(from).toBeGreaterThan(-1);
    const checkoutPanel = SUMMARY.slice(from, SUMMARY.indexOf("/>", from));
    expect(checkoutPanel).not.toContain("checkin");
    expect(checkoutPanel).toContain("visit.checkoutLat");
    expect(checkoutPanel).toContain("visit.checkoutArea");
  });
});

/**
 * The "Still checked in" confirmation, cut back to what the client asked for.
 *
 * The behaviour behind it is deliberately unchanged — see the clearStuckCheckIn
 * assertions at the foot of this file. What went is the explanation.
 */
describe("the Clear Check-In dialog says only what it must", () => {
  const PANEL = read("src/components/admin/open-checkins.tsx");

  it("carries the heading, the sentence and the two buttons", () => {
    expect(PANEL).toContain("Clear Check-In?");
    expect(PANEL).toContain("is currently checked in at");
    expect(PANEL).toContain("Yes, Clear It");
    expect(PANEL).toContain("Cancel");
  });

  it("no longer explains the consequence", () => {
    // What a reader sees, not what the file says about itself: the comment
    // recording this removal necessarily quotes the wording it removed.
    const rendered = withoutComments(PANEL);
    expect(rendered).not.toContain("can check in elsewhere");
    expect(rendered).not.toContain("not recorded");
    expect(rendered).not.toContain("honest answer");
  });

  it("still names the institute, which the old wording never did", () => {
    expect(PANEL).toContain("instituteName");
  });
});

/**
 * #5 — clearing a check-in still invents nothing.
 *
 * The dialog lost its explanation; the action must not lose the behaviour that
 * explanation described. `clearStuckCheckIn` sets `checkout_missing` alone, and
 * `guard_checkout_missing()` (FO020) stamps who did it and when. It must never
 * start writing a `checkout_at` — a fabricated departure time would be
 * indistinguishable from a real one, and would then be given a fabricated
 * position by everything above.
 */
describe("clearing a check-in fakes no check-out", () => {
  const SOURCE = read("src/lib/checkin-actions.ts");
  const clear = SOURCE.slice(SOURCE.indexOf("export async function clearStuckCheckIn"));

  it("writes checkout_missing and nothing else", () => {
    expect(clear).toContain(".update({ checkout_missing: true })");
    expect(clear).not.toContain("checkout_at:");
    expect(clear).not.toContain("checkout_lat");
  });

  it("stays admin-only", () => {
    expect(clear).toContain("requireAdmin()");
    expect(clear).toContain("FO020");
  });
});
