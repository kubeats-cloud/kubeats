"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readDraft, writeDraft } from "@/lib/drafts";

/**
 * A form's draft, restored on EVERY mount — soft navigation included.
 *
 * WHAT WENT WRONG THE FIRST TIME. The draft was restored in an effect, which is
 * hydration-safe and works on a full page load. It does not survive a SOFT
 * navigation, and the way it fails is worse than not restoring at all: the form
 * mounts with empty state, and the save effect — which cannot tell "empty
 * because nothing has been typed" from "empty because the restore has not
 * landed yet" — writes that emptiness over the stored draft. The rep taps
 * Dashboard, taps Continue, and finds a blank form AND a draft that has been
 * quietly damaged. QA saw exactly one field lost, `statusSetTo`, which is the
 * signature of a write that raced a partial restore.
 *
 * Guarding the save by "skip the first run" was not enough. It counts RUNS, and
 * an effect can be run more than once per mount — React re-invokes mount effects
 * when a subtree is hidden and revealed, which is what the App Router does with
 * a cached route. One extra invocation and the guard is spent while the restore,
 * guarded by its own ref, has already declined to run again.
 *
 * SO THE DRAFT IS READ DURING THE FIRST RENDER, not after it. There is then no
 * window in which any effect can observe an empty form, because the form is
 * never empty: the very first render already holds what was stored.
 *
 * AND THE HYDRATION PROBLEM IS SOLVED RATHER THAN TRADED AWAY. Reading
 * sessionStorage in a `useState` initialiser is normally how a form starts
 * disagreeing with its own server-rendered HTML — there is no sessionStorage on
 * the server, so the two renders differ in every field at once. CLAUDE.md treats
 * that as a correctness problem, and dates.ts records what one cost.
 *
 * `useSyncExternalStore` is the way out, and it is what it exists for: it is the
 * one hook that may legitimately answer differently on the server and the
 * client, and React handles the changeover without a mismatch. Here it answers
 * one question — "is this render past hydration?" — and the answer decides
 * whether the initialiser may look at storage:
 *
 *   HARD LOAD    the first render is the hydration render, so it answers false,
 *                the initialiser returns the empty draft, and the markup
 *                matches. The effect below restores immediately afterwards, as
 *                it always did.
 *   SOFT NAV     the component mounts client-side with no HTML to match, so it
 *                answers true on the first render and the draft is already
 *                there. This is the case that was broken.
 *
 * ONE STATE OBJECT, not one per field. A partial restore is what corrupted the
 * stored draft, and a single object cannot be partially restored.
 */

/** Never fires: this store's value changes only at hydration. */
const NEVER_CHANGES = () => () => {};
const PAST_HYDRATION = () => true;
const DURING_HYDRATION = () => false;

/**
 * What a form holds on its FIRST render, which is the whole fix.
 *
 * Pure, and exported, because the ordering it decides is the bug QA found and
 * is not otherwise observable from Node — there is no DOM test environment here
 * by design (vitest.config.mts). Everything the hook does around it is React
 * plumbing; this is the decision.
 *
 *   pastHydration true   a client-only mount — a SOFT navigation. There is no
 *                        server HTML to match, so the stored draft is returned
 *                        and the form is never empty for a single render. No
 *                        effect can therefore observe an empty form and write
 *                        it over what is stored, which is what was happening.
 *
 *   pastHydration false  the hydration render of a full page load. The server
 *                        rendered an empty form and this must match it, so the
 *                        draft waits for the effect one commit later.
 *
 * Merged onto `empty` rather than returned raw, so a draft written by an older
 * build — missing a field added since — does not arrive as `undefined` in a
 * form control.
 */
export function initialDraft<T extends object>(
  stored: T | null,
  empty: T,
  pastHydration: boolean,
): T {
  if (!pastHydration || stored === null) return empty;
  return { ...empty, ...stored };
}

/**
 * Would writing `next` throw away something the stored draft still has?
 *
 * The belt to the ordering fix's braces, and deliberately NARROW: it refuses
 * only a write of an ENTIRELY blank draft over a stored one that has content.
 * That is the shape of an unrestored form, and nothing else — a rep clearing
 * their last remaining field is the same shape, and loses a draft that held one
 * value, which is a far smaller loss than the one this prevents.
 *
 * Exported for the test, because the ordering it protects is not otherwise
 * observable from Node.
 */
export function wouldClobber(next: unknown, empty: unknown, stored: unknown): boolean {
  if (stored === null || stored === undefined) return false;
  const blank = JSON.stringify(next) === JSON.stringify(empty);
  const storedIsBlank = JSON.stringify(stored) === JSON.stringify(empty);
  return blank && !storedIsBlank;
}

/**
 * @param key   where this form's draft lives. Changing it starts a new draft.
 * @param empty the shape, and what "nothing typed yet" looks like.
 *
 * `resaveOn` is a value whose change forces a re-save. Log Visit passes its
 * action state: the draft is cleared when the form is dispatched, so a
 * submission that comes back REFUSED has to put it back.
 *
 * `accept` decides whether a stored draft belongs to THIS form. Only one caller
 * needs it — Pending keeps a single draft slot shared by every institute's
 * "Visit again" panel, so the panel that opens has to check the stored draft is
 * its own before wearing it. A key per institute would make that automatic and
 * was rejected for a worse problem: drafts for panels the rep has closed would
 * accumulate with nothing to clear them.
 */
export function useDraft<T extends object>(
  key: string,
  empty: T,
  options: { resaveOn?: unknown; accept?: (stored: T) => boolean } = {},
): readonly [T, (patch: Partial<T> | ((current: T) => Partial<T>)) => void] {
  const { resaveOn, accept } = options;

  /*
   * Used directly rather than through a ref, and deliberately NOT listed in the
   * effects' dependencies below. It is rebuilt on every render, so listing it
   * would re-run the restore over live typing — the one thing that guard exists
   * to prevent. What it closes over at every call site is fixed for the life of
   * the mount (the institute whose panel is open), so the first render's copy
   * and the hundredth's answer identically.
   */
  const mine = (stored: T | null): T | null => {
    if (stored === null) return null;
    return accept && !accept(stored) ? null : stored;
  };
  const pastHydration = useSyncExternalStore(
    NEVER_CHANGES,
    PAST_HYDRATION,
    DURING_HYDRATION,
  );

  const [draft, setDraft] = useState<T>(() =>
    initialDraft(mine(readDraft<T>(key)), empty, pastHydration),
  );

  /*
   * THE HARD-LOAD HALF, and the change-of-key half.
   *
   * On a soft navigation the initialiser above has already restored and this
   * finds nothing to do. On a full page load it could not — the first render
   * had to match the server's empty markup — so this picks it up one commit
   * later.
   *
   * IT ALSO HANDLES THE FORM BEING POINTED AT A DIFFERENT DRAFT while it stays
   * mounted. `/log?plan=A` to `/log?plan=B` is the same route with different
   * search params, so React reconciles rather than remounting: the initialiser
   * does not run again, and without this the form would keep A's answers, show
   * them against B, and then save them under B's key. One visit's notes on
   * another visit's form is exactly what keying the draft exists to prevent.
   *
   * The ref holds the key it last restored for rather than a boolean, which is
   * what tells the two cases apart. A first restore is conservative — it fills
   * an untouched form and leaves a typed-in one alone — while a CHANGE of key
   * replaces outright, because what is on screen belongs to the draft being
   * left behind.
   */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (restoredFor.current === key) return;
    const switched = restoredFor.current !== null;
    restoredFor.current = key;
    const stored = mine(readDraft<T>(key));
    setDraft((current) =>
      switched || JSON.stringify(current) === JSON.stringify(empty)
        ? initialDraft(stored, empty, true)
        : current,
    );
    // `empty` is a module constant at every call site; listing it would make
    // this depend on an identity that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /*
   * SAVED ON EVERY CHANGE. A storage write is what an effect is for — pushing
   * React's state out to an external system — so there is no setState here.
   *
   * No "skip the first run" any more. It is not needed, because the first run
   * now holds the restored draft rather than an empty one, and it was never
   * sufficient anyway. `wouldClobber` covers the one case left: the hydration
   * render, where the first commit genuinely does hold an empty form while a
   * good draft is still in storage.
   */
  useEffect(() => {
    if (wouldClobber(draft, empty, mine(readDraft<T>(key)))) return;
    writeDraft(key, draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draft, resaveOn]);

  /*
   * Takes an UPDATER as well as an object, and that is not a convenience.
   *
   * `applyFeedbackPatch` was made functional after a bug found by driving the
   * live form: two changes in the same tick both merged against the render they
   * started from, so the first answer vanished. A patcher that could only take a
   * plain object would reintroduce exactly that — the caller would have to read
   * the current draft during render to build it. Passing a function lets the
   * merge happen against the latest state instead.
   */
  const patch = (fields: Partial<T> | ((current: T) => Partial<T>)) =>
    setDraft((current) => ({
      ...current,
      ...(typeof fields === "function" ? fields(current) : fields),
    }));

  return [draft, patch] as const;
}
