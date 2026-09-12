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

const FORM = "src/components/visits/log-visit-form.tsx";

describe("Log Visit is not reset by React after its action", () => {
  const source = read(FORM);

  it("never hands the form to React's action prop", () => {
    // This is the whole regression. React only resets a form it is driving.
    expect(source).not.toMatch(/<form\s+action=\{/);
    expect(source).not.toContain("action={formAction}>");
  });

  it("dispatches the action itself, from onSubmit", () => {
    expect(source).toMatch(/onSubmit=\{/);
    expect(source).toContain("formAction(new FormData(");
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
