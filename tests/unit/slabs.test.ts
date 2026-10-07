import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  nextSlabStart,
  slabSetKey,
  slabSetSchema,
  slabsEditable,
  validateSlabSet,
  SLAB_STATUSES,
  type SlabSetInput,
} from "@/lib/validation/slabs";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

/**
 * The slab rules, in the copy that runs in the browser.
 *
 * ⚠ THE SAME RULES LIVE IN 0044's save_slabs(), and that is the one that holds
 * against a hand-rolled request. This file's job is that the two do not DRIFT:
 * a rule the form accepts and the database refuses is a rep stuck on a screen
 * that looks fine, and the last section checks each rule is spelled in both.
 */

const set = (over: Partial<SlabSetInput> = {}): SlabSetInput =>
  slabSetSchema.parse({
    institute_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d1f",
    scope: "total",
    college: "",
    program: "",
    slabs: [{ start: "0", end: "" }],
    ...over,
  });

const messages = (input: SlabSetInput) => validateSlabSet(input).map((p) => p.message);

describe("a valid set", () => {
  it("accepts one open-ended slab", () => {
    expect(validateSlabSet(set())).toEqual([]);
  });

  it("accepts a contiguous run ending open", () => {
    expect(
      validateSlabSet(
        set({
          slabs: [
            { start: "0", end: "99" },
            { start: "100", end: "499" },
            { start: "500", end: "" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("accepts program-wise with both names", () => {
    expect(
      validateSlabSet(
        set({ scope: "program", college: "Engineering", program: "B.Tech CSE" }),
      ),
    ).toEqual([]);
  });
});

describe("the rules, each refused on its own", () => {
  it("refuses a gap", () => {
    expect(
      messages(
        set({
          slabs: [
            { start: "0", end: "99" },
            { start: "200", end: "" },
          ],
        }),
      ),
    ).toContain("Slab 2 must start at 100, right after the previous slab ends.");
  });

  it("refuses an overlap", () => {
    expect(
      messages(
        set({
          slabs: [
            { start: "0", end: "99" },
            { start: "50", end: "" },
          ],
        }),
      ),
    ).toContain("Slab 2 must start at 100, right after the previous slab ends.");
  });

  /**
   * ⚠ NOT SORTED FIRST. Sorting would silently repair this into something the
   * rep did not type, and "the next slab starts where the last one ended" is
   * the whole rule — so out-of-order IS a gap, and is reported as one.
   */
  it("refuses out-of-order rows rather than sorting them", () => {
    const problems = messages(
      set({
        slabs: [
          { start: "0", end: "9" },
          { start: "20", end: "29" },
          { start: "10", end: "" },
        ],
      }),
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((m) => m.includes("Slab 2 must start at 10"))).toBe(true);
  });

  it("refuses End before Start", () => {
    expect(
      messages(set({ slabs: [{ start: "100", end: "50" }, { start: "101", end: "" }] })),
    ).toContain("Slab 1: the end cannot be before the start.");
  });

  it("refuses a middle slab with no end", () => {
    expect(
      messages(set({ slabs: [{ start: "0", end: "" }, { start: "100", end: "" }] })),
    ).toContain("Slab 1 needs an end. Only the last slab is open-ended.");
  });

  /** Exactly one open-ended slab, and it must be the last. */
  it("refuses a closed last slab", () => {
    expect(
      messages(set({ slabs: [{ start: "0", end: "99" }] })),
    ).toContain('The last slab must be open-ended — leave its end blank for "0 and above".');
  });

  it("refuses a negative start", () => {
    expect(messages(set({ slabs: [{ start: "-5", end: "" }] }))).toContain(
      "Slab 1: a start cannot be negative.",
    );
  });

  it("refuses an empty set", () => {
    expect(slabSetSchema.safeParse({
      institute_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d1f",
      scope: "total", college: "", program: "", slabs: [],
    }).success).toBe(false);
  });

  it("refuses a total set carrying a college or programme", () => {
    expect(messages(set({ scope: "total", college: "Engineering" }))).toContain(
      "A total slab set covers every programme, so it carries no college or programme.",
    );
  });

  it("refuses a program-wise set missing either name", () => {
    expect(messages(set({ scope: "program", college: "Engineering" }))).toContain(
      "A program-wise slab set needs both a college and a programme.",
    );
    expect(messages(set({ scope: "program", program: "B.Tech" }))).toContain(
      "A program-wise slab set needs both a college and a programme.",
    );
  });

  /**
   * EVERY problem, not the first. A rep fixing a six-row table one refusal at a
   * time is the experience this exists to avoid.
   */
  it("reports every problem at once", () => {
    const problems = validateSlabSet(
      set({
        scope: "program",
        college: "",
        program: "",
        slabs: [
          { start: "10", end: "5" },
          { start: "99", end: "120" },
        ],
      }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the next start, auto-suggested", () => {
  it("is one past the last closed end", () => {
    expect(nextSlabStart([{ start: 0, end: 99 }])).toBe(100);
    expect(nextSlabStart([{ start: 0, end: 99 }, { start: 100, end: 499 }])).toBe(500);
  });

  /** Nothing to suggest FROM: a 0 would put a number in a box nobody chose. */
  it("is null when there is nothing to go on", () => {
    expect(nextSlabStart([])).toBeNull();
    expect(nextSlabStart([{ start: 0, end: null }])).toBeNull();
  });
});

describe("status", () => {
  it("has exactly three, and no Revoked", () => {
    expect(SLAB_STATUSES).toEqual(["pending", "approved", "rejected"]);
    expect(SLAB_STATUSES as readonly string[]).not.toContain("revoked");
  });

  /** Approved is frozen; pending and rejected are the rep's to edit. */
  it("locks only an approved set", () => {
    expect(slabsEditable("approved")).toBe(false);
    expect(slabsEditable("pending")).toBe(true);
    expect(slabsEditable("rejected")).toBe(true);
    expect(slabsEditable(null)).toBe(true);
  });

  it("keys a set the way the migration matches it", () => {
    expect(slabSetKey({ scope: "total", college: null, program: null })).toBe("total");
    expect(slabSetKey({ scope: "program", college: "Eng", program: "CSE" })).toBe(
      "program:Eng:CSE",
    );
  });
});

/* ------------------------------------------------------------------ */

describe("the app's rules and the database's say the same thing", () => {
  const sql = () => read("supabase/migrations/0044_institute_slabs.sql");

  /**
   * ⚠ COMMENTS STRIPPED. 0044 explains every rule in prose as well as enforcing
   * it, and 0043 rolled back because an assertion matched a function's own
   * explanation of what it had stopped doing. Read the code.
   */
  const code = () =>
    sql()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--.*$/gm, "");

  it("enforces every set rule in save_slabs too", () => {
    const body = code();
    for (const rule of [
      "Only the last slab is open-ended",
      "the end cannot be before the start",
      "right after the previous slab ends",
      "a start cannot be negative",
      "must be open-ended",
    ]) {
      expect(body, `save_slabs() does not enforce: ${rule}`).toContain(rule);
    }
  });

  /** The per-row constraints, which hold against a direct insert. */
  it("keeps the row-level constraints", () => {
    const body = code();
    expect(body).toContain("slab_range_ordered");
    expect(body).toContain("slab_start_non_negative");
    expect(body).toContain("slab_scope_shape");
    // One open-ended slab per set — unique AND partial.
    expect(body).toContain("create unique index if not exists slab_one_open_ended");
    expect(body).toContain("where end_count is null");
  });

  /**
   * ⚠ save_slabs MUST be SECURITY INVOKER. A definer rewrite would stop RLS
   * applying inside it and punch a hole through the boundary 0042 drew — the
   * rule CLAUDE.md states for log_visit() and close_visit().
   */
  it("keeps save_slabs invoker and decide_slabs definer", () => {
    const body = code();
    const save = body.slice(body.indexOf("create or replace function public.save_slabs"));
    expect(save.slice(0, 400)).toContain("security invoker");

    const decide = body.slice(body.indexOf("create or replace function public.decide_slabs"));
    expect(decide.slice(0, 400)).toContain("security definer");
    // Admin first, the house rule for a boundary-crossing RPC.
    expect(decide.slice(0, 900)).toContain("if not public.is_admin() then");
  });

  /** There is no fourth status anywhere. */
  it("stores no Revoked status", () => {
    expect(code()).toContain("status in ('pending', 'approved', 'rejected')");
    expect(code()).not.toMatch(/'revoked'/i);
  });

  /** Empanelled is computed, never a column. */
  it("computes empanelled rather than storing it", () => {
    const body = code();
    expect(body).toContain("create or replace function public.institute_is_empanelled");
    expect(body).not.toMatch(/empanelled\s+boolean/i);
  });

  /**
   * ⚠ THE NUMBER HAS NO SOURCE YET. Nothing may read a live admission count and
   * decide which slab applies — that is deferred, and a function that guessed
   * would be inventing data.
   */
  it("consumes no admission count", () => {
    const body = code();
    expect(body).not.toMatch(/current_admissions|admission_count\b|slab_for\(/i);
    const app = read("src/lib/validation/slabs.ts");
    expect(app).not.toMatch(/function (slabFor|currentSlab)/);
  });
});
