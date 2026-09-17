import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATABASE_BEHIND, GENERIC_ERROR, toFriendlyMessage } from "@/lib/errors";

/**
 * The Settings crash, and why it took a re-test to find.
 *
 * THREE THINGS WERE WRONG AT ONCE and each hid the next.
 *
 * (1) THE DATABASE WAS BEHIND THE BUILD. Every mutation on this screen names a
 *     column added by migration 0024, 0025 or 0026. Against a database that has
 *     not had them applied, PostgREST answers PGRST204 ("could not find the
 *     column in the schema cache") on a write and Postgres answers 42703
 *     ("column does not exist") on a read. Neither code was mapped, so both
 *     came out as the caller's generic fallback — "We could not add that
 *     purpose." — which is exactly what a network blip looks like. The one
 *     failure that can only mean "apply a migration" was the one failure that
 *     said nothing about itself.
 *
 * (2) TWO OF THE FOUR MUTATIONS THREW THEIR ANSWER AWAY. setStatusActive and
 *     setPurposeActive return an AdminState; both click handlers awaited it and
 *     dropped it. So the refusal in (1) was not merely generic, it was
 *     invisible: the badge did not move and nothing appeared. A button that
 *     does nothing is indistinguishable from a tap that did not register.
 *
 * (3) AND THE TWO ADD FORMS CLEARED THEMSELVES MID-SUBMIT. Their onSubmit
 *     cleared controlled state on the SUCCESS path without preventDefault, so
 *     React flushed a re-render that emptied the hidden inputs it was about to
 *     build FormData from — and, in the purposes panel, unmounted the lifecycle
 *     <Select> that `activity` conditionally renders, inside the dispatch that
 *     Select was part of.
 *
 * WHAT IS CHECKABLE FROM NODE. (1) is a pure function and is tested properly
 * below. (2) and (3) live in components, and this project has no DOM test
 * environment on purpose — vitest.config.mts documents the split and
 * log-visit-form.test.ts explains why adding one is an architectural decision
 * rather than a side effect of a bug fix. So those are read at source level,
 * which is what log-visit-form.test.ts already does for the same class of bug.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const PURPOSES = "src/components/settings/purposes-panel.tsx";
const STATUSES = "src/components/settings/statuses-panel.tsx";

/* ------------------------------------------------------------------ */
/* (1) a database behind its app says so                               */
/* ------------------------------------------------------------------ */

describe("a schema that is behind the build names itself", () => {
  /**
   * The two codes, and the shapes they actually arrive in.
   *
   * Taken from a live probe rather than invented: these are verbatim what a
   * database at migration 0022 answered to the four Settings mutations.
   */
  const WRITE_AGAINST_OLD_SCHEMA = {
    code: "PGRST204",
    message: "Could not find the 'activity' column of 'purposes' in the schema cache",
  };
  const READ_AGAINST_OLD_SCHEMA = {
    code: "42703",
    message: "column institute_statuses.tone does not exist",
  };

  it("maps a missing column on a WRITE to the migration message", () => {
    expect(toFriendlyMessage(WRITE_AGAINST_OLD_SCHEMA)).toBe(DATABASE_BEHIND);
  });

  it("maps a missing column on a READ to the same message", () => {
    expect(toFriendlyMessage(READ_AGAINST_OLD_SCHEMA)).toBe(DATABASE_BEHIND);
  });

  it("beats the caller's own fallback, which is the whole point", () => {
    // This is the regression. Every one of these actions passes a fallback, and
    // a fallback is the right answer for an unknown failure — but not for this
    // one, where the fallback actively misdirects.
    expect(toFriendlyMessage(WRITE_AGAINST_OLD_SCHEMA, "We could not add that purpose.")).toBe(
      DATABASE_BEHIND,
    );
    expect(toFriendlyMessage(READ_AGAINST_OLD_SCHEMA, "We could not load the statuses.")).toBe(
      DATABASE_BEHIND,
    );
  });

  it("tells the reader not to retry, because retrying cannot work", () => {
    // The wording is load-bearing. "Please try again in a moment" sent a real
    // re-test round the loop repeatedly before anyone looked at the schema.
    expect(DATABASE_BEHIND).toMatch(/not help/i);
    expect(DATABASE_BEHIND).not.toMatch(/try again/i);
    expect(DATABASE_BEHIND).not.toBe(GENERIC_ERROR);
  });

  it("leaks no column, table or SQL into the sentence", () => {
    // The code and the message stay in the server log where logError puts them.
    for (const fragment of ["purposes", "institute_statuses", "activity", "tone", "schema cache"]) {
      expect(DATABASE_BEHIND).not.toContain(fragment);
    }
  });

  it("still lets an ordinary failure have its own wording", () => {
    // A duplicate is a duplicate whatever the schema version, and a caller's
    // fallback must still win for anything unrecognised.
    expect(toFriendlyMessage({ code: "23505" })).toBe("That already exists.");
    expect(toFriendlyMessage({ code: "XX000" }, "We could not add that purpose.")).toBe(
      "We could not add that purpose.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* (2) retire and restore answer for themselves                        */
/* ------------------------------------------------------------------ */

describe("every Settings mutation reports what happened", () => {
  const PANELS: [string, string][] = [
    [PURPOSES, "setPurposeActive"],
    [STATUSES, "setStatusActive"],
  ];

  /** Formatting is not the subject here, so it is taken out of the question. */
  const flat = (file: string) => read(file).replace(/\s+/g, " ");

  it.each(PANELS)("%s keeps what %s returned", (file, action) => {
    // The bug in one line: `await setStatusActive(...)` with the result
    // discarded. The state has to be captured, or a refusal cannot be shown.
    expect(flat(file)).toContain(`setRetireState( await ${action}(`);
    // ...and it has to reach the screen, not just a variable.
    const source = read(file);
    expect(source).toContain("retireState?.error");
    expect(source).toContain("retireState?.ok");
  });

  it.each(PANELS)("%s never awaits %s for its side effect alone", (file, action) => {
    // A bare `await setStatusActive(...)` as a statement inside the transition
    // body is the shape that was wrong. If it comes back, so does a button that
    // silently does nothing.
    expect(flat(file)).not.toContain(`{ await ${action}(`);
  });
});

/* ------------------------------------------------------------------ */
/* (3) neither add form clears itself mid-submit                       */
/* ------------------------------------------------------------------ */

/**
 * The invariant, stated as an ORDER rather than as an absence.
 *
 * Clearing the form after a successful add is wanted behaviour and always was.
 * What must never happen is clearing it *before* the FormData that carries it
 * has been read. So this asserts the sequence — capture, dispatch, then clear —
 * which is the thing that makes the clearing safe.
 */
describe("the add forms read the form before they empty it", () => {
  const FORMS: [string, string[]][] = [
    [PURPOSES, ["setLabel(\"\")", "setActivity(\"\")", "setLifecycle(\"\")"]],
    [STATUSES, ["setLabel(\"\")", "setCategory(\"\")", "setTone(\"\")"]],
  ];

  it.each(FORMS)("%s dispatches its own action", (file) => {
    const source = read(file as string);
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("new FormData(event.currentTarget)");
    expect(source).toContain("formAction(formData)");
  });

  it.each(FORMS)("%s captures, dispatches, and only then clears", (file, setters) => {
    const source = read(file as string);
    const capture = source.indexOf("new FormData(event.currentTarget)");
    const dispatch = source.indexOf("formAction(formData)");
    expect(capture, "the form is read").toBeGreaterThan(-1);
    expect(dispatch, "and dispatched").toBeGreaterThan(capture);

    for (const setter of setters as string[]) {
      const cleared = source.lastIndexOf(setter);
      expect(cleared, `${setter} is present`).toBeGreaterThan(-1);
      // THE WHOLE REGRESSION. Every clearing setter must come after the
      // snapshot, or it empties a hidden input on its way to the server.
      expect(cleared, `${setter} runs after the FormData snapshot`).toBeGreaterThan(
        capture,
      );
    }
  });

  it("the purposes panel no longer unmounts a Select inside its own submit", () => {
    const source = read(PURPOSES);
    // `activity` decides whether the lifecycle <Select> is rendered at all, so
    // clearing it tears that Select down. Safe only once the dispatch is ours
    // and the snapshot is already taken — which the ordering test above proves.
    expect(source).toContain("needsLifecycle && (");
    const capture = source.indexOf("new FormData(event.currentTarget)");
    expect(source.lastIndexOf('setActivity("")')).toBeGreaterThan(capture);
  });
});
