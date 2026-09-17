import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logVisitDraftKey, readDraft, writeDraft } from "@/lib/drafts";
import { initialDraft, wouldClobber } from "@/lib/use-draft";

/**
 * The soft-navigation bug: a draft destroyed by the thing meant to save it.
 *
 * THE REPRO. Open Log Visit, pick a status, set a date, type a note, tap
 * Dashboard, tap Continue. The form comes back BLANK, and the stored draft has
 * been damaged on the way:
 *
 *   before  {"statusSetTo":"First meeting done","followUpDate":"…","notes":"…"}
 *   after   {"statusSetTo":"",                  "followUpDate":"…","notes":"…"}
 *
 * WHY. The draft was restored in an effect. On a soft navigation the form
 * remounts with empty state, and the save effect — which cannot tell "empty
 * because nothing is typed" from "empty because the restore has not landed" —
 * wrote that emptiness back before the restore read it. A full page load worked,
 * because there the empty first render is correct and the effect fills it in
 * immediately afterwards. So the bug was invisible to anyone testing by reload.
 *
 * The single field lost is the signature of a write racing a PARTIAL restore,
 * which is why the four separate `useState`s are now one object: an object
 * cannot be half-restored.
 *
 * WHAT IS TESTED HERE. The ordering decision, as a pure function, because this
 * project has no DOM test environment on purpose — vitest.config.mts documents
 * the split and log-visit-form.test.ts explains why adding one is an
 * architectural decision rather than a side effect of a bug fix. The React
 * plumbing around `initialDraft` is plumbing; `initialDraft` is the fix.
 */

interface Draft {
  statusSetTo: string;
  followUpDate: string;
  notes: string;
}

const EMPTY: Draft = { statusSetTo: "", followUpDate: "", notes: "" };
const TYPED: Draft = {
  statusSetTo: "First meeting done",
  followUpDate: "2026-04-02",
  notes: "Met the principal; they want a session.",
};

const KEY = logVisitDraftKey("plan-1");

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage: fakeStorage() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * One mount, as the hook performs it: the first render decides what the form
 * holds, and the save effect runs afterwards with exactly that.
 *
 * This is the ordering the bug was about, so it is modelled rather than
 * described. `pastHydration` is the one input that differs between the two
 * kinds of arrival.
 */
function mount(pastHydration: boolean): { shown: Draft; stored: Draft | null } {
  const shown = initialDraft(readDraft<Draft>(KEY), EMPTY, pastHydration);
  // ...and then the save effect, which is what used to do the damage.
  if (!wouldClobber(shown, EMPTY, readDraft<Draft>(KEY))) {
    writeDraft(KEY, shown);
  }
  return { shown, stored: readDraft<Draft>(KEY) };
}

describe("a soft navigation restores the draft before anything can save over it", () => {
  it("shows what was typed, and leaves storage intact", () => {
    writeDraft(KEY, TYPED);

    const { shown, stored } = mount(true);

    // THE BUG: this used to be EMPTY, and storage used to be damaged.
    expect(shown).toEqual(TYPED);
    expect(stored).toEqual(TYPED);
  });

  it("loses no single field, which is how the bug showed itself", () => {
    // QA saw `statusSetTo` emptied while the other two survived. Asserted by
    // name, because a fix that restored two fields out of three would pass a
    // whole-object check written less carefully.
    writeDraft(KEY, TYPED);
    const { stored } = mount(true);
    expect(stored?.statusSetTo).toBe("First meeting done");
    expect(stored?.followUpDate).toBe("2026-04-02");
    expect(stored?.notes).toBe(TYPED.notes);
  });

  it("starts empty when there is genuinely no draft", () => {
    expect(mount(true).shown).toEqual(EMPTY);
  });
});

describe("a full page load still matches its own server HTML", () => {
  it("renders empty on the hydration pass, and does not write that over the draft", () => {
    // The hydration render MUST be empty — the server had no sessionStorage to
    // read, and a first client render that disagreed would be a hydration
    // mismatch in every field at once. The effect restores one commit later.
    writeDraft(KEY, TYPED);

    const { shown, stored } = mount(false);

    expect(shown, "matches the server's empty markup").toEqual(EMPTY);
    // And the save that follows it must NOT destroy the draft the effect is
    // about to read. This is what `wouldClobber` is for.
    expect(stored, "the draft survives the empty first commit").toEqual(TYPED);
  });
});

/**
 * The guard on its own, because it is the last line of defence.
 *
 * Deliberately narrow: only an ENTIRELY blank draft is refused, and only over a
 * stored one with content. A rep clearing their last remaining field looks the
 * same and loses a draft holding one value — a far smaller loss than a form
 * that silently eats everything typed into it.
 */
describe("a blank form never overwrites a draft with content", () => {
  it("refuses the write that caused the bug", () => {
    expect(wouldClobber(EMPTY, EMPTY, TYPED)).toBe(true);
  });

  it("allows a real change through", () => {
    expect(wouldClobber(TYPED, EMPTY, TYPED)).toBe(false);
    expect(
      wouldClobber({ ...TYPED, notes: "changed" }, EMPTY, TYPED),
      "editing must always be saveable",
    ).toBe(false);
  });

  it("allows the first write, when nothing is stored yet", () => {
    expect(wouldClobber(EMPTY, EMPTY, null)).toBe(false);
    expect(wouldClobber(TYPED, EMPTY, null)).toBe(false);
  });

  it("allows blank over blank, so an empty draft is not pinned for ever", () => {
    expect(wouldClobber(EMPTY, EMPTY, EMPTY)).toBe(false);
  });
});

/**
 * What the old mechanism did, kept as the thing this must never become again.
 *
 * Not a test of shipped code — it models the sequence that shipped — so that a
 * future change back to "restore in an effect, save unguarded" fails here with
 * the reason attached rather than being rediscovered by QA.
 */
describe("the mechanism that was replaced", () => {
  it("would have destroyed the draft on a soft navigation", () => {
    writeDraft(KEY, TYPED);

    // Restore-after-mount: the first render is empty...
    const shownByOldCode = EMPTY;
    // ...and the save effect wrote it straight out, unguarded.
    writeDraft(KEY, shownByOldCode);

    expect(readDraft<Draft>(KEY)).toEqual(EMPTY);
    // Which is exactly what the new path refuses to do.
    expect(wouldClobber(shownByOldCode, EMPTY, TYPED)).toBe(true);
  });
});

/**
 * A draft belongs to one form, and `accept` is how the shared slot is policed.
 *
 * Pending keeps ONE draft for every institute's "Visit again" panel, so the
 * panel that opens has to check the stored draft is its own. A key per institute
 * would make that automatic and was rejected for a worse problem: drafts for
 * panels the rep has closed would accumulate with nothing to clear them.
 */
describe("a shared draft slot only restores for the form that owns it", () => {
  interface FollowUp {
    instituteId: string;
    purpose: string;
    note: string;
  }
  const NONE: FollowUp = { instituteId: "", purpose: "", note: "" };
  const mineOf = (id: string) => (stored: FollowUp) => stored.instituteId === id;

  const restoreFor = (id: string, stored: FollowUp | null) => {
    const accepted = stored && mineOf(id)(stored) ? stored : null;
    return initialDraft(accepted, NONE, true);
  };

  const stored: FollowUp = {
    instituteId: "inst-a",
    purpose: "Follow up on proposal",
    note: "",
  };

  it("restores its own", () => {
    expect(restoreFor("inst-a", stored).purpose).toBe("Follow up on proposal");
  });

  it("ignores another institute's", () => {
    expect(restoreFor("inst-b", stored)).toEqual(NONE);
  });
});
