import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMPTY_FEEDBACK, type FeedbackState } from "@/lib/validation/feedback";

/**
 * #9 / #10 — where the drafts are wired in, and when they are cleared.
 *
 * drafts.test.ts covers the store itself. This covers the two forms that use
 * it, and three properties that are easy to get wrong and invisible when they
 * are:
 *
 *   RESTORED AFTER MOUNT, NEVER IN A `useState` INITIALISER. Both forms are
 *   server-rendered, and the server has no sessionStorage — reading the draft
 *   during the first render would make the client disagree with the HTML it is
 *   hydrating into, for every field at once. CLAUDE.md treats hydration as a
 *   correctness issue rather than a cosmetic one, and dates.ts records what a
 *   mismatch cost last time.
 *
 *   CLEARED AT DISPATCH. A successful submit ends in `redirect()`, which
 *   unmounts the form — so no "clear on success" could ever run, and the draft
 *   would outlive the visit it belonged to.
 *
 *   SAVED AGAIN IF THE SUBMIT COMES BACK REFUSED. Clearing early is only safe
 *   because the action state is in the save effect's dependencies.
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

  it("restores after mount rather than during the first render", () => {
    // THE HYDRATION RULE. A `useState(() => readDraft(...))` would be the
    // obvious shorthand and would make the first client render disagree with
    // the server's HTML for every field at once.
    expect(source).not.toMatch(/useState\([^)]*readDraft/);
    expect(source).toContain("useEffect(() => {");
    expect(source).toContain("readDraft<LogVisitDraft>(draftKey)");
  });

  it("restores exactly once, so it cannot overwrite live typing", () => {
    // Without the guard the effect re-runs and stamps the stored draft back
    // over whatever the rep has since typed.
    expect(source).toContain("const restored = useRef(false)");
    expect(source).toContain("if (restored.current) return;");
    expect(source).toContain("restored.current = true;");
  });

  it("does not blank the draft on the way past, during mount", () => {
    // BOTH EFFECTS RUN IN THE SAME COMMIT. The save effect runs straight after
    // the restore effect, still closed over the EMPTY first-render values —
    // so without this guard it writes those empties over the draft the restore
    // had just read, permanently in the case where the restore changes nothing.
    expect(source).toContain("const savedOnce = useRef(false)");
    const save = source.slice(source.indexOf("const savedOnce = useRef(false)"));
    expect(save.slice(0, 200)).toContain("if (!savedOnce.current)");
  });

  it("clears the draft when the form is dispatched", () => {
    expect(source).toContain("clearDraft(draftKey)");
  });

  it("re-saves when a submission comes back refused", () => {
    // What makes clearing at dispatch safe. `serverState` changing is the only
    // signal available once the draft has been cleared and the React state has
    // deliberately NOT been.
    const save = source.slice(source.indexOf("writeDraft(draftKey"));
    const deps = save.slice(save.indexOf("}, ["), save.indexOf("]);") + 3);
    expect(deps).toContain("serverState");
    for (const field of ["statusSetTo", "expectedDate", "followUpDate", "feedback"]) {
      expect(deps, field).toContain(field);
    }
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

  it("stores the institute alongside the purpose", () => {
    // Without the id there is no way to tell whose answer it was, and the
    // panel it belongs to could not be reopened.
    expect(source).toContain("interface FollowUpDraft");
    expect(source).toContain("instituteId: string;");
  });

  it("reopens the panel the draft belongs to", () => {
    // THE HALF THAT MAKES THE OTHER HALF VISIBLE. StartFollowUp only exists
    // while its panel is open, so restoring the purpose without restoring the
    // open panel would restore it into something unmounted.
    expect(source).toContain("const restoredOpen = useRef(false)");
    expect(source).toContain("setOpen(!readOnly && draft !== null && stillListed");
  });

  it("only reopens a row that is still on the list", () => {
    // Pending is recomputed per request and a follow-up can be closed by
    // somebody else in between.
    expect(source).toContain(
      "items.some((item) => item.instituteId === draft.instituteId)",
    );
  });

  it("never reopens one for an admin", () => {
    // An admin's panel is AssignFollowUp, which writes a plan row for somebody
    // else and keeps no draft.
    expect(source).toContain("!readOnly");
  });

  it("restores after mount, once, like Log Visit", () => {
    expect(source).not.toMatch(/useState\([^)]*readDraft/);
    expect(source).toContain("readDraft<FollowUpDraft>(followUpDraftKey())");
    expect(source).toContain("if (restored.current) return;");
  });

  it("skips the mount save, like Log Visit", () => {
    expect(source).toContain("const savedOnce = useRef(false)");
  });

  it("clears on submit and on cancel", () => {
    // Submit: the action redirects, so there is no later moment. Cancel: the
    // rep has said they are not doing this now, and it must not reappear.
    expect(source).toContain("onSubmit={() => clearDraft(followUpDraftKey())}");
    const cancel = source.slice(source.indexOf("onClick={() => {"));
    expect(cancel.slice(0, 120)).toContain("clearDraft(followUpDraftKey())");
  });
});
