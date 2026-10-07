"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Which columns a viewer has hidden on a table — remembered per browser.
 *
 * ⚠ DISPLAY ONLY, AND THAT IS THE WHOLE CONTRACT. Hiding a column changes what
 * is DRAWN and nothing else: the same query runs, the same rows come back under
 * the same RLS, and the .xlsx export never consults any of this. A reader who
 * hides "Registered by" has not been denied anything — they have folded it
 * away, the way a spreadsheet hides a column. Anything that made a hidden
 * column also unfetched would turn a convenience into a permission, and the
 * permission would be the browser's, which is no permission at all.
 *
 * ⚠ THE STORED VALUE IS WHAT IS HIDDEN, NEVER WHAT IS SHOWN, and the asymmetry
 * is load-bearing. Columns get ADDED — the status bands are generated from a
 * vocabulary an admin extends from Settings, so a new one can appear overnight.
 * Store the shown set and that new column is absent from every stored list, so
 * it is invisible to everybody who ever opened the picker, for ever, with
 * nothing on screen to say so. Store the hidden set and a new column is shown
 * by default to everyone, which is the rule this feature promises.
 *
 * WHY localStorage AND NOT THE URL. The repo's filter state lives in the URL —
 * `institutes-browser.tsx` makes the argument — because a filter is part of the
 * question being asked and is worth sharing in a link. A column choice is not
 * part of the question; it is how one person likes to read the answer. Putting
 * it in the URL would mean every shared link carried somebody else's layout,
 * and the choice would be lost the moment you navigated away. This survives
 * both.
 *
 * ⚠ useSyncExternalStore, NOT useState + useEffect, and the reason is the one
 * failure this codebase has already paid for once. These tables are
 * server-rendered; reading localStorage during render would make the server's
 * HTML disagree with the client's first render, which is a hydration mismatch —
 * React discards the tree and logs #418, and dates.ts records what that cost
 * when it happened. `getServerSnapshot` returns the default, so the server and
 * the first client paint agree by construction, and the stored value is applied
 * on the commit after. A column the reader hid is therefore visible for one
 * frame and then folds away: a flash of too much, which is the right way round.
 *
 * It also buys cross-tab sync honestly — the `storage` event fires in the other
 * tabs, so a reader with the report open twice does not see two layouts.
 *
 * EVERY ACCESS IS WRAPPED. localStorage throws outright in some contexts — a
 * browser set to block site data, a privacy mode, an embedded webview — and
 * returns null in plenty of ordinary ones. A table that cannot render because a
 * preference could not be read would be a poor trade for the preference, so
 * every read and write below fails to "nothing hidden".
 */

/** Bumped only if the stored shape changes; an unreadable version is ignored. */
const VERSION = "v1";

/** Same-tab notification. `storage` only fires in OTHER tabs. */
const CHANGED = "kubeats:table-view";

const keyFor = (table: string) => `kubeats.view.${VERSION}.${table}`;

/**
 * The snapshot is the RAW STRING, deliberately.
 *
 * `useSyncExternalStore` compares snapshots with Object.is and re-renders when
 * they differ, so returning a freshly-parsed array or Set every call would
 * never compare equal and would loop for ever. A string is a stable primitive;
 * parsing happens once per change, in the `useMemo` below.
 */
function getSnapshot(table: string): string {
  try {
    return window.localStorage.getItem(keyFor(table)) ?? "";
  } catch {
    return "";
  }
}

/** The server knows nothing and must say so: default is everything shown. */
function getServerSnapshot(): string {
  return "";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function parse(raw: string): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    // Anything that is not an array of strings is treated as absent rather than
    // repaired: a half-understood preference is worse than the default, and the
    // default is "show everything", which is never wrong.
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function write(table: string, hidden: string[]): void {
  try {
    if (hidden.length === 0) {
      // An empty preference is the default, so it is REMOVED rather than
      // stored. Keeps the key out of storage for the majority who never change
      // anything, and means "reset" leaves no trace to go stale.
      window.localStorage.removeItem(keyFor(table));
    } else {
      window.localStorage.setItem(keyFor(table), JSON.stringify(hidden));
    }
  } catch {
    // The toggle still works for this page view; it simply will not be
    // remembered. Silent on purpose — there is nothing the reader can do about
    // a browser that blocks site data, and a warning about it beside a table
    // would be noise on every render.
  }
  // Fired even when the write above threw, so the picker still responds in a
  // browser that cannot persist. The snapshot will read back as "" and the
  // toggle will not stick, which is the honest behaviour for that browser.
  window.dispatchEvent(new Event(CHANGED));
}

export interface TableView {
  /** True when this column should be drawn. */
  shows: (key: string) => boolean;
  /** How many of `allKeys` are currently hidden. */
  hiddenCount: number;
  toggle: (key: string) => void;
  /** Show or hide a whole group at once — the band headers in the picker. */
  setMany: (keys: string[], shown: boolean) => void;
  showAll: () => void;
}

/**
 * @param table   Stable storage key. Name the TABLE, not the page — Review and
 *                the Institutes list keep their own, and the activity grid
 *                keeps one per screen it appears on, because the same grid
 *                shows different bands in different places.
 * @param allKeys Every column this table can draw. Used only to count what is
 *                hidden; never stored, so a column added later is shown.
 */
export function useTableView(table: string, allKeys: string[]): TableView {
  const raw = useSyncExternalStore(
    subscribe,
    () => getSnapshot(table),
    getServerSnapshot,
  );

  const hidden = useMemo(() => new Set(parse(raw)), [raw]);

  const toggle = useCallback(
    (key: string) => {
      const next = new Set(parse(getSnapshot(table)));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      write(table, [...next]);
    },
    [table],
  );

  const setMany = useCallback(
    (keys: string[], shown: boolean) => {
      const next = new Set(parse(getSnapshot(table)));
      for (const key of keys) {
        if (shown) next.delete(key);
        else next.add(key);
      }
      write(table, [...next]);
    },
    [table],
  );

  const showAll = useCallback(() => write(table, []), [table]);

  return {
    // Read from the set rather than a captured list, so a key the table draws
    // but never declared still renders — "unknown means shown" is the same rule
    // the storage shape encodes.
    shows: (key: string) => !hidden.has(key),
    hiddenCount: allKeys.filter((key) => hidden.has(key)).length,
    toggle,
    setMany,
    showAll,
  };
}
