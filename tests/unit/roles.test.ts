import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { effectiveRole, isAdmin, isStaff, isTeamLead } from "@/lib/auth";
import type { CurrentUser, Role } from "@/lib/auth";
import { ROLES, newMemberSchema, memberUpdateSchema } from "@/lib/validation/admin";

/**
 * H1: the third role exists and nothing else moved.
 *
 * What this file CANNOT prove is the half that matters most — that FO033 stops
 * a rep assigning themselves to a team, that FO021 refuses a campus-less team
 * lead, and that supervises() is exactly the old predicate while no link is
 * set. Those are claims about four triggers and a function body, and only a
 * real database answers them; the `team_lead` block in
 * tests/integration/rules.test.ts is where they go once 0041 is applied to dev.
 *
 * What is here: the role predicates, the degradation rule, the campus rule in
 * both member schemas, and — the guard that matters most in H1 — that this step
 * is BEHAVIOUR-NEUTRAL for the two roles that exist today.
 */

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: "u1",
  email: "someone@example.test",
  profile: { id: "u1", name: "Someone", role: "rep", mobile: null },
  profileStatus: "ready",
  role: "rep",
  name: "Someone",
  ...over,
});

const ALL_ROLES: Role[] = ["rep", "team_lead", "admin"];

describe("the three role predicates", () => {
  it("each matches exactly one role", () => {
    for (const role of ALL_ROLES) {
      const u = user({ role });
      expect(isAdmin(u), role).toBe(role === "admin");
      expect(isTeamLead(u), role).toBe(role === "team_lead");
      expect(isStaff(u), role).toBe(role !== "rep");
    }
  });

  /**
   * ⚠ isAdmin() MUST NOT HAVE WIDENED. A third role is exactly the moment
   * somebody loosens this one by habit, and it gates the shared vocabulary
   * (statuses, purposes, locations), /data, /materials/manage and every
   * Settings mutation — none of which has a team dimension, so a team lead
   * writing them would write across every other team.
   */
  it("still refuses a team lead everywhere isAdmin() is asked", () => {
    expect(isAdmin(user({ role: "team_lead" }))).toBe(false);
  });

  /**
   * Least privilege, unchanged from when there were two roles: a profile that
   * could not be read is nobody in particular.
   */
  it("treats an unreadable profile as no role at all", () => {
    for (const status of ["no-profile", "schema-pending", "unavailable"] as const) {
      // getCurrentUser() reports role "rep" in this state, so the row claims
      // one; the predicates must still refuse, which is what profileStatus is
      // for.
      const u = user({ profileStatus: status, role: "rep" });
      expect(isAdmin(u), status).toBe(false);
      expect(isTeamLead(u), status).toBe(false);
      expect(isStaff(u), status).toBe(false);
    }
    expect(isAdmin(null)).toBe(false);
    expect(isTeamLead(null)).toBe(false);
    expect(isStaff(null)).toBe(false);
  });
});

describe("effectiveRole — which role to BEHAVE as", () => {
  it("is the row's role when the row loaded", () => {
    for (const role of ALL_ROLES) {
      expect(effectiveRole(user({ role })), role).toBe(role);
    }
  });

  /**
   * THE DEGRADATION RULE, IN ONE PLACE. A failed lookup renders rep navigation
   * rather than a workspace — the same guarantee isAdmin() gave when
   * navItemsFor() took a boolean. With three roles every caller would otherwise
   * re-derive this ternary, and the first to get it wrong hands a team lead a
   * rep's bar.
   */
  it("degrades to rep when the profile did not load, whatever the row said", () => {
    for (const status of ["no-profile", "schema-pending", "unavailable"] as const) {
      expect(effectiveRole(user({ profileStatus: status, role: "admin" })), status).toBe("rep");
      expect(effectiveRole(user({ profileStatus: status, role: "team_lead" })), status).toBe("rep");
    }
    expect(effectiveRole(null)).toBe("rep");
  });
});

/* ------------------------------------------------------------------ */

describe("a team lead is campus-scoped, exactly as a rep is", () => {
  const base = {
    name: "Asha",
    email: "asha@example.test",
    password: "temporary-one",
    campus_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d1f",
  };

  it("accepts all three roles as a vocabulary", () => {
    expect(ROLES).toEqual(["rep", "team_lead", "admin"]);
  });

  it("demands a campus for a team lead", () => {
    const without = newMemberSchema.safeParse({
      ...base,
      role: "team_lead",
      campus_id: "",
    });
    expect(without.success).toBe(false);
    expect(
      without.error?.issues.some((i) => i.path.includes("campus_id")),
    ).toBe(true);

    expect(newMemberSchema.safeParse({ ...base, role: "team_lead" }).success).toBe(true);
  });

  /** Unchanged, and asserted so the rewritten branch did not lose it. */
  it("still demands one for a rep and still forbids one for an admin", () => {
    expect(newMemberSchema.safeParse({ ...base, role: "rep", campus_id: "" }).success).toBe(false);
    expect(newMemberSchema.safeParse({ ...base, role: "rep" }).success).toBe(true);
    expect(newMemberSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
    expect(
      newMemberSchema.safeParse({ ...base, role: "admin", campus_id: "" }).success,
    ).toBe(true);
  });

  it("applies the same rule in the editor", () => {
    const edit = (role: string, campus_id: string) =>
      memberUpdateSchema.safeParse({
        member: "8b1a9953-4c22-4d1f-9b1a-99534c224d2f",
        name: "Asha",
        campus_id,
        role,
        retag: false,
      }).success;

    expect(edit("team_lead", base.campus_id)).toBe(true);
    expect(edit("team_lead", "")).toBe(false);
    expect(edit("rep", base.campus_id)).toBe(true);
    expect(edit("rep", "")).toBe(false);
    expect(edit("admin", "")).toBe(true);
    expect(edit("admin", base.campus_id)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("H1 is behaviour-neutral, and the migration says so at source level", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

  /**
   * A TypeScript file with its prose removed.
   *
   * ⚠ THE SAME TRAP THREE SUITES IN THIS REPO HAVE NOW HIT. These files explain
   * their own decisions by NAMING the thing they avoid — "requireAdmin() is the
   * second layer", "`profiles!team_lead_id` would be a second self-relation" —
   * so a guard that greps the raw text fails the moment the code documents
   * itself. Read the code; leave the essay alone.
   */
  const tsCode = (path: string) =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  const sql = () => read("supabase/migrations/0041_team_leads.sql");

  /**
   * The migration with its prose removed.
   *
   * ⚠ THE DIFFERENCE BETWEEN A TEST AND A WORD SEARCH. 0041 documents its own
   * refusals — the footer shows the exact `update … set team_lead_id` a rep
   * would try and the FO033 they would get — so a source guard reading the raw
   * file fails the moment the file explains itself. The same trap the alerts
   * suite hit on `current_date`. Comments go; the `$$` bodies stay, because
   * nothing in them looks like a comment.
   */
  const code = () =>
    sql()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, "");

  /**
   * ⚠ THE CLAIM THE WHOLE STEP RESTS ON: 0041 changes no RLS predicate.
   *
   * That is what makes it safe to apply to a live database at any time, before
   * or after the code ships. A `create policy` in this file would silently make
   * it a different kind of migration — one that needs the deploy coupling H0
   * describes and the review 0042 is going to get.
   */
  it("creates and drops no policy", () => {
    const body = code();
    expect(body.match(/create policy/gi) ?? []).toEqual([]);
    expect(body.match(/^\s*drop policy/gim) ?? []).toEqual([]);
    expect(body.match(/alter policy/gi) ?? []).toEqual([]);
  });

  /** And writes no link, so supervises() is still the old predicate. */
  it("assigns nobody to a team", () => {
    const body = code();
    expect(body).not.toMatch(/update\s+public\.profiles\s+set[^;]*team_lead_id/i);
    expect(body).not.toMatch(/team_lead_id\s*=\s*created_by/i);
  });

  /**
   * ⚠ THE RECURSION TRAP. All three helpers read public.profiles, and 0042
   * makes profiles_select itself call supervises(). An INVOKER function would
   * recurse on the very policy that calls it — which is the one-line reason
   * 0001 gives for is_admin() being a definer.
   */
  it("makes every helper SECURITY DEFINER with a pinned search_path", () => {
    const body = sql();
    for (const fn of ["is_team_lead", "is_rep", "supervises"]) {
      const start = body.indexOf(`create or replace function public.${fn}(`);
      expect(start, `${fn} is not created`).toBeGreaterThan(-1);
      const decl = body.slice(start, start + 400);
      expect(decl, fn).toContain("security definer");
      expect(decl, fn).toContain("set search_path = ''");
    }
  });

  /**
   * They are called BY POLICIES INSIDE a session, unlike 0040's
   * materialise_daily_alerts() which is called by cron and must be unreachable.
   * Getting this backwards makes every policy false for every signed-in user.
   */
  it("grants the helpers to authenticated, unlike the cron function", () => {
    const body = sql();
    for (const fn of ["is_team_lead()", "is_rep()", "supervises(uuid)"]) {
      expect(body).toContain(`grant execute on function public.${fn} to authenticated;`);
      expect(body).toContain(`revoke all on function public.${fn} from anon;`);
    }
  });

  /** FO021's third branch — a team lead with no campus is the hole 0041 closes. */
  it("teaches FO021 that a team lead has a campus", () => {
    const body = sql();
    const start = body.indexOf("create or replace function public.enforce_profile_campus");
    const fn = body.slice(start, body.indexOf("$$;", start));
    expect(fn).toContain("'rep', 'team_lead'");
    // The admin branch must survive: a campus on an admin is still refused.
    expect(fn).toContain("new.role = 'admin' and new.campus_id is not null");
  });

  /**
   * ⚠ FO033 CLAUSE (e) IS THE SELF-ASSIGNMENT GUARD, and it exists because
   * profiles_update is `id = auth.uid() or is_admin()` — a rep may write their
   * own row. Without it a rep joins any team they like with one PostgREST call.
   */
  it("guards the link against the rep who owns the row", () => {
    const body = sql();
    const start = body.indexOf("create or replace function public.enforce_team_lead_link");
    const fn = body.slice(start, body.indexOf("$$;", start));
    expect(fn).toContain("FO033");
    expect(fn).toContain("public.is_admin()");
    expect(fn).toContain("public.is_team_lead()");
    // Only a rep has a lead; the lead must be a team_lead on the same campus.
    expect(fn).toContain("new.role <> 'rep'");
    expect(fn).toContain("v_lead_role <> 'team_lead'");
    expect(fn).toContain("v_lead_campus is distinct from new.campus_id");
  });

  /**
   * ⚠ THE AUTHORISATION CHECK MUST PRECEDE THE NULL SHORT-CIRCUIT, and this
   * pins an ordering the integration suite caught the first time round.
   *
   * With the check after it, `set team_lead_id = null` returned early and never
   * reached clause (e) — so a rep could not JOIN a team but could LEAVE one,
   * which after 0042 is a rep quietly removing themselves from supervision. The
   * two statements are ten lines apart in one function and nothing about either
   * looks wrong on its own.
   */
  it("checks who may write the link BEFORE the null short-circuit", () => {
    const body = code();
    const fn = body.slice(body.indexOf("create or replace function public.enforce_team_lead_link"));
    const authorise = fn.indexOf("is_team_lead()");
    const shortCircuit = fn.indexOf("if new.team_lead_id is null then");
    expect(authorise, "clause (e) is missing").toBeGreaterThan(-1);
    expect(shortCircuit, "the short-circuit is missing").toBeGreaterThan(-1);
    expect(
      authorise,
      "clause (e) sits after the null short-circuit, so clearing a link is unguarded",
    ).toBeLessThan(shortCircuit);
  });

  /**
   * supervises() must return a real boolean. Inside a policy null and false
   * behave alike, so this would never surface there — but `not supervises(x)`
   * on a null member is null rather than true, and 0042 writes the predicate
   * thirty times.
   */
  it("never lets supervises() return null", () => {
    const body = code();
    const fn = body.slice(body.indexOf("create or replace function public.supervises"));
    expect(fn.slice(0, 700)).toContain("coalesce");
  });

  /**
   * The trigger that runs guard_profile_role() is 0001's `profiles_guard_role`.
   * A different name here would leave 0001's attached and add a SECOND trigger
   * firing the same function on every row — which is what this nearly shipped
   * as.
   */
  it("re-attaches 0001's role trigger under its real name and signature", () => {
    const body = sql();
    expect(body).toContain("drop trigger if exists profiles_guard_role on public.profiles;");
    expect(body).toContain("create trigger profiles_guard_role\n  before insert or update on public.profiles");
    expect(body).not.toContain("profiles_role_guard");
  });

  /* ---- H3 ---------------------------------------------------------- */

  /**
   * ⚠ `requireAdmin` MUST NOT HAVE BEEN LOOSENED IN PLACE. It still gates the
   * shared vocabulary, /data, /materials/manage and every Settings mutation —
   * none of which has a team dimension, so a team lead writing them would write
   * across every other team. Widening it by rename would have moved all of
   * those at once and invisibly; a separate `requireStaff` makes each call site
   * a readable diff.
   */
  it("keeps requireAdmin strict and adds requireStaff beside it", () => {
    const admin = read("src/lib/admin.ts");
    expect(admin).toContain("export async function requireStaff");
    // requireAdmin's own body still demands exactly "admin".
    const fn = admin.slice(admin.indexOf("export async function requireAdmin"));
    expect(fn.slice(0, 600)).toContain('user.role !== "admin"');
  });

  /** The supervision screens must be reachable by a team lead. */
  it("puts every supervision page on requireStaff", () => {
    for (const path of [
      "src/app/(app)/review/page.tsx",
      "src/app/(app)/assign/page.tsx",
      "src/app/(app)/team/page.tsx",
      "src/app/(app)/team/report/page.tsx",
      "src/app/(app)/team/hierarchy/page.tsx",
      "src/app/(app)/institutes/report/page.tsx",
    ]) {
      expect(tsCode(path), path).toContain("requireStaff");
      expect(tsCode(path), path).not.toContain("requireAdmin");
    }
  });

  /** And the three un-scopable ones must NOT have moved. */
  it("leaves the global surfaces on requireAdmin", () => {
    for (const path of [
      "src/app/(app)/data/page.tsx",
      "src/app/(app)/materials/manage/page.tsx",
    ]) {
      expect(tsCode(path), path).toContain("requireAdmin");
      expect(tsCode(path), path).not.toContain("requireStaff");
    }
  });

  /**
   * ⚠ E1's RECORD NOW READS THE REAL BOUNDARY. It filtered on `created_by` as a
   * deliberate SOFT filter, because 0034 backfills nothing and making that
   * column a boundary would have hidden every pre-0034 rep from every admin.
   * `team_lead_id` is the actual boundary, so filter and permission agree.
   */
  it("re-points the missed record off created_by", () => {
    const page = read("src/app/(app)/missed/page.tsx");
    expect(page).toContain('.not("team_lead_id", "is", null)');
    expect(page).not.toContain('.eq("created_by", user.id)');
  });

  /**
   * The assignment goes through the RPC, never a direct update: profiles_update
   * is still `id = auth.uid() or is_admin()`, so a team lead writing the row
   * matches NO ROWS and PostgREST reports success — a control that silently did
   * nothing for the one role it exists for.
   */
  it("assigns through assign_rep_to_team, not a profiles update", () => {
    const actions = read("src/lib/admin-actions.ts");
    const fn = actions.slice(actions.indexOf("export async function assignRepToTeam"));
    // The next top-level export ends this function's body. Built rather than
    // written as a literal, so the newline cannot be mangled by an editor.
    const body = fn.slice(0, fn.indexOf(`${"\n"}export `, 1));
    expect(body).toContain('rpc("assign_rep_to_team"');
    expect(body).toContain("requireStaff");
    expect(body).not.toContain('from("profiles")');
  });

  /**
   * ⚠ NEVER AN EMBED for the second self-relation on profiles. The first one —
   * `profiles!profiles_created_by_fkey` — answered PGRST200 and blanked every
   * admin screen, because PostgREST disambiguates a self-join by the
   * REFERENCING COLUMN. team_lead_id walks into the identical trap.
   */
  it("resolves the team lead's name in TypeScript", () => {
    const admin = tsCode("src/lib/admin.ts");
    expect(admin).toContain("teamLeadName:");
    expect(admin).not.toMatch(/profiles!team_lead_id/);
    expect(admin).not.toMatch(/profiles_team_lead_id_fkey\(/);
  });

  /** 0043 closes the campus trap the plan flagged as open. */
  it("refuses to move a team lead who still has reps", () => {
    const sql = read("supabase/migrations/0043_team_assignment.sql");
    expect(sql).toContain("team_lead_id = p_member");
    expect(sql).toContain("Move or reassign the team first");
    // And the return key the app reads is untouched.
    expect(sql).toContain("institutes_moved");
  });

  /** The vocabulary must agree with auth.ts and with validation/admin.ts. */
  it("lists the same three roles the app does", () => {
    expect(sql()).toContain("role in ('rep', 'team_lead', 'admin')");
    const auth = read("src/lib/auth.ts");
    expect(auth).toContain('z.enum(["rep", "team_lead", "admin"])');
    expect(auth).toContain('export type Role = "rep" | "team_lead" | "admin";');
  });
});
