import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Activity-revert bug, guarded at the only level this project can reach.
 *
 * WHAT THE BUG WAS. `<form action={formAction}>` is the idiomatic React 19
 * form. React resets a form once its action has run, and resetting dispatches a
 * `reset` EVENT. Every Radix Select registers one of those on its enclosing
 * form (@radix-ui/react-select, re-exported by `radix-ui`):
 *
 *     const initialValueRef = React.useRef(value);   // captured at MOUNT
 *     const reset = () => setValue(initialValueRef.current);
 *     associatedForm.addEventListener("reset", reset);
 *
 * Our Selects are controlled, so `setValue` calls `onValueChange` and the
 * component's own state is overwritten with the value the Select had at mount.
 * On a FAILED submit the rep's corrected Activity silently became the plan's
 * prefill again, so they could file the wrong activity having seen the right
 * one. Found by driving the live app, not by reading the code.
 *
 * WHY THIS IS A SOURCE-LEVEL TEST AND NOT A COMPONENT TEST. Proving the
 * behaviour properly needs a DOM: render the form, change a Select, dispatch a
 * `reset` on the form, assert the value survives. This project has no DOM test
 * environment on purpose — vitest.config.mts documents the split as pure-logic
 * unit tests plus Postgres integration tests, and adding jsdom and a React
 * testing library is an architectural decision, not a side effect of a bug fix.
 * So this asserts the one thing that is checkable from Node and is what
 * actually prevents the regression: that this form still submits itself rather
 * than handing the job to React.
 *
 * If someone "tidies" the onSubmit back into `action={formAction}`, this fails
 * and the comment above says why it must not.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

/**
 * Every `<form …>` opening tag in a file, attributes only.
 *
 * Asked of the TAG rather than of the whole file on purpose. These components
 * carry long comments explaining the bug they were cured of, and those comments
 * quote the very spelling — `action={formAction}` — that the cure removes. A
 * bare `not.toContain` cannot tell the cure from the explanation of it, so it
 * passed happily on a file that had been fixed AND on one that never was. This
 * reads the markup instead, which is the thing the invariant is actually about.
 */
const formTags = (source: string): string[] =>
  [...source.matchAll(/<form\b([^>]*)>/g)].map((match) => match[1]);

const noFormTakesAnActionProp = (source: string) => {
  const tags = formTags(source);
  expect(tags.length, "the file still has a form in it").toBeGreaterThan(0);
  for (const tag of tags) expect(tag).not.toMatch(/\baction=/);
};

const FORM = "src/components/visits/log-visit-form.tsx";

describe("Log Visit is not reset by React after its action", () => {
  const source = read(FORM);

  it("never hands the form to React's action prop", () => {
    // This is the whole regression. React only resets a form it is driving.
    noFormTakesAnActionProp(source);
  });

  it("dispatches the action itself, from onSubmit", () => {
    expect(source).toMatch(/onSubmit=\{/);
    // The invariant is "this form dispatches the action itself", not one
    // spelling of it — the same tolerance the other forms below are read with.
    // It used to insist on the single expression `formAction(new FormData(`;
    // the check-out's position is taken between building the FormData and
    // sending it, so the two steps are now separated by an await. Nothing about
    // the regression this guards has changed: React is still not driving the
    // submission, so it still never resets the form.
    expect(source).toMatch(/formAction\(/);
    expect(source).toContain("new FormData(");
    // preventDefault, or the browser navigates away on submit.
    expect(source).toContain("event.preventDefault()");
  });

  it("still explains itself to the next reader", () => {
    // The fix is one line and looks arbitrary without the chain behind it.
    // A future reader who does not know why will revert it.
    expect(source).toContain("initialValueRef");
    expect(source).toMatch(/reset/i);
  });
});

/**
 * The same guard for the other forms that must dispatch their own action.
 *
 * FOUR WERE JUDGED ON THE RADIX REVERT: when the Select reverts to its mount
 * value, does the form then submit something valid-but-wrong, or does it fail
 * loudly? Only the first kind qualified.
 *
 *   institute-form        type -> "school". A coaching centre filed as a school.
 *   team-panel            role -> "rep". An admin account created as a rep.
 *   material-upload-form  campusId -> ALL_CAMPUSES. One campus's file published
 *                         to every campus, after the file is already stored.
 *   photo-flush-panel     preset -> "older than a week", the WIDEST preset, in
 *                         front of an irreversible delete.
 *
 * TWO MORE JOINED THEM FOR A DIFFERENT REASON, and the difference is worth
 * keeping straight because it is why they were passed over the first time.
 *
 *   purposes-panel        Both were left on the action prop DELIBERATELY: their
 *   statuses-panel        Selects mount EMPTY, so a revert lands on nothing and
 *                         the schema refuses it with a sentence. That reasoning
 *                         was right and was never the problem. Their own
 *                         onSubmit was: it cleared controlled state that hidden
 *                         inputs read — and, in the purposes panel, that a
 *                         conditional <Select> depends on — while React was
 *                         still submitting. The form went up with empty hidden
 *                         fields and a mounted Radix Select was torn down under
 *                         the dispatch. Same cure, a different disease.
 *
 * daily-plan and assign-visit are still deliberately absent: their Selects
 * mount EMPTY, clearing after a successful add is wanted, and neither clears
 * anything a hidden field or a conditional render depends on. locations-panel
 * is absent because its Selects sit outside every form, so Radix never attaches
 * the listener. Each carries the reasoning in a comment at the point it would
 * be undone.
 */
describe("the other forms a Radix revert could corrupt", () => {
  const FIXED = [
    "src/components/institutes/institute-form.tsx",
    "src/components/settings/team-panel.tsx",
    "src/components/materials/material-upload-form.tsx",
    "src/components/settings/photo-flush-panel.tsx",
    // The two Settings panels, moved here from LEFT — see the note above.
    "src/components/settings/purposes-panel.tsx",
    "src/components/settings/statuses-panel.tsx",
  ];

  it.each(FIXED)("%s submits itself rather than handing React the action", (file) => {
    const source = read(file);
    noFormTakesAnActionProp(source);
    // The invariant is "this form dispatches the action itself", not one
    // particular spelling of it: two of these capture the FormData into a local
    // first, on purpose, so what is sent is what was typed rather than what the
    // state holds a tick after the clearing setters run.
    expect(source).toMatch(/formAction\(/);
    expect(source).toContain("new FormData(");
    expect(source).toContain("event.preventDefault()");
  });

  const LEFT = [
    "src/components/dashboard/daily-plan.tsx",
    "src/components/dashboard/assign-visit.tsx",
  ];

  it.each(LEFT)("%s is left on the action prop, and says why", (file) => {
    const source = read(file);
    // Still the idiomatic form - that is the point. If someone "completes the
    // sweep" without reading the reasoning, this fails and points at it.
    expect(source).toContain("action={formAction}");
    expect(source).toContain("DELIBERATELY");
  });

  it("material-upload keeps the explicit reset that clears a SUCCESSFUL upload", () => {
    // The fix removes React's automatic reset, not the admin's own "start
    // another" button. Losing that would break the wanted clear-on-success.
    const source = read("src/components/materials/material-upload-form.tsx");
    expect(source).toContain("formRef.current?.reset()");
    expect(source).toContain("function startAnother()");
  });

  it("photo-flush keeps the cutoff guard that backstopped the revert", () => {
    // A confirmation is only good for the cutoff it was counted against. That
    // guard caught the worst of this bug and must outlive the fix.
    const source = read("src/components/settings/photo-flush-panel.tsx");
    expect(source).toContain("state.cutoff === cutoff");
  });
});

/**
 * The dependency behaviour the fix exists for.
 *
 * Tolerant on purpose: this reads inside node_modules, so a Radix restructure
 * moves the file rather than breaking the app. A miss is reported as a skip
 * with a reason, not a red build — but while the file IS there, the listener
 * had better still be, because if Radix ever drops it the fix above becomes
 * unnecessary and this is the note that will say so.
 */
const RADIX = "node_modules/@radix-ui/react-select/dist/index.mjs";
const radixPath = fileURLToPath(new URL(`../../${RADIX}`, import.meta.url));

describe.skipIf(!existsSync(radixPath))("why the fix is needed", () => {
  it("Radix Select still restores its mount-time value on a form reset", () => {
    const radix = readFileSync(radixPath, "utf8");
    expect(radix).toContain('addEventListener("reset"');
    expect(radix).toContain("initialValueRef");
  });
});
