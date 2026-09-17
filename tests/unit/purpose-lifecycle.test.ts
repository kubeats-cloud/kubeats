import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  purposeSchema,
  purposeUpdateSchema,
  PURPOSE_LIFECYCLES,
  REMOVABLE,
} from "@/lib/validation/admin";
import {
  ACTIVITY_KEYS,
  hasLifecycle,
  LIFECYCLE_ACTIVITIES,
  plannedActivityIsValid,
} from "@/lib/validation/visit";
import { METRICS } from "@/lib/validation/weekly";

/**
 * Defect C — the admin's purposes panel, in both its halves.
 *
 * (c1) HALF THE VOCABULARY COULD NOT BE ADDED. `addPurpose` sent a label and an
 *      activity and nothing else, and `purposes_lifecycle_matches_activity`
 *      (0025) demands a Set or a Done on a `session` or a `campus_visit`. So
 *      every session and campus-visit purpose an admin tried to add was refused
 *      with a raw 23514 that reached them as "we could not add that purpose",
 *      for ever. Four of the eight weekly metrics — Sessions Set, Sessions Done,
 *      Campus Visits Set, Campus Visits Done — are fed only by such purposes, so
 *      the four rows 0025 seeded were all the client would ever have had.
 *
 * (c2) AND THE PANEL COULD DELETE THE LAST ONE FEEDING A METRIC. It offered a
 *      hard delete through `removeEntry`, with no retire and no check. Deleting
 *      "Fix a session" zeroes Sessions Set — silently, because a metric with no
 *      purpose behind it does not error, it simply comes in flat week after
 *      week. It also strands every `daily_plans` row pointing at the deleted
 *      row: stage 3 derives the activity from `purpose_id`, and the Activity
 *      selector that used to be the by-hand fallback is gone.
 *
 * The fix for the second is the one the status vocabulary already uses —
 * `is_active = false` — and it is enforced at the ACTION, not just in the panel.
 * Deleting a button never closes the path behind it; that is what FO020 records
 * about the rep's abandon button, and the same reasoning applies here.
 */

const base = { label: "Fix a session", activity: "session" };

/* ------------------------------------------------------------------ */
/* c1 — a purpose declares which END of its metric it feeds            */
/* ------------------------------------------------------------------ */

describe("purposeSchema asks for a lifecycle exactly where 0025 requires one", () => {
  it.each([...LIFECYCLE_ACTIVITIES])("%s requires Set or Done", (activity) => {
    for (const lifecycle of PURPOSE_LIFECYCLES) {
      const parsed = purposeSchema.safeParse({ ...base, activity, lifecycle });
      expect(parsed.success, `${activity}/${lifecycle}`).toBe(true);
    }

    // The defect itself: this is what the form used to post for a session.
    const missing = purposeSchema.safeParse({ ...base, activity, lifecycle: "" });
    expect(missing.success, "no lifecycle at all").toBe(false);
    if (!missing.success) {
      // It must be flagged on the CONTROL, not as a whole-form failure — the
      // database's 23514 had nowhere to point, which is what made it opaque.
      expect(missing.error.issues.map((i) => i.path[0])).toContain("lifecycle");
    }
  });

  const ONE_SHOT = ACTIVITY_KEYS.filter((key) => !hasLifecycle(key));

  it.each(ONE_SHOT)("%s must NOT carry one", (activity) => {
    expect(
      purposeSchema.safeParse({ ...base, activity, lifecycle: "" }).success,
      "none is right",
    ).toBe(true);

    // 0025's CHECK refuses a lifecycle here as firmly as it demands one above,
    // and a control the admin cannot see must not be able to send a value.
    const extra = purposeSchema.safeParse({ ...base, activity, lifecycle: "Set" });
    expect(extra.success, "a stale Set from a previous activity").toBe(false);
  });

  it("refuses a lifecycle that is neither Set nor Done", () => {
    const parsed = purposeSchema.safeParse({
      ...base,
      lifecycle: "Immediate",
    });
    expect(parsed.success).toBe(false);
  });

  it("reads a field that is absent entirely as 'not asked'", () => {
    // An admin's cached page from before this control existed posts no
    // lifecycle field. That must fail on the RULE, with a sentence, rather than
    // as an unreadable field — the same tolerance visitSchema gives `accuracy`.
    const oneShot = purposeSchema.safeParse({ label: "Other", activity: "meeting" });
    expect(oneShot.success, "a one-shot is unaffected").toBe(true);

    const session = purposeSchema.safeParse(base);
    expect(session.success, "a session still needs one").toBe(false);
  });
});

/**
 * The shape this schema produces is one the VISITS table would accept.
 *
 * `plannedActivityIsValid()` is what `/log` asks before walking a rep into a
 * visit, and it mirrors `visits_lifecycle_matches_activity` (0001). A purpose
 * that passes here and fails there would be addable and unusable — which is the
 * same class of failure as the defect, one table further along.
 */
describe("what an admin can add is what a rep can plan under", () => {
  it.each(ACTIVITY_KEYS)("%s produces a usable (activity, lifecycle) pair", (activity) => {
    const parsed = purposeSchema.safeParse({
      ...base,
      activity,
      lifecycle: hasLifecycle(activity) ? "Done" : "",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(
      plannedActivityIsValid({
        activity: parsed.data.activity,
        lifecycle: parsed.data.lifecycle,
      }),
    ).toBe(true);
  });

  it("can express every weekly metric that is fed by a purpose", () => {
    // The end this all exists for. Seven of the eight metrics are counted by
    // (activity, lifecycle); Meetings is the one that comes off daily_plans
    // instead. If a metric cannot be named by any purpose this schema accepts,
    // it cannot be earned — which is exactly what the defect did to four of
    // them, and what 0025's assertion block refuses to apply against.
    const expressible = new Set<string>();
    for (const activity of ACTIVITY_KEYS) {
      for (const lifecycle of hasLifecycle(activity)
        ? [...PURPOSE_LIFECYCLES]
        : [""]) {
        const parsed = purposeSchema.safeParse({ ...base, activity, lifecycle });
        if (parsed.success) {
          expressible.add(`${parsed.data.activity}:${parsed.data.lifecycle ?? ""}`);
        }
      }
    }

    const unreachable = METRICS.filter((metric) => {
      // "meetings" carries no (activity, lifecycle) at all: Rule 7 counts it
      // from daily_plans, not from the visits log. It is still fed by a
      // purpose — one whose activity is `meeting` — and that pair is covered
      // by the one-shot cases above.
      if (!("activity" in metric)) return false;
      return !expressible.has(`${metric.activity}:${metric.lifecycle ?? ""}`);
    }).map((metric) => metric.label);

    expect(unreachable, "every metric needs a purpose that can feed it").toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* c2 — a purpose is retired, never deleted                            */
/* ------------------------------------------------------------------ */

describe("a purpose cannot be hard-deleted", () => {
  it("is not a kind removeEntry will accept", () => {
    // The path behind the button, not the button. `removeSchema` refuses the
    // kind, so a hand-made POST cannot delete a purpose either.
    expect(REMOVABLE as readonly string[]).not.toContain("purpose");
    // The location tree is untouched: those genuinely cascade and are meant to.
    expect(REMOVABLE as readonly string[]).toEqual(["state", "city", "area"]);
  });

  it("has an identifier schema for retiring and restoring instead", () => {
    expect(
      purposeUpdateSchema.safeParse({ id: "6d9c2a7e-3f0b-4c1a-9b2e-5a7c8d1e4f30" })
        .success,
    ).toBe(true);
    expect(purposeUpdateSchema.safeParse({ id: "Fix a session" }).success).toBe(
      false,
    );
  });
});

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

describe("the panel and the action agree on both halves", () => {
  const panel = read("src/components/settings/purposes-panel.tsx");
  const actions = read("src/lib/admin-actions.ts");
  const admin = read("src/lib/admin.ts");

  it("the panel asks for a lifecycle, and only where one is allowed", () => {
    expect(panel).toContain('name="lifecycle"');
    // Gated on the same question the schema and the CHECK ask, rather than on a
    // second hard-coded list of two activities.
    expect(panel).toContain("hasLifecycle(activity)");
  });

  it("addPurpose sends it", () => {
    // The defect in one line: the insert used to carry label and activity only.
    expect(actions).toContain("lifecycle: parsed.data.lifecycle");
    expect(actions).toContain('lifecycle: textOf(formData, "lifecycle")');
  });

  it("the panel retires rather than deletes", () => {
    expect(panel).toContain("setPurposeActive(purpose.id, !purpose.isActive)");
    expect(panel).toContain("Restore");
    // The control that used to be here. Its return would bring the whole defect
    // back, because removeEntry is still the delete for locations.
    expect(panel).not.toContain("RemoveButton");
    expect(panel).not.toContain('kind="purpose"');
  });

  it("setPurposeActive exists and flips the column both ways", () => {
    expect(actions).toContain("export async function setPurposeActive(");
    expect(actions).toContain("update({ is_active: isActive })");
  });

  it("the admin's list shows retired purposes, so they can be restored", () => {
    // listPurposes() in visits.ts filters is_active for the REP's picker. This
    // list must not: a retired purpose an admin cannot see is a delete with
    // extra steps.
    expect(admin).toContain("id, label, activity, lifecycle, is_active");
    expect(admin).not.toMatch(/listPurposeRows[\s\S]{0,400}eq\("is_active"/);
  });
});
