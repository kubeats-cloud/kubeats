import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 0074 is the one-way door: it moves follow_up_tasks.status_set_to from the
 * VISIT vocabulary to the CALL vocabulary and changes nothing else. There is
 * no database available to a unit test, so the migration is asserted as text -
 * the same call `review-filters.test.ts` makes for a query builder.
 *
 * The properties that matter here are the ones a reader cannot see at a
 * glance: that the pre-flight runs BEFORE anything is dropped, that the
 * constraint keeps its name (0052/0065 look it up by name), that the visit
 * track is checked rather than assumed, and that the down migration is
 * allowed to fail with the native 23503 instead of a friendlier custom error.
 */

const migration = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/0074_retarget_call_status_fk.sql", import.meta.url),
  ),
  "utf8",
);

const rollback = readFileSync(
  fileURLToPath(
    new URL("../../supabase/rollbacks/0074_retarget_call_status_fk_down.sql", import.meta.url),
  ),
  "utf8",
);

describe("0074 — the call key moves, the visit track does not", () => {
  it("recreates the SAME constraint name against call_statuses", () => {
    expect(migration).toContain("drop constraint if exists follow_up_tasks_status_set_to_fk");
    expect(migration).toContain("add constraint follow_up_tasks_status_set_to_fk");
    expect(migration).toContain(
      "foreign key (status_set_to) references public.call_statuses (status)",
    );
  });

  it("keeps both actions restricted, as the visit key had them", () => {
    expect(migration).toContain("on update restrict on delete restrict");
  });

  it("checks the visit keys point at institute_statuses, in pre-flight and after", () => {
    const pre = migration.slice(0, migration.indexOf("-- 2. The flip"));
    const post = migration.slice(migration.indexOf("-- 3. Prove it landed"));

    for (const fk of ["institutes_status_fk", "visits_status_set_to_fk"]) {
      expect(pre, `${fk} missing from pre-flight`).toContain(fk);
      expect(post, `${fk} missing from post-check`).toContain(fk);
    }
    expect(post).toContain("confrelid = 'public.institute_statuses'::regclass");
  });

  it("refuses to run before the inert half exists", () => {
    for (const object of [
      "call_statuses",
      "call_status_fields",
      "institute_call_status_history",
      "audit_open_follow_ups",
      "institutes.call_status",
    ]) {
      expect(migration).toContain(object);
    }
    expect(migration).toContain("position('call_statuses' in body)");
  });

  it("counts orphans against call_statuses and aborts BEFORE dropping the key", () => {
    const orphans = migration.indexOf("have no call_statuses row");
    const raise = migration.indexOf("raise exception '0074 pre-flight failed");
    const drop = migration.indexOf("drop constraint if exists follow_up_tasks_status_set_to_fk");

    expect(orphans).toBeGreaterThan(-1);
    expect(raise).toBeGreaterThan(orphans);
    expect(drop, "the key is dropped before the pre-flight can abort").toBeGreaterThan(raise);
    expect(migration).toContain("left join public.call_statuses s on s.status = t.status_set_to");
  });

  it("is arithmetic, not a function/view/policy migration", () => {
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(migration).not.toMatch(/create\s+(table|view|trigger|policy|index)\b/i);
    expect(migration).not.toMatch(/alter\s+table\s+public\.(institutes|visits)\b/i);
    expect(migration).not.toMatch(/alter\s+policy\b/i);
  });

  it("runs as one transaction so a failure cannot leave the table unprotected", () => {
    const begin = migration.indexOf("\nbegin;");
    const commit = migration.indexOf("\ncommit;");
    const post = migration.indexOf("-- 3. Prove it landed");

    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(post);
  });
});

describe("0074 down — one-way past divergence, by design", () => {
  it("puts the key back on institute_statuses with the same name and actions", () => {
    expect(rollback).toContain("drop constraint if exists follow_up_tasks_status_set_to_fk");
    expect(rollback).toContain("add constraint follow_up_tasks_status_set_to_fk");
    expect(rollback).toContain(
      "foreign key (status_set_to) references public.institute_statuses (status)",
    );
    expect(rollback).toContain("on update restrict on delete restrict");
  });

  it("says plainly that a diverged call makes it fail with 23503", () => {
    expect(rollback).toMatch(/one-way/i);
    expect(rollback).toContain("23503");
    expect(rollback).toMatch(/ONLY CLEAN WHILE/i);
    expect(rollback).toMatch(/HAS NOT[\s\S]{0,10}DIVERGED/i);
  });

  it("lets the native 23503 surface rather than pre-checking", () => {
    // The ALTER is before the first raise_exception: the refusal comes from
    // the foreign key itself. A custom pre-check would hide the evidence the
    // header promises.
    const add = rollback.indexOf("add constraint follow_up_tasks_status_set_to_fk");
    const firstRaise = rollback.indexOf("raise exception");

    expect(add).toBeGreaterThan(-1);
    expect(firstRaise).toBeGreaterThan(add);
    expect(rollback).not.toMatch(/raise exception[^;]*23503/i);
  });

  it("trusts the transaction to undo the DROP when the key cannot be rebuilt", () => {
    expect(rollback).toMatch(/\nbegin;/);
    expect(rollback).toMatch(/\ncommit;\s*$/);
  });

  it("does not pretend to undo the data or the read paths", () => {
    expect(rollback).toMatch(/does not undo/i);
    expect(rollback).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(rollback).not.toMatch(/create\s+(table|view|trigger|policy)\b/i);
  });
});
