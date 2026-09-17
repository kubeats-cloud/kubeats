import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  followUpDraftKey,
  logVisitDraftKey,
  readDraft,
  writeDraft,
} from "@/lib/drafts";

/**
 * Draft persistence — #9 and #10.
 *
 * A rep filled in Log Visit, navigated, came back, and found an empty form. The
 * check-in and the photo survived because they are in the database; the status,
 * the dates and the notes did not, because they were only ever React state.
 *
 * The property that matters most here is NOT that drafts are saved — it is that
 * a draft which cannot be saved changes nothing. sessionStorage throws in more
 * situations than people expect: Safari's private mode on write, a browser set
 * to block site data on the very act of touching `window.sessionStorage`, quota
 * on a long note. Every one of those has to come out as "no draft", never as an
 * exception in a render, because the form it is helping must still be able to
 * file a visit.
 */

/** A stand-in for the real thing, so each test starts from a known store. */
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

const install = (storage: Storage | (() => never)) => {
  vi.stubGlobal("window", {
    get sessionStorage() {
      return typeof storage === "function" ? storage() : storage;
    },
  });
};

beforeEach(() => {
  install(fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a draft survives the round trip", () => {
  it("comes back as the object that went in", () => {
    const key = logVisitDraftKey("plan-1");
    writeDraft(key, { statusSetTo: "Session done", notes: "Went well." });
    expect(readDraft(key)).toEqual({
      statusSetTo: "Session done",
      notes: "Went well.",
    });
  });

  it("is null when nothing was ever saved", () => {
    expect(readDraft(logVisitDraftKey("never-touched"))).toBeNull();
  });

  it("is gone once cleared", () => {
    const key = logVisitDraftKey("plan-1");
    writeDraft(key, { notes: "typed" });
    clearDraft(key);
    expect(readDraft(key)).toBeNull();
  });
});

describe("one visit's draft never reaches another's form", () => {
  it("keys Log Visit drafts by the plan entry", () => {
    // THE REGRESSION THIS PREVENTS. A rep finishes at one school, starts at the
    // next, and must not be handed the previous institute's notes. Two visits
    // are two plan rows, so they are two keys.
    expect(logVisitDraftKey("plan-a")).not.toBe(logVisitDraftKey("plan-b"));

    writeDraft(logVisitDraftKey("plan-a"), { notes: "about A" });
    expect(readDraft(logVisitDraftKey("plan-b"))).toBeNull();
    expect(readDraft(logVisitDraftKey("plan-a"))).toEqual({ notes: "about A" });
  });

  it("keeps Log Visit and the follow-up panel in separate keys", () => {
    writeDraft(logVisitDraftKey("plan-a"), { notes: "log" });
    writeDraft(followUpDraftKey(), { instituteId: "i1", purpose: "Other" });
    expect(readDraft(logVisitDraftKey("plan-a"))).toEqual({ notes: "log" });
    expect(readDraft(followUpDraftKey())).toEqual({
      instituteId: "i1",
      purpose: "Other",
    });
  });

  it("namespaces every key, so nothing else in the tab can collide", () => {
    for (const key of [logVisitDraftKey("plan-a"), followUpDraftKey()]) {
      expect(key.startsWith("kubeats:draft:")).toBe(true);
    }
  });
});

/**
 * The half that keeps a broken store from becoming a broken form.
 *
 * Each of these would be an exception thrown inside a render or an effect if it
 * were not caught — and the form it happens on is the one a rep files a visit
 * from, so the failure has to be nothing at all.
 */
describe("a store that refuses to work is simply no store", () => {
  it("reads null when touching sessionStorage itself throws", () => {
    // Blocked site data: the SecurityError comes from the property access, not
    // from getItem, which is why the guard has to wrap the access too.
    install(() => {
      throw new Error("SecurityError: access denied");
    });
    expect(readDraft(logVisitDraftKey("plan-1"))).toBeNull();
  });

  it("swallows a write that throws, like a private-mode quota", () => {
    install(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeDraft(logVisitDraftKey("plan-1"), { notes: "x" })).not.toThrow();
  });

  it("swallows a clear that throws", () => {
    install(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearDraft(logVisitDraftKey("plan-1"))).not.toThrow();
  });

  it("reads null on the server, where there is no window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(readDraft(logVisitDraftKey("plan-1"))).toBeNull();
    expect(() => writeDraft(logVisitDraftKey("plan-1"), { a: 1 })).not.toThrow();
  });
});

describe("only an object is a draft", () => {
  const key = logVisitDraftKey("plan-1");

  it("ignores a value that is not JSON at all", () => {
    window.sessionStorage.setItem(key, "{not json");
    expect(readDraft(key)).toBeNull();
  });

  it.each([
    ["a string", '"just a string"'],
    ["a number", "42"],
    ["null", "null"],
    ["an array", "[1,2,3]"],
  ])("ignores %s, which no form could read as fields", (_label, raw) => {
    // A caller types the result and then reads fields off it. Handing back a
    // number would turn a junk value in one browser into a crash on a form.
    window.sessionStorage.setItem(key, raw);
    expect(readDraft(key)).toBeNull();
  });
});
