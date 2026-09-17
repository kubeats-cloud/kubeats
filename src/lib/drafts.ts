/**
 * Keeping a half-finished form alive across a Back and a Forward.
 *
 * WHAT THIS IS FOR. A rep fills in Log Visit, taps something that navigates —
 * the institute link, the browser's own Back — and comes back to an empty form.
 * Everything they typed is gone: the status, the dates, the notes they wrote
 * standing in a corridor. The photo and the check-in survive, because those are
 * in the database; the typing does not, because it was only ever React state.
 *
 * WHY sessionStorage AND NOT localStorage. A draft is a thing in progress, not
 * a saved document. sessionStorage dies with the tab, which is the right
 * lifetime: a rep who closes the app and opens it tomorrow should not be handed
 * yesterday's half-written note about a visit they have since filed. It is also
 * per-tab, so two tabs cannot overwrite each other's work.
 *
 * WHY IT IS NOT THE SOURCE OF TRUTH, AND MUST NEVER BECOME ONE. Everything here
 * is a convenience over values the form already holds. Every read can fail and
 * every write can fail — Safari's private mode throws on write, a browser set
 * to block site data throws on access, quota can be exceeded — so every call is
 * wrapped and every failure degrades to "no draft", which is exactly the
 * behaviour the app had before this file existed. A draft that cannot be saved
 * must never be a visit that cannot be filed.
 *
 * WHAT IS DELIBERATELY NOT KEPT HERE: the photograph. See the note in
 * log-visit-form.tsx — restoring a path to an uploaded file without the preview
 * that proves it is there would claim a photo the rep cannot see.
 */

/**
 * One namespace, so a draft is recognisable in a devtools pane and cannot
 * collide with anything else a browser extension has put there.
 */
const PREFIX = "kubeats:draft:";

/**
 * The Log Visit form, keyed by the PLAN ENTRY it belongs to.
 *
 * Keyed rather than global, and this is the part that matters: a rep finishes
 * one visit, starts the next, and must not be handed the previous institute's
 * notes. `plan.id` is the one identifier that is unique per visit and is
 * already on screen. Two different visits are two different keys and cannot see
 * each other's drafts.
 */
export const logVisitDraftKey = (planId: string) => `${PREFIX}log-visit:${planId}`;

/**
 * The "Visit again" panel on Pending.
 *
 * ONE key rather than one per institute, because only one panel is open at a
 * time — the component holds a single `open` id — so a per-institute key would
 * accumulate drafts for panels the rep has already closed. The stored value
 * carries the institute id with it, and a draft whose institute is no longer in
 * the list is ignored on read.
 */
export const followUpDraftKey = () => `${PREFIX}follow-up`;

/**
 * The store, or null where there isn't one.
 *
 * Null on the server (no `window`), and null in a browser that throws on the
 * ACCESS itself rather than on the call — reading `window.sessionStorage` is
 * enough to raise a SecurityError when site data is blocked, so even this much
 * needs the try.
 */
function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Read a draft back, or null if there isn't a usable one.
 *
 * Typed by the caller and NOT validated here, deliberately: this file cannot
 * know the shape of every form, and a draft is a convenience whose worst
 * failure is an odd-looking prefilled field the rep can overwrite. What it does
 * guarantee is that malformed JSON, a cleared store or a browser that refuses
 * all of it come back as null rather than as an exception in a render.
 */
export function readDraft<T>(key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // A JSON scalar is not a draft. Anything that is not a plain object is
    // treated as absent rather than handed to a caller expecting fields.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/** Save a draft. Failure is silent and harmless — see the file header. */
export function writeDraft(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, blocked site data, quota. The form still works.
  }
}

/** Forget a draft. Called when the work it was holding has been filed. */
export function clearDraft(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Same as above. A draft that cannot be cleared is cleared by the tab
    // closing, which is the lifetime sessionStorage gives it anyway.
  }
}
