import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tallyVisitMetrics } from "@/lib/validation/weekly";

/**
 * The rules that live in Postgres.
 *
 * Everything here is enforced by a trigger, a CHECK constraint or an RLS
 * policy — never by the TypeScript above it — so nothing but a real database
 * can tell you whether it still works. These four are the ones the product
 * leans on: a meeting that was never planned, a locked week, one rep reading
 * another's work, and where the weekly numbers are counted from.
 *
 * Needs a Supabase project (see tests/README.md). Skips itself without one, so
 * a pipeline with no secrets stays green rather than lying about coverage.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anon && serviceKey);

const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

/** Every row these tests create carries this, so cleanup can find them. */
const TAG = `test:${Date.now().toString(36)}`;

const admin = configured
  ? createClient(url!, serviceKey!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient);

/**
 * Migration 0005 adds visit_people and the assignment columns. Until it has
 * been applied to whichever project these tests point at, the two suites that
 * cover it would fail for a reason that has nothing to do with the code — so
 * they say why and skip instead.
 */
// A real select, not a HEAD: supabase-js leaves `error` unset on a HEAD
// request for a table that does not exist, so the probe would say yes.
/**
 * Rule 12 — every visit carries a photo, so every fixture here does too.
 * The path only has to be a non-empty string for the constraint; shaping it
 * like a real one keeps these rows readable next to production data.
 */
const photoFor = (memberId: string) => `${memberId}/${crypto.randomUUID()}.jpg`;

const has0005 = configured
  ? await admin
      .from("visit_people")
      .select("id")
      .limit(1)
      .then(({ error }) => !error)
  : false;

/**
 * Migration 0007 adds the reverse-geocoding cache. Probed the same way as 0005:
 * a project without it skips these loudly rather than failing.
 */
const has0007 = configured
  ? await admin
      .from("place_cache")
      .select("cell")
      .limit(1)
      .then(({ error }) => !error)
  : false;

/**
 * Migration 0008 adds public.app_today(), the database's half of "today". The
 * suite below is the only thing that can catch the app and the database drifting
 * apart on which day it is, so it says so rather than passing quietly.
 */
const has0008 = configured
  ? await admin.rpc("app_today").then(({ error }) => !error)
  : false;

if (configured && !has0008) {
  console.warn(
    [
      "",
      "  ! migration 0008 is not applied to this project.",
      "    The app_today suite is being SKIPPED, not passing — which means",
      "    nothing here is checking that the app and the database agree on",
      "    what day it is. Between 00:00 and 05:30 IST they will not.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

if (configured && !has0007) {
  console.warn(
    [
      "",
      "  ! migration 0007 is not applied to this project.",
      "    The place-cache suite is being SKIPPED, not passing.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

if (configured && !has0005) {
  console.warn(
    [
      "",
      "  ! migration 0005 is not applied to this project.",
      "    The closing-report and assignment suites are being SKIPPED, not passing.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

/**
 * The fixtures' idea of a day, which has to be the app's and the database's:
 * the Indian calendar day. Built the same way as todayISO() in src/lib/dates.ts
 * rather than imported, so a fixture cannot be dragged along by a change to the
 * thing under test.
 *
 * Using UTC here would have been invisible for nineteen hours a day and then
 * quietly wrong for five: between 18:30 and 24:00 UTC it names yesterday, so
 * every gate fixture would have been testing the wrong date.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const iso = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000 + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);

const mondayOf = (date: string) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000)
    .toISOString()
    .slice(0, 10);
};

interface Member {
  id: string;
  email: string;
  db: SupabaseClient;
}

/** A throwaway account, with a session client that RLS applies to. */
async function makeMember(role: "rep" | "admin", label: string): Promise<Member> {
  const email = `${TAG}.${label}@example.com`.replace(/:/g, ".");
  const password = `${TAG}-passphrase`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, name: `${TAG} ${label}`, role });
  if (profileError) throw new Error(`profile: ${profileError.message}`);

  const session = createClient(url!, anon!, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } =
    await session.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) {
    throw new Error(`signIn: ${signInError?.message}`);
  }

  return {
    id: data.user.id,
    email,
    db: createClient(url!, anon!, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${signIn.session.access_token}` },
      },
    }),
  };
}

describe.skipIf(!configured)("the rules enforced in Postgres", () => {
  let repA: Member;
  let repB: Member;
  let boss: Member;
  let instituteId: string;

  /**
   * Whether migration 0006 (Rule 12, the mandatory photo) is applied here.
   * Probed rather than assumed: a project without it skips those two tests
   * visibly instead of failing in a way that reads like a broken rule.
   */
  let has0006 = false;

  beforeAll(async () => {
    [repA, repB, boss] = await Promise.all([
      makeMember("rep", "rep-a"),
      makeMember("rep", "rep-b"),
      makeMember("admin", "admin"),
    ]);

    const { data, error } = await admin
      .from("institutes")
      .insert({
        name: `${TAG} School`,
        type: "school",
        city: "Bengaluru",
        state: "Karnataka",
        registered_by: repA.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(`institute: ${error.message}`);
    instituteId = data.id;

    // Probe 0006 by doing the thing it forbids. If it is not applied the row
    // is written, so it is removed again immediately.
    const probe = await admin
      .from("visits")
      .insert({ institute_id: instituteId, member: repA.id, activity: "olympiad", date: iso() })
      .select("id")
      .maybeSingle();
    has0006 = Boolean(probe.error);
    if (probe.data?.id) await admin.from("visits").delete().eq("id", probe.data.id);
    if (!has0006) {
      console.warn(
        [
          "",
          "  ! migration 0006 is not applied to this project.",
          "    The mandatory-photo tests are being SKIPPED, not passing.",
          "",
        ].join(String.fromCharCode(10)),
      );
    }
  });

  afterAll(async () => {
    if (!configured) return;
    const members = [repA, repB, boss].filter(Boolean);

    // By tag, not by the one id held in scope: a test may add institutes of its
    // own, and a leftover row would quietly accumulate on every run.
    const { data: institutes } = await admin
      .from("institutes")
      .select("id")
      .like("name", `${TAG}%`);

    for (const { id } of institutes ?? []) {
      await admin.from("visits").delete().eq("institute_id", id);
      await admin.from("daily_plans").delete().eq("institute_id", id);
      await admin.from("institutes").delete().eq("id", id);
    }
    for (const member of members) {
      const { data: files } = await admin.storage.from("visit-photos").list(member.id);
      if (files?.length) {
        await admin.storage
          .from("visit-photos")
          .remove(files.map((f) => `${member.id}/${f.name}`));
      }
      await admin.from("weekly_targets").delete().eq("member", member.id);
      await admin.from("visits").delete().eq("member", member.id);
      await admin.from("daily_plans").delete().eq("member", member.id);
      await admin.from("profiles").delete().eq("id", member.id);
      await admin.auth.admin.deleteUser(member.id);
    }
  });

  /* ---------------------------------------------------------------- */

  describe("Rule 2 — the meeting gate", () => {
    it("refuses a meeting for an institute that is not on that day's plan", async () => {
      const { error } = await repA.db.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        photo_url: photoFor(repA.id),
        activity: "meeting",
        date: iso(),
      });

      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(error?.message).toMatch(/plan/i);
    });

    it("refuses it even for the service role, which bypasses RLS entirely", async () => {
      // Proves the gate is a trigger and not a policy: no key gets past it.
      const { error } = await admin.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        photo_url: photoFor(repA.id),
        activity: "meeting",
        date: iso(),
      });

      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("accepts a meeting once the institute is on today's plan", async () => {
      const { error: planError } = await repA.db.from("daily_plans").insert({
        member: repA.id,
        date: iso(),
        institute_id: instituteId,
        purpose: "Other",
      });
      expect(planError).toBeNull();

      const { error } = await repA.db.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        photo_url: photoFor(repA.id),
        activity: "meeting",
        date: iso(),
      });
      expect(error).toBeNull();
    });

    it("keys the gate on the day, not just the institute", async () => {
      // The plan above is for today; a meeting dated tomorrow is still ungated.
      const { error } = await repA.db.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        photo_url: photoFor(repA.id),
        activity: "meeting",
        date: iso(1),
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0008)("app_today — one day, agreed by both halves", () => {
    /*
     * The app writes daily_plans.date with todayISO(); log_visit dates the
     * visit and finds that plan row with public.app_today(). Nothing else
     * checks that those two name the same day, and when they did not, the
     * symptom was a rep being told the school in front of them was not on
     * today's plan — every night between midnight and 05:30.
     *
     * The unit tests prove the app half is the Indian day at every minute of
     * that window. This proves the database half is the same day, in the
     * database, right now. Run these at 01:00 IST and they are the real thing
     * rather than a model of it.
     */

    it("names the Indian calendar day, not the server's", async () => {
      const { data, error } = await admin.rpc("app_today");
      expect(error).toBeNull();
      expect(data).toBe(iso());
    });

    it("is what the app would have said for the same moment", async () => {
      // iso() is built from India's fixed +05:30 offset; app_today() is
      // (now() at time zone 'Asia/Kolkata')::date. Two routes, one answer.
      const { data } = await admin.rpc("app_today");
      const serverUtcDay = new Date().toISOString().slice(0, 10);
      expect(data).toBe(iso());
      // And say so out loud when the two calendars differ, which is the only
      // time this test could ever have caught anything.
      if (data !== serverUtcDay) {
        expect(data).not.toBe(serverUtcDay);
      }
    });

    it("dates a plan row it was not given a date for", async () => {
      const { data, error } = await admin
        .from("daily_plans")
        .insert({
          member: repA.id,
          institute_id: instituteId,
          purpose: `${TAG} default-date`,
        })
        .select("id, date")
        .single();

      expect(error).toBeNull();
      expect(data?.date).toBe(iso());
      if (data?.id) await admin.from("daily_plans").delete().eq("id", data.id);
    });

    it("dates a visit it was not given a date for", async () => {
      const { data, error } = await admin
        .from("visits")
        .insert({
          institute_id: instituteId,
          member: repA.id,
          activity: "olympiad",
          photo_url: photoFor(repA.id),
        })
        .select("id, date")
        .single();

      expect(error).toBeNull();
      expect(data?.date).toBe(iso());
      if (data?.id) await admin.from("visits").delete().eq("id", data.id);
    });

    it("lets a meeting through on a plan the app dated, whatever the hour", async () => {
      // The end-to-end claim, and the one that broke: the app dates the plan,
      // log_visit dates the visit and looks the plan up, and the two have to
      // land on the same day for this to pass. Between 00:00 and 05:30 IST it
      // failed before migration 0008.
      const institute = await admin
        .from("institutes")
        .insert({ name: `${TAG} app_today school`, type: "school" })
        .select("id")
        .single();
      const houseId = institute.data!.id as string;

      const plan = await repA.db
        .from("daily_plans")
        .insert({
          member: repA.id,
          date: iso(), // what the app writes
          institute_id: houseId,
          purpose: `${TAG} same-day`,
        })
        .select("id")
        .single();
      expect(plan.error).toBeNull();

      const { data: visitId, error } = await repA.db.rpc("log_visit", {
        p_institute_id: houseId,
        p_activity: "meeting",
        p_photo_url: photoFor(repA.id),
        p_daily_plan_id: plan.data!.id,
      });

      expect(error).toBeNull();
      expect(visitId).toBeTruthy();

      const { data: visit } = await admin
        .from("visits")
        .select("date")
        .eq("id", visitId as string)
        .single();
      // The visit landed on the same day the plan was written for.
      expect(visit?.date).toBe(iso());

      const { data: held } = await admin
        .from("daily_plans")
        .select("meetings_actual")
        .eq("id", plan.data!.id)
        .single();
      expect(held?.meetings_actual).toBe(1);

      await admin.from("visits").delete().eq("id", visitId as string);
      await admin.from("daily_plans").delete().eq("id", plan.data!.id);
      await admin.from("institutes").delete().eq("id", houseId);
    });

    it("still refuses one planned for the day before", async () => {
      // The gate did not get looser, only consistent.
      const institute = await admin
        .from("institutes")
        .insert({ name: `${TAG} yesterday school`, type: "school" })
        .select("id")
        .single();
      const houseId = institute.data!.id as string;

      const plan = await admin
        .from("daily_plans")
        .insert({
          member: repA.id,
          date: iso(-1),
          institute_id: houseId,
          purpose: `${TAG} yesterday`,
        })
        .select("id")
        .single();

      const { error } = await repA.db.rpc("log_visit", {
        p_institute_id: houseId,
        p_activity: "meeting",
        p_photo_url: photoFor(repA.id),
        p_daily_plan_id: plan.data!.id,
      });
      expect(error?.code).toBe("FO001");

      await admin.from("daily_plans").delete().eq("id", plan.data!.id);
      await admin.from("institutes").delete().eq("id", houseId);
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0007)("place_cache — the reverse-geocoding cache", () => {
    const cell = "23.0225,72.5714";

    afterAll(async () => {
      if (has0007) await admin.from("place_cache").delete().eq("cell", cell);
    });

    it("lets any signed-in rep read it — it is shared, not personal", async () => {
      await admin.from("place_cache").upsert({ cell, label: `${TAG} Bopal, Ahmedabad` });
      const { data, error } = await repA.db.from("place_cache").select("label").eq("cell", cell);
      expect(error).toBeNull();
      expect(data?.[0]?.label).toContain("Bopal");
    });

    it("refuses a write from a rep, so one cannot poison what the team sees", async () => {
      const { error } = await repA.db
        .from("place_cache")
        .upsert({ cell: "1.0000,1.0000", label: `${TAG} forged` })
        .select();
      // Either refused outright, or filtered to nothing by the policy.
      const { data: after } = await admin
        .from("place_cache")
        .select("cell")
        .eq("cell", "1.0000,1.0000");
      expect(error !== null || (after ?? []).length === 0).toBe(true);
    });

    it("accepts the shape cellFor produces, and rejects anything else", async () => {
      const good = await admin
        .from("place_cache")
        .upsert({ cell: "-33.8688,-151.2093", label: `${TAG} Sydney` })
        .select();
      expect(good.error).toBeNull();
      await admin.from("place_cache").delete().eq("cell", "-33.8688,-151.2093");

      const bad = await admin.from("place_cache").upsert({ cell: "not-a-cell" }).select();
      expect(bad.error?.code).toBe(CHECK_VIOLATION);
    });

    it("remembers a lookup that found nothing, so we stop asking", async () => {
      const empty = "0.0000,0.0000";
      const { error } = await admin.from("place_cache").upsert({ cell: empty, label: null }).select();
      expect(error).toBeNull();
      const { data } = await admin.from("place_cache").select("label").eq("cell", empty).single();
      expect(data?.label).toBeNull();
      await admin.from("place_cache").delete().eq("cell", empty);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("Rule 12 — the visit photo is mandatory", () => {
    it("refuses a direct insert with no photo, bypassing the form entirely", async (ctx) => {
      if (!has0006) ctx.skip();
      const { error } = await repA.db.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        activity: "olympiad",
        date: iso(),
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(error?.message).toMatch(/visits_photo_required/i);
    });

    it("refuses it for the service role too, so no key gets past it", async (ctx) => {
      if (!has0006) ctx.skip();
      const { error } = await admin.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        activity: "olympiad",
        date: iso(),
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses an empty string, which is not a photograph either", async (ctx) => {
      if (!has0006) ctx.skip();
      const { error } = await repA.db.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        activity: "olympiad",
        date: iso(),
        photo_url: "   ",
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("raises FO007 from log_visit(), the code the app turns into a sentence", async (ctx) => {
      if (!has0006) ctx.skip();
      const { error } = await repA.db.rpc("log_visit", {
        p_institute_id: instituteId,
        p_activity: "olympiad",
      });
      expect(error?.code).toBe("FO007");
    });

    it("refuses to change the photo on a visit that already has one", async (ctx) => {
      if (!has0006) ctx.skip();
      const made = await repA.db
        .from("visits")
        .insert({
          institute_id: instituteId,
          member: repA.id,
          activity: "olympiad",
          date: iso(),
          photo_url: photoFor(repA.id),
        })
        .select("id")
        .single();
      if (made.error) throw new Error(`visit: ${made.error.message}`);

      const swap = await repA.db
        .from("visits")
        .update({ photo_url: photoFor(repA.id) })
        .eq("id", made.data.id)
        .select("id");
      expect(swap.error?.code).toBe("FO008");

      // ...and not even for the service role, which gets past every policy.
      const asAdmin = await admin
        .from("visits")
        .update({ photo_url: photoFor(repA.id) })
        .eq("id", made.data.id)
        .select("id");
      expect(asAdmin.error?.code).toBe("FO008");

      // An update that leaves the photo alone still works — this is the path
      // the closing report takes, and breaking it would break completing a
      // visit at all.
      const elsewhere = await repA.db
        .from("visits")
        .update({ notes: `${TAG} edited elsewhere` })
        .eq("id", made.data.id)
        .select("id");
      expect(elsewhere.error).toBeNull();

      await admin.from("visits").delete().eq("id", made.data.id);
    });

    it("refuses to blank the photo out", async (ctx) => {
      if (!has0006) ctx.skip();
      const made = await repA.db
        .from("visits")
        .insert({
          institute_id: instituteId,
          member: repA.id,
          activity: "olympiad",
          date: iso(),
          photo_url: photoFor(repA.id),
        })
        .select("id")
        .single();
      if (made.error) throw new Error(`visit: ${made.error.message}`);

      const cleared = await repA.db
        .from("visits")
        .update({ photo_url: null })
        .eq("id", made.data.id)
        .select("id");
      expect(cleared.error?.code).toBe("FO008");

      await admin.from("visits").delete().eq("id", made.data.id);
    });

    it("accepts the same visit once it carries a photo", async (ctx) => {
      if (!has0006) ctx.skip();
      const { data, error } = await repA.db
        .from("visits")
        .insert({
          institute_id: instituteId,
          member: repA.id,
          activity: "olympiad",
          date: iso(),
          photo_url: photoFor(repA.id),
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      if (data?.id) await admin.from("visits").delete().eq("id", data.id);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("Rule 6 — the weekly lock", () => {
    const week = mondayOf(iso());

    beforeAll(async () => {
      const { error } = await repA.db.from("weekly_targets").insert({
        member: repA.id,
        week_start: week,
        meetings: 5,
        locked: true,
      });
      expect(error).toBeNull();
    });

    it("stamps the submission time itself", async () => {
      const { data } = await admin
        .from("weekly_targets")
        .select("locked, submitted_at")
        .eq("member", repA.id)
        .eq("week_start", week)
        .single();

      expect(data?.locked).toBe(true);
      expect(data?.submitted_at).not.toBeNull();
    });

    it("refuses an edit once the week is locked", async () => {
      const { error } = await repA.db
        .from("weekly_targets")
        .update({ meetings: 99 })
        .eq("member", repA.id)
        .eq("week_start", week);

      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses to let the rep unlock their own week", async () => {
      const { error } = await repA.db
        .from("weekly_targets")
        .update({ locked: false })
        .eq("member", repA.id)
        .eq("week_start", week);

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("lets an admin reopen it, and records who and when", async () => {
      const { error } = await boss.db
        .from("weekly_targets")
        .update({ locked: false })
        .eq("member", repA.id)
        .eq("week_start", week);
      expect(error).toBeNull();

      const { data } = await admin
        .from("weekly_targets")
        .select("locked, reopened_by, reopened_at, meetings")
        .eq("member", repA.id)
        .eq("week_start", week)
        .single();

      expect(data?.locked).toBe(false);
      // Stamped from the session by the trigger, not sent by the client.
      expect(data?.reopened_by).toBe(boss.id);
      expect(data?.reopened_at).not.toBeNull();
      // Reopening revises nothing; the rep still has what they committed to.
      expect(data?.meetings).toBe(5);
    });

    it("lets the rep edit again once it is reopened", async () => {
      const { error } = await repA.db
        .from("weekly_targets")
        .update({ meetings: 7 })
        .eq("member", repA.id)
        .eq("week_start", week);

      expect(error).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- */

  describe("RLS — one rep cannot reach another's work", () => {
    it("hides rep A's visits from rep B", async () => {
      const { data, error } = await repB.db
        .from("visits")
        .select("id")
        .eq("member", repA.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("hides rep A's daily plan from rep B", async () => {
      const { data } = await repB.db
        .from("daily_plans")
        .select("id")
        .eq("member", repA.id);

      expect(data).toHaveLength(0);
    });

    it("hides rep A's weekly targets from rep B", async () => {
      const { data } = await repB.db
        .from("weekly_targets")
        .select("id")
        .eq("member", repA.id);

      expect(data).toHaveLength(0);
    });

    it("stops rep B writing a visit in rep A's name", async () => {
      const { error } = await repB.db.from("visits").insert({
        institute_id: instituteId,
        member: repA.id,
        photo_url: photoFor(repA.id),
        activity: "olympiad",
        date: iso(),
      });

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("stops rep B editing rep A's rows", async () => {
      const { data } = await repB.db
        .from("visits")
        .update({ notes: "tampered" })
        .eq("member", repA.id)
        .select("id");

      // Nothing is visible to update, so nothing changes.
      expect(data ?? []).toHaveLength(0);
    });

    it("stops a rep promoting themselves to admin", async () => {
      const { error } = await repB.db
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", repB.id);

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      const { data } = await admin
        .from("profiles")
        .select("role")
        .eq("id", repB.id)
        .single();
      expect(data?.role).toBe("rep");
    });

    it("lets an admin see the team's work", async () => {
      const { data } = await boss.db
        .from("visits")
        .select("id")
        .eq("member", repA.id);

      expect((data ?? []).length).toBeGreaterThan(0);
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0005)("visit_people — the report's people follow their visit", () => {
    let visitId: string;

    beforeAll(async () => {
      const { data, error } = await admin
        .from("visits")
        .insert({
          institute_id: instituteId,
          member: repA.id,
          photo_url: photoFor(repA.id),
          activity: "olympiad",
          date: iso(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`visit: ${error.message}`);
      visitId = data.id;

      const { error: peopleError } = await repA.db.from("visit_people").insert({
        visit_id: visitId,
        name: `${TAG} principal`,
        contact_type: "Principal",
        is_decision_maker: true,
      });
      expect(peopleError).toBeNull();
    });

    it("lets the owner read their own", async () => {
      const { data } = await repA.db
        .from("visit_people")
        .select("id")
        .eq("visit_id", visitId);
      expect(data).toHaveLength(1);
    });

    it("hides them from another rep", async () => {
      const { data } = await repB.db
        .from("visit_people")
        .select("id")
        .eq("visit_id", visitId);
      expect(data).toHaveLength(0);
    });

    it("shows them to an admin", async () => {
      const { data } = await boss.db
        .from("visit_people")
        .select("id")
        .eq("visit_id", visitId);
      expect(data).toHaveLength(1);
    });

    it("stops another rep adding a person to someone else's visit", async () => {
      const { error } = await repB.db.from("visit_people").insert({
        visit_id: visitId,
        name: `${TAG} intruder`,
        contact_type: "Other",
      });
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("stops an admin rewriting someone's account of who they met", async () => {
      // An admin reads a report. They do not edit it — the account belongs to
      // the person who was in the room.
      const { data } = await boss.db
        .from("visit_people")
        .update({ name: `${TAG} edited` })
        .eq("visit_id", visitId)
        .select("id");
      expect(data ?? []).toHaveLength(0);
    });

    it("cascades when the visit goes", async () => {
      await admin.from("visits").delete().eq("id", visitId);
      const { count } = await admin
        .from("visit_people")
        .select("id", { count: "exact", head: true })
        .eq("visit_id", visitId);
      expect(count).toBe(0);
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0005)("admin-assigned visits", () => {
    it("lets an admin put a visit on a rep's plan", async () => {
      const { error } = await boss.db.from("daily_plans").insert({
        member: repB.id,
        date: iso(2),
        institute_id: instituteId,
        purpose: "Other",
        assigned_by: boss.id,
      });
      expect(error).toBeNull();

      const { data } = await admin
        .from("daily_plans")
        .select("assigned_by, assigned_at")
        .eq("member", repB.id)
        .eq("date", iso(2))
        .single();
      expect(data?.assigned_by).toBe(boss.id);
      // Stamped by the trigger, not sent by the client.
      expect(data?.assigned_at).not.toBeNull();
    });

    it("stops a rep putting a visit on someone else's plan", async () => {
      const { error } = await repA.db.from("daily_plans").insert({
        member: repB.id,
        date: iso(3),
        institute_id: instituteId,
        purpose: "Other",
      });
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("stops a rep signing their own entry as someone else's assignment", async () => {
      const { error } = await repA.db.from("daily_plans").insert({
        member: repA.id,
        date: iso(4),
        institute_id: instituteId,
        purpose: "Other",
        assigned_by: boss.id,
      });
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("lets the assigned rep mark it held without losing who assigned it", async () => {
      // The update a rep makes when they log the meeting. It must not read as
      // an attempt to change the assignment.
      const { error } = await repB.db
        .from("daily_plans")
        .update({ meetings_actual: 1 })
        .eq("member", repB.id)
        .eq("date", iso(2));
      expect(error).toBeNull();

      const { data } = await admin
        .from("daily_plans")
        .select("meetings_actual, assigned_by")
        .eq("member", repB.id)
        .eq("date", iso(2))
        .single();
      expect(data?.meetings_actual).toBe(1);
      expect(data?.assigned_by).toBe(boss.id);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("Storage — who can see a proof photo", () => {
    // A real, tiny JPEG: the point is that it is an object in the bucket.
    const JPEG = Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
        "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAFAABAAAAAAAA" +
        "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
      "base64",
    );

    let livePath: string;
    let purgedPath: string;

    beforeAll(async () => {
      livePath = `${repA.id}/${crypto.randomUUID()}.jpg`;
      purgedPath = `${repA.id}/${crypto.randomUUID()}.jpg`;

      for (const path of [livePath, purgedPath]) {
        const { error } = await admin.storage
          .from("visit-photos")
          .upload(path, JPEG, { contentType: "image/jpeg" });
        expect(error).toBeNull();
      }
      // Exactly what the nightly purge leaves behind: the row will keep its
      // photo_url, the file is gone.
      await admin.storage.from("visit-photos").remove([purgedPath]);
    });

    it("lets the owner sign their own photo", async () => {
      const { data, error } = await repA.db.storage
        .from("visit-photos")
        .createSignedUrl(livePath, 60);

      expect(error).toBeNull();
      expect(data?.signedUrl).toContain("/object/sign/");
    });

    it("lets an admin sign anyone's photo", async () => {
      const { error } = await boss.db.storage
        .from("visit-photos")
        .createSignedUrl(livePath, 60);

      expect(error).toBeNull();
    });

    it("refuses another rep, without admitting the file exists", async () => {
      const { data, error } = await repB.db.storage
        .from("visit-photos")
        .createSignedUrl(livePath, 60);

      expect(data?.signedUrl).toBeUndefined();
      expect(error).not.toBeNull();
      // "Object not found" rather than "forbidden": the policy hides it.
      expect(error?.message).toMatch(/not found/i);
    });

    it("reports a purged photo as missing, which the app reads as expired", async () => {
      // The case the whole photo-display path is built around: the visit row
      // keeps its photo_url forever, so this is the normal end state.
      const { data } = await boss.db.storage
        .from("visit-photos")
        .createSignedUrls([livePath, purgedPath], 60);

      const live = data?.find((entry) => entry.path === livePath);
      const purged = data?.find((entry) => entry.path === purgedPath);

      expect(live?.error).toBeNull();
      expect(live?.signedUrl).toContain("token=");
      expect(purged?.error).toBeTruthy();
    });
  });
  /* ---------------------------------------------------------------- */

  describe("Rule 7 — where the weekly numbers come from", () => {
    const week = mondayOf(iso());
    const weekEndInclusive = () => {
      const monday = new Date(`${week}T00:00:00.000Z`);
      return new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    };

    beforeAll(async () => {
      // A second plan entry, marked held, with NO visit row behind it. If the
      // Meetings figure were read from the visits log it would miss this one.
      const { data: other } = await admin
        .from("institutes")
        .insert({
          name: `${TAG} Second School`,
          type: "coaching",
          city: "Bengaluru",
          state: "Karnataka",
          registered_by: repA.id,
        })
        .select("id")
        .single();

      await admin.from("daily_plans").insert({
        member: repA.id,
        date: iso(),
        institute_id: other!.id,
        purpose: "Other",
        meetings_actual: 1,
      });

      // And mark the first plan entry held, the way logging a meeting does.
      await admin
        .from("daily_plans")
        .update({ meetings_actual: 1 })
        .eq("member", repA.id)
        .eq("institute_id", instituteId);

      await admin.from("visits").insert([
        { institute_id: instituteId, member: repA.id, photo_url: photoFor(repA.id), activity: "session", lifecycle_status: "Set", date: iso(), expected_date: iso(7) },
        { institute_id: instituteId, member: repA.id, photo_url: photoFor(repA.id), activity: "session", lifecycle_status: "Done", date: iso() },
        { institute_id: instituteId, member: repA.id, photo_url: photoFor(repA.id), activity: "olympiad", date: iso() },
        // Dated well outside the week: must not be counted.
        { institute_id: instituteId, member: repA.id, photo_url: photoFor(repA.id), activity: "olympiad", date: iso(-40) },
      ]);
    });

    it("counts Meetings from the daily plan, not from the visits log", async () => {
      const { count: held } = await admin
        .from("daily_plans")
        .select("id", { count: "exact", head: true })
        .eq("member", repA.id)
        .eq("meetings_actual", 1)
        .gte("date", week)
        .lte("date", weekEndInclusive());

      const { count: meetingVisits } = await admin
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("member", repA.id)
        .eq("activity", "meeting");

      // The two numbers differ on purpose: one plan entry was held without a
      // visit ever being logged against it.
      expect(held).toBe(2);
      expect(meetingVisits).toBe(1);
    });

    it("counts everything else from the visits log, inside the week only", async () => {
      const { data } = await admin
        .from("visits")
        .select("activity, lifecycle_status")
        .eq("member", repA.id)
        .gte("date", week)
        .lte("date", weekEndInclusive());

      const tallied = tallyVisitMetrics(data ?? []);

      expect(tallied.sessions_set).toBe(1);
      expect(tallied.sessions_done).toBe(1);
      expect(tallied.olympiad).toBe(1); // the 40-day-old one is out of the week
      expect(tallied.meetings).toBe(0); // never sourced from visits
    });
  });
});
