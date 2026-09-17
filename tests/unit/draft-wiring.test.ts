import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMPTY_FEEDBACK, type FeedbackState } from "@/lib/validation/feedback";

/**
 * #9 / #10 — where the drafts are wired in, and when they are cleared.
 *
 * drafts.test.ts covers the store. draft-ordering.test.ts covers the decision
 * that fixed the soft-navigation bug. This covers the WIRING: that both forms
 * go through `useDraft` rather than keeping their own copy of a mechanism that
 * has now been wrong twice, and that the clearing rules are still in place.
 *
 * THE ASSERTIONS ABOUT RESTORE ORDER ARE INVERTED FROM WHAT THEY WERE. This
 * file used to insist the draft was read AFTER mount and never in a `useState`
 * initialiser — which was right about hydration and wrong about everything
 * else, and is precisely the shape QA found broken on a soft navigation. The
 * hydration problem is now solved by `useSyncExternalStore` instead of avoided
 * by waiting, so the rule is the opposite one: the first render holds the
 * draft. See the header of use-draft.ts.
 *
 * Read at source level for the usual reason: no DOM environment here, by
 * design. See vitest.config.mts and log-visit-form.test.ts.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const LOG = "src/components/visits/log-visit-form.tsx";
const FOLLOW_UP = "src/components/visits/follow-up-list.tsx";

describe("Log Visit keeps a draft of what was typed", () => {
  const source = read(LOG);

  it("keys it by the plan entry, so one visit cannot see another's", () => {
    expect(source).toContain("logVisitDraftKey(plan.id)");
  });

  it("goes through useDraft rather than rolling its own", () => {
    // The mechanism has been wrong twice. One copy of it, shared with the
    // Pending panel, is what stops the next fix having to be made in two
    // places and landing in one.
    expect(source).toContain("useDraft(draftKey, EMPTY_DRAFT,");
    expect(source).not.toContain("readDraft<LogVisitDraft>");
    expect(source).not.toContain("writeDraft(");
  });

  it("holds every typed field in ONE object", () => {
    // Four separate useStates are what let a restore be PARTIAL, which is how
    // the stored draft ended up with one field emptied and the rest intact.
    expect(source).toContain("const { statusSetTo, expectedDate, followUpDate, feedback } = draft;");
    for (const setter of [
      "setStatusSetTo",
      "setExpectedDate",
      "setFollowUpDate",
      "setFeedback",
    ]) {
      expect(source, `${setter} should be gone`).not.toContain(`${setter}(`);
    }
  });

  it("keeps the feedback patch functional, all the way through", () => {
    // applyFeedbackPatch was made functional after a live bug where two changes
    // in one tick both merged against the render they started from. Building
    // the patch from a closed-over `feedback` would put that straight back.
    expect(source).toContain("patchDraft((current) => ({");
    expect(source).toContain("applyFeedbackPatch(current.feedback, patch)");
  });

  it("clears the draft when the form is dispatched", () => {
    expect(source).toContain("clearDraft(draftKey)");
  });

  it("re-saves when a submission comes back refused", () => {
    // The draft is cleared at dispatch, so a refusal has to put it back or the
    // rep is left holding a filled-in form with nothing behind it.
    expect(source).toContain("resaveOn: serverState");
  });

  it("starts again when the form is pointed at another visit", () => {
    // /log?plan=A to /log?plan=B is the same route with different search
    // params, so React reconciles rather than remounting and the initialiser
    // does not run again. Without this the form would keep A's answers, show
    // them against B, and save them under B's key.
    const hook = read("src/lib/use-draft.ts");
    expect(hook).toContain("const restoredFor = useRef<string | null>(null)");
    expect(hook).toContain("if (restoredFor.current === key) return;");
    expect(hook).toContain("const switched = restoredFor.current !== null;");
  });

  it("does not persist the photograph", () => {
    // Deliberate. CaptureFields owns a live capture; restoring a path without
    // the preview beside it would claim a photo the rep cannot see or check.
    const draftShape = source.slice(
      source.indexOf("interface LogVisitDraft"),
      source.indexOf("const EMPTY_DRAFT"),
    );
    expect(draftShape).not.toMatch(/photo/i);
  });
});

/**
 * Notes had to become controlled for any of this to work.
 *
 * It was the only field on the form React did not hold — it posted by `name`
 * and nothing read it — which made the longest and most expensive thing a rep
 * types the one thing a draft could not save.
 */
describe("the notes field is part of the form's state now", () => {
  it("is in FeedbackState, starting empty like the rest", () => {
    expect(EMPTY_FEEDBACK.notes).toBe("");
    for (const [key, value] of Object.entries(EMPTY_FEEDBACK)) {
      expect(value, key).toBe("");
    }
  });

  it("is a string field like its neighbours", () => {
    const state: FeedbackState = { ...EMPTY_FEEDBACK, notes: "Went well." };
    expect(state.notes).toBe("Went well.");
  });

  it("is controlled by that state in the component", () => {
    const source = read("src/components/visits/feedback-fields.tsx");
    expect(source).toContain("value={value.notes}");
    expect(source).toContain("onChange({ notes: event.target.value })");
    // The field itself is unchanged in every way that reaches the server.
    expect(source).toContain('name="notes"');
    expect(source).toContain("maxLength={2000}");
  });

  it("is still a field close_visit() writes, which is what keeps it legal here", () => {
    // feedback.test.ts pins the invariant that every key of this state is a
    // column the report can save. Notes has always been one — p_notes — so
    // adding it here does not widen what the form collects.
    const actions = read("src/lib/feedback-actions.ts");
    expect(actions).toContain("p_notes: feedback.notes");
  });
});

describe("the Pending 'Visit again' panel keeps its purpose", () => {
  const source = read(FOLLOW_UP);

  it("goes through the same hook, so it cannot drift from Log Visit", () => {
    // It had the identical bug, and worse: a soft navigation is the ONLY way
    // anyone reaches this panel, so the gap was total rather than intermittent.
    expect(source).toContain("useDraft(followUpDraftKey(), EMPTY_FOLLOW_UP,");
    expect(source).not.toContain("writeDraft(");
  });

  it("wears only its own institute's draft", () => {
    // One slot is shared by every institute's panel, so the panel that opens
    // has to check the stored draft is its own.
    expect(source).toContain("accept: (stored) => stored.instituteId === item.instituteId");
    // ...and every write says whose it is, or `accept` has nothing to read.
    expect(source).toContain("patchDraft({ instituteId: item.instituteId, ...fields })");
  });

  it("reopens the panel the draft belongs to", () => {
    // The half that makes the other half visible: StartFollowUp only exists
    // while its panel is open, so a restored purpose with no open panel would
    // be restored into something unmounted.
    expect(source).toContain("const restoredOpen = useRef(false)");
    expect(source).toContain("setOpen(!readOnly && draft !== null && stillListed");
  });

  it("only reopens a row that is still on the list", () => {
    expect(source).toContain(
      "items.some((item) => item.instituteId === draft.instituteId)",
    );
  });

  it("never reopens one for an admin", () => {
    // An admin's panel is AssignFollowUp, which writes a plan row for somebody
    // else and keeps no draft.
    expect(source).toContain("!readOnly");
  });

  it("clears on submit and on cancel", () => {
    // Submit: the action redirects, so there is no later moment. Cancel: the
    // rep has said they are not doing this now, and it must not reappear.
    expect(source).toContain("onSubmit={() => clearDraft(followUpDraftKey())}");
    const cancel = source.slice(source.indexOf("onClick={() => {"));
    expect(cancel.slice(0, 120)).toContain("clearDraft(followUpDraftKey())");
  });
});
