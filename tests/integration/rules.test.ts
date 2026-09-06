import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tallyVisitMetrics } from "@/lib/validation/weekly";
import {
  INSTITUTE_STATUSES,
  isOpenStatus,
  statusCategory,
} from "@/lib/validation/institute";
import { followUpHidden, followUpRequired } from "@/lib/validation/visit";
import { visitMinutes, visitStatusOf } from "@/lib/validation/checkin";

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

/**
 * One institute's status journey, oldest first. Shared by the feature C suite
 * that checks the recording and the feature D suite that checks planning does
 * NOT record — both are asking the same table the same question.
 */
const historyFor = async (instituteId: string) => {
  const { data } = await admin
    .from("institute_status_history")
    .select("status, changed_by, changed_at, visit_id")
    .eq("institute_id", instituteId)
    .order("changed_at", { ascending: true });
  return data ?? [];
};

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

/**
 * Migration 0012 adds the materials library and its private bucket. The table
 * without the storage policies, or the policies without the bucket limits,
 * would each look fine until someone uploaded something they should not.
 */
/**
 * Migration 0014 adds check-in / check-out. It is deliberately NOT applied yet
 * — the feature is built and held until there is hosting room — so this suite
 * is expected to skip on a project that is up to date with main.
 */
const has0014 = configured
  ? await admin
      .from("daily_plans")
      .select("checkin_at")
      .limit(1)
      .then(({ error }) => !error)
  : false;

if (configured && !has0014) {
  console.warn(
    [
      "",
      "  i migration 0014 is not applied. The check-in/out suite is SKIPPED,",
      "    which is expected: that feature is built but deliberately unshipped.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

/**
 * Migration 0013 generalises weekly_targets into targets, keyed by period. The
 * suite below is what would catch a period whose achieved figures are counted
 * over the wrong range — a bug that looks like nothing at all until a rep's
 * month quietly reports their week's numbers.
 */
const has0013 = configured
  ? await admin
      .from("targets")
      .select("id")
      .limit(1)
      .then(({ error }) => !error)
  : false;

if (configured && !has0013) {
  console.warn(
    [
      "",
      "  ! migration 0013 is not applied to this project.",
      "    The targets suite is being SKIPPED, not passing — nothing here is",
      "    checking daily/weekly/monthly targets or their achieved ranges.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

const has0012 = configured
  ? await admin
      .from("materials")
      .select("id")
      .limit(1)
      .then(({ error }) => !error)
  : false;

if (configured && !has0012) {
  console.warn(
    [
      "",
      "  ! migration 0012 is not applied to this project.",
      "    The materials suite is being SKIPPED, not passing — which means",
      "    nothing here is checking that only an admin can add to the library.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

/**
 * Migration 0011 adds institute_status_history and the two triggers that fill
 * it. The table existing without its trigger would record nothing and look
 * fine, so these tests are the only thing that can tell the difference.
 */
const has0011 = configured
  ? await admin
      .from("institute_status_history")
      .select("id")
      .limit(1)
      .then(({ error }) => !error)
  : false;

if (configured && !has0011) {
  console.warn(
    [
      "",
      "  ! migration 0011 is not applied to this project.",
      "    The status-history suite is being SKIPPED, not passing — which means",
      "    nothing here is checking that a status change is actually recorded.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

/**
 * Migration 0010 adds the institute_statuses lookup and the three event
 * statuses. Like 0008's suite, this one is the only thing that can catch the
 * app's catalogue and the database's table disagreeing about which statuses
 * exist and which are open — so it warns rather than passing quietly.
 */
const has0010 = configured
  ? await admin
      .from("institute_statuses")
      .select("status")
      .limit(1)
      .then(({ error }) => !error)
  : false;

if (configured && !has0010) {
  console.warn(
    [
      "",
      "  ! migration 0010 is not applied to this project.",
      "    The institute_status_category suite is being SKIPPED, not passing —",
      "    which means nothing here is checking that the app and the database",
      "    agree on the nine statuses or on which of them are open.",
      "",
    ].join(String.fromCharCode(10)),
  );
}

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
      await admin.from("targets").delete().eq("member", member.id);
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
        // 0014: the plan row is no longer enough on its own — a meeting also
        // needs the rep to have checked in. That rule has its own suite; this
        // one is still about the gate, so it checks in as setup.
        checkin_at: new Date().toISOString(),
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
      // repB, not repA: the meeting-gate suite above leaves a plan row on
      // (repA, today, instituteId) that the weekly-metrics suite below then
      // marks held and counts, so it has to stay. daily_plans is unique on
      // (member, date, institute_id), and this row defaults to today — under
      // repA that is the same key, which made this a duplicate-key failure.
      const { data, error } = await admin
        .from("daily_plans")
        .insert({
          member: repB.id,
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
          // 0014: a meeting needs a check-in as well as a plan row.
          checkin_at: new Date().toISOString(),
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
          // 0014: a meeting needs a check-in as well as a plan row.
          checkin_at: new Date().toISOString(),
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

  describe.skipIf(!has0013)("Rule 6 — the target lock", () => {
    const week = mondayOf(iso());

    beforeAll(async () => {
      const { error } = await repA.db.from("targets").insert({
        member: repA.id,
        period: "weekly",
        period_start: week,
        meetings: 5,
        locked: true,
      });
      expect(error).toBeNull();
    });

    it("stamps the submission time itself", async () => {
      const { data } = await admin
        .from("targets")
        .select("locked, submitted_at")
        .eq("member", repA.id)
        .eq("period", "weekly").eq("period_start", week)
        .single();

      expect(data?.locked).toBe(true);
      expect(data?.submitted_at).not.toBeNull();
    });

    it("refuses an edit once the week is locked", async () => {
      const { error } = await repA.db
        .from("targets")
        .update({ meetings: 99 })
        .eq("member", repA.id)
        .eq("period", "weekly").eq("period_start", week);

      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses to let the rep unlock their own week", async () => {
      const { error } = await repA.db
        .from("targets")
        .update({ locked: false })
        .eq("member", repA.id)
        .eq("period", "weekly").eq("period_start", week);

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("lets an admin reopen it, and records who and when", async () => {
      const { error } = await boss.db
        .from("targets")
        .update({ locked: false })
        .eq("member", repA.id)
        .eq("period", "weekly").eq("period_start", week);
      expect(error).toBeNull();

      const { data } = await admin
        .from("targets")
        .select("locked, reopened_by, reopened_at, meetings")
        .eq("member", repA.id)
        .eq("period", "weekly").eq("period_start", week)
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
        .from("targets")
        .update({ meetings: 7 })
        .eq("member", repA.id)
        .eq("period", "weekly").eq("period_start", week);

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

    it.skipIf(!has0013)("hides rep A's targets from rep B", async () => {
      const { data } = await repB.db
        .from("targets")
        .select("id")
        .eq("member", repA.id);

      expect(data ?? []).toHaveLength(0);
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

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0010)(
    "institute_status_category — one vocabulary, agreed by both halves",
    () => {
      /**
       * The app decides what a rep may choose (INSTITUTE_STATUS_CATALOGUE) and
       * the database decides what may be stored (institute_statuses, plus the
       * two CHECK constraints). Features C and D will ask both which statuses
       * are closed, so the two have to answer identically. Only a real
       * database can say whether they still do.
       */
      it("holds exactly the app's nine statuses, in the app's order", async () => {
        const { data, error } = await admin
          .from("institute_statuses")
          .select("status, category, sort_order")
          .order("sort_order");

        expect(error).toBeNull();
        expect(data?.map((row) => row.status)).toEqual([...INSTITUTE_STATUSES]);
      });

      it("gives every status the same category the app does", async () => {
        const { data } = await admin
          .from("institute_statuses")
          .select("status, category");

        for (const row of data ?? []) {
          expect(row.category, row.status).toBe(statusCategory(row.status));
        }
      });

      it("answers institute_status_category() the way the app does", async () => {
        for (const status of INSTITUTE_STATUSES) {
          const { data, error } = await admin.rpc("institute_status_category", {
            p_status: status,
          });
          expect(error, status).toBeNull();
          expect(data, status).toBe(statusCategory(status));
        }
      });

      it("answers institute_status_is_open() the way the app does", async () => {
        for (const status of INSTITUTE_STATUSES) {
          const { data } = await admin.rpc("institute_status_is_open", {
            p_status: status,
          });
          expect(data, status).toBe(isOpenStatus(status));
        }
      });

      it("knows nothing about a status outside the nine", async () => {
        // Null, not 'closed'. An institute whose status the database does not
        // recognise must not be mistaken for a finished loop.
        const { data: category } = await admin.rpc("institute_status_category", {
          p_status: "Principal said maybe",
        });
        expect(category).toBeNull();

        const { data: open } = await admin.rpc("institute_status_is_open", {
          p_status: "Principal said maybe",
        });
        expect(open).toBeNull();
      });

      it("stores each of the three new statuses on an institute", async () => {
        for (const status of [
          "Invited principal for event",
          "RSVP received",
          "Will not come",
        ]) {
          const { error } = await admin
            .from("institutes")
            .update({ status })
            .eq("id", instituteId);
          expect(error, status).toBeNull();
        }
      });

      it("still refuses a status outside the nine", async () => {
        const { error } = await admin
          .from("institutes")
          .update({ status: "Principal said maybe" })
          .eq("id", instituteId);

        expect(error?.code).toBe(CHECK_VIOLATION);
      });

      it("records each new status on a visit", async () => {
        for (const status of [
          "Invited principal for event",
          "RSVP received",
          "Will not come",
        ]) {
          const { error } = await admin.from("visits").insert({
            institute_id: instituteId,
            member: repA.id,
            activity: "olympiad",
            date: iso(),
            photo_url: photoFor(repA.id),
            status_set_to: status,
            // Rule 5: an invitation must carry a chase date, so this is about
            // the vocabulary only once that is satisfied.
            follow_up_date: status === "Invited principal for event" ? iso(7) : null,
          });
          expect(error, status).toBeNull();
        }
      });

      const visitWith = (status: string, followUp: string | null) => ({
        institute_id: instituteId,
        member: repA.id,
        activity: "olympiad" as const,
        date: iso(),
        photo_url: photoFor(repA.id),
        status_set_to: status,
        follow_up_date: followUp,
      });

      it("demands a follow-up date for both awaiting statuses", async () => {
        // The database's half of Rule 5. Approval has behaved this way since
        // 0001; the invitation joins it in 0010, for the same reason — nothing
        // is scheduled that would bring either back on its own.
        for (const status of [
          "Pending for management approval",
          "Invited principal for event",
        ]) {
          const { error } = await admin.from("visits").insert(visitWith(status, null));
          expect(error?.code, status).toBe(CHECK_VIOLATION);
        }
      });

      it("takes both awaiting statuses once a date is supplied", async () => {
        for (const status of [
          "Pending for management approval",
          "Invited principal for event",
        ]) {
          const { error } = await admin
            .from("visits")
            .insert(visitWith(status, iso(7)));
          expect(error, status).toBeNull();
        }
      });

      it("requires a follow-up for exactly the statuses the app does", async () => {
        // The app decides what a rep is asked for; this constraint decides what
        // may be stored. A status the app lets through but the database rejects
        // is a rep staring at a save that will not work, so the two lists are
        // compared status by status rather than trusted.
        for (const status of INSTITUTE_STATUSES) {
          if (followUpHidden(status)) continue; // covered below, on its own terms
          const { error } = await admin.from("visits").insert(visitWith(status, null));
          expect(Boolean(error), `${status} without a follow-up`).toBe(
            followUpRequired(status),
          );
        }
      });

      it("still forbids a follow-up on the two scheduled statuses", async () => {
        for (const status of ["Session scheduled", "Campus visit scheduled"]) {
          const { error } = await admin
            .from("visits")
            .insert(visitWith(status, iso(7)));
          expect(error?.code, status).toBe(CHECK_VIOLATION);
        }
      });

      it("lets a closed status carry a follow-up anyway", async () => {
        // "They said no, ask again next intake" is a real note to leave.
        const { error } = await admin
          .from("visits")
          .insert(visitWith("Will not come", iso(120)));
        expect(error).toBeNull();
      });
    },
  );

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0011)("institute_status_history — the journey is kept", () => {
    /**
     * Feature C. The point of these is that the recording happens in the
     * database, so it cannot be skipped by a caller: every test below changes a
     * status by a DIFFERENT route and then checks the same table.
     */
    let subjectId: string;

    /** A fresh institute per test, so one test's journey is not another's. */
    const makeInstitute = async (label: string) => {
      const { data, error } = await admin
        .from("institutes")
        .insert({ name: `${TAG} ${label}`, type: "school", registered_by: repA.id })
        .select("id")
        .single();
      if (error) throw new Error(`institute: ${error.message}`);
      return data.id as string;
    };

    beforeAll(async () => {
      subjectId = await makeInstitute("history subject");
    });

    it("records a change made by a direct update, and who made it", async () => {
      const id = await makeInstitute("direct update");

      const { error } = await repA.db
        .from("institutes")
        .update({ status: "First meeting done" })
        .eq("id", id);
      expect(error).toBeNull();

      const rows = await historyFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("First meeting done");
      // auth.uid() inside the trigger, not anything the client sent.
      expect(rows[0].changed_by).toBe(repA.id);
      expect(rows[0].visit_id).toBeNull();
    });

    it("still maintains 0001's audit columns alongside it", async () => {
      // Feature C sits beside institutes_touch_status rather than replacing it,
      // so the pair that already existed has to keep working.
      const id = await makeInstitute("audit columns");
      await repA.db.from("institutes").update({ status: "Session scheduled" }).eq("id", id);

      const { data: row } = await admin
        .from("institutes")
        .select("status, status_updated_at, status_updated_by")
        .eq("id", id)
        .single();

      expect(row?.status).toBe("Session scheduled");
      expect(row?.status_updated_at).toBeTruthy();
      expect(row?.status_updated_by).toBe(repA.id);

      const rows = await historyFor(id);
      expect(rows).toHaveLength(1);
    });

    it("appends rather than overwrites, so the journey grows", async () => {
      const id = await makeInstitute("journey");

      for (const status of [
        "First meeting done",
        "Invited principal for event",
        "RSVP received",
      ]) {
        const { error } = await repA.db
          .from("institutes")
          .update({ status })
          .eq("id", id);
        expect(error, status).toBeNull();
      }

      const rows = await historyFor(id);
      expect(rows.map((r) => r.status)).toEqual([
        "First meeting done",
        "Invited principal for event",
        "RSVP received",
      ]);
      // And the institute itself still holds only the latest.
      const { data: current } = await admin
        .from("institutes")
        .select("status")
        .eq("id", id)
        .single();
      expect(current?.status).toBe("RSVP received");
    });

    it("records nothing when the status is re-saved unchanged", async () => {
      const id = await makeInstitute("no-op save");
      await repA.db.from("institutes").update({ status: "Session done" }).eq("id", id);
      // Same value again, plus an unrelated edit in the same statement.
      await repA.db
        .from("institutes")
        .update({ status: "Session done", city: "Surat" })
        .eq("id", id);

      expect(await historyFor(id)).toHaveLength(1);
    });

    it("records nothing when an edit does not touch the status", async () => {
      const id = await makeInstitute("unrelated edit");
      await repA.db.from("institutes").update({ city: "Vadodara" }).eq("id", id);
      expect(await historyFor(id)).toHaveLength(0);
    });

    it("links the visit when the change came through log_visit()", async () => {
      const id = await makeInstitute("via log_visit");

      const { data: visitId, error } = await repA.db.rpc("log_visit", {
        p_institute_id: id,
        p_activity: "olympiad",
        p_photo_url: photoFor(repA.id),
        p_status_set_to: "Campus visit scheduled",
      });
      expect(error).toBeNull();
      expect(visitId).toBeTruthy();

      const rows = await historyFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("Campus visit scheduled");
      expect(rows[0].changed_by).toBe(repA.id);
      // The whole point of the transaction-local note.
      expect(rows[0].visit_id).toBe(visitId);
    });

    it("does not attribute a direct change to an unrelated earlier visit", async () => {
      const id = await makeInstitute("no mislink");

      // A visit that sets one status...
      await repA.db.rpc("log_visit", {
        p_institute_id: id,
        p_activity: "olympiad",
        p_photo_url: photoFor(repA.id),
        p_status_set_to: "First meeting done",
      });
      // ...then a different status set by hand, in its own transaction.
      await repA.db
        .from("institutes")
        .update({ status: "Session done" })
        .eq("id", id);

      const rows = await historyFor(id);
      expect(rows).toHaveLength(2);
      expect(rows[0].visit_id).toBeTruthy();
      expect(rows[1].status).toBe("Session done");
      expect(rows[1].visit_id).toBeNull();
    });

    it("keeps the history when the visit that caused it is deleted", async () => {
      const id = await makeInstitute("visit deleted");
      const { data: visitId } = await repA.db.rpc("log_visit", {
        p_institute_id: id,
        p_activity: "olympiad",
        p_photo_url: photoFor(repA.id),
        p_status_set_to: "Session done",
      });

      await admin.from("visits").delete().eq("id", visitId as string);

      const rows = await historyFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("Session done");
      expect(rows[0].visit_id).toBeNull(); // set null, not cascaded away
    });

    it("refuses a status outside the nine, via the vocabulary table", async () => {
      const { error } = await admin.from("institute_status_history").insert({
        institute_id: subjectId,
        status: "Principal said maybe",
      });
      // A foreign key to institute_statuses, not a CHECK — so 23503.
      expect(error?.code).toBe("23503");
    });

    it("is readable by any signed-in rep — it is the registry's history", async () => {
      const id = await makeInstitute("shared read");
      await repA.db.from("institutes").update({ status: "Session done" }).eq("id", id);

      // repB had nothing to do with this institute and still sees its journey,
      // unlike visits, which stay with their owner.
      const { data, error } = await repB.db
        .from("institute_status_history")
        .select("status")
        .eq("institute_id", id);

      expect(error).toBeNull();
      expect(data?.map((r) => r.status)).toEqual(["Session done"]);
    });

    it("cannot be written, rewritten or erased by a rep", async () => {
      const id = await makeInstitute("append only");
      await repA.db.from("institutes").update({ status: "Session done" }).eq("id", id);

      const inserted = await repA.db.from("institute_status_history").insert({
        institute_id: id,
        status: "RSVP received",
      });
      expect(inserted.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      // No UPDATE or DELETE policy exists, so both are no-ops rather than
      // errors under PostgREST — the row surviving is the assertion.
      await repA.db
        .from("institute_status_history")
        .update({ status: "RSVP received" })
        .eq("institute_id", id);
      await repA.db.from("institute_status_history").delete().eq("institute_id", id);

      const rows = await historyFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("Session done");
    });

    it("goes when the institute goes", async () => {
      const id = await makeInstitute("cascade");
      await repA.db.from("institutes").update({ status: "Session done" }).eq("id", id);
      expect(await historyFor(id)).toHaveLength(1);

      const { error } = await admin.from("institutes").delete().eq("id", id);
      expect(error).toBeNull();
      expect(await historyFor(id)).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0011)("a closed institute starts a new cycle", () => {
    /**
     * Feature D. There was never a restriction to remove: no constraint, policy
     * or filter has ever cared about an institute's status when planning it.
     * These tests exist to keep it that way — a future "tidy the picker" change
     * that quietly filtered closed institutes out would break the client's
     * actual request, and nothing else here would notice.
     */
    const closedInstitute = async (label: string, status: string) => {
      const { data, error } = await admin
        .from("institutes")
        .insert({ name: `${TAG} ${label}`, type: "school", registered_by: repA.id })
        .select("id")
        .single();
      if (error) throw new Error(`institute: ${error.message}`);
      const { error: statusError } = await repA.db
        .from("institutes")
        .update({ status })
        .eq("id", data.id);
      if (statusError) throw new Error(`status: ${statusError.message}`);
      return data.id as string;
    };

    it("can be added to today's plan, like any other", async () => {
      for (const status of [
        "Session done",
        "Campus visit done",
        "RSVP received",
        "Will not come",
      ]) {
        const id = await closedInstitute(`replan ${status}`, status);
        const { error } = await repA.db.from("daily_plans").insert({
          member: repA.id,
          date: iso(),
          institute_id: id,
          purpose: `${TAG} new cycle`,
        });
        expect(error, status).toBeNull();
      }
    });

    it("keeps its closed status when planned — planning is not a status change", async () => {
      // Rule 4: status is always set by hand, never derived from activity.
      // Planning is activity, so it must not move the status, and must not
      // write a history row either.
      const id = await closedInstitute("status untouched", "RSVP received");
      const before = await historyFor(id);

      await repA.db.from("daily_plans").insert({
        member: repA.id,
        date: iso(),
        institute_id: id,
        purpose: `${TAG} new cycle`,
      });

      const { data: row } = await admin
        .from("institutes")
        .select("status")
        .eq("id", id)
        .single();
      expect(row?.status).toBe("RSVP received");
      expect(await historyFor(id)).toHaveLength(before.length);
    });

    it("runs the whole new cycle through, and the journey shows the reopen", async () => {
      const id = await closedInstitute("full cycle", "Will not come");

      const { data: plan, error: planError } = await repA.db
        .from("daily_plans")
        .insert({
          member: repA.id,
          date: iso(),
          institute_id: id,
          purpose: `${TAG} try again`,
          // 0014: a meeting needs a check-in as well as a plan row.
          checkin_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      expect(planError).toBeNull();

      // The meeting gate accepts it because it is on today's plan — the closed
      // status is irrelevant to the gate, which is the point.
      const { error: visitError } = await repA.db.rpc("log_visit", {
        p_institute_id: id,
        p_activity: "meeting",
        p_photo_url: photoFor(repA.id),
        p_daily_plan_id: plan!.id,
        p_status_set_to: "First meeting done",
      });
      expect(visitError).toBeNull();

      // Feature C records the reopen: closed, then open again.
      const rows = await historyFor(id);
      expect(rows.map((r) => r.status)).toEqual(["Will not come", "First meeting done"]);
      expect(rows[1].visit_id).toBeTruthy();

      const { data: row } = await admin
        .from("institutes")
        .select("status")
        .eq("id", id)
        .single();
      expect(row?.status).toBe("First meeting done");
    });

    it("can be planned again on a later day", async () => {
      // daily_plans is unique per member+date+institute, so a new day is a new
      // row without any special handling.
      const id = await closedInstitute("another day", "Session done");
      const rows = [iso(), iso(1), iso(2)].map((date) => ({
        member: repA.id,
        date,
        institute_id: id,
        purpose: `${TAG} recurring`,
      }));

      const { error } = await repA.db.from("daily_plans").insert(rows);
      expect(error).toBeNull();

      const { data: planned } = await admin
        .from("daily_plans")
        .select("date")
        .eq("institute_id", id);
      expect(planned).toHaveLength(3);
    });

    it("still refuses a second entry for the same institute on the same day", async () => {
      const id = await closedInstitute("same day twice", "Session done");
      const entry = {
        member: repA.id,
        date: iso(),
        institute_id: id,
        purpose: `${TAG} once`,
      };

      expect((await repA.db.from("daily_plans").insert(entry)).error).toBeNull();
      // The app upserts on this conflict, which is how re-planning corrects a
      // purpose rather than erroring. The constraint underneath still holds.
      const second = await repA.db.from("daily_plans").insert(entry);
      expect(second.error?.code).toBe("23505");
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0012)("materials — everyone reads, only an admin writes", () => {
    /**
     * Feature A. The library inverts the visit-photos shape: one collection the
     * whole team reads, that only an admin may add to. Both halves are tested,
     * for the table and for the bucket, because the app's own requireAdmin()
     * check is a courtesy — these policies are the actual boundary.
     */
    const PNG = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic, enough to store
    ]);
    const paths: string[] = [];

    const objectPath = (ownerId: string) => {
      const path = `${ownerId}/${crypto.randomUUID()}.png`;
      paths.push(path);
      return path;
    };

    const rowFor = (ownerId: string, path: string) => ({
      title: `${TAG} poster`,
      category: "Poster",
      file_path: path,
      file_name: "poster.png",
      file_type: "image/png",
      file_size: PNG.length,
      uploaded_by: ownerId,
    });

    afterAll(async () => {
      if (!configured || !has0012) return;
      await admin.from("materials").delete().like("title", `${TAG}%`);
      if (paths.length) await admin.storage.from("materials").remove(paths);
    });

    it("lets an admin add a material", async () => {
      const path = objectPath(boss.id);
      const upload = await boss.db.storage
        .from("materials")
        .upload(path, PNG, { contentType: "image/png" });
      expect(upload.error).toBeNull();

      const { error } = await boss.db.from("materials").insert(rowFor(boss.id, path));
      expect(error).toBeNull();
    });

    it("lets every rep read the library", async () => {
      const { data, error } = await repA.db
        .from("materials")
        .select("id, title")
        .like("title", `${TAG}%`);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it("refuses a rep adding a row", async () => {
      const { error } = await repA.db
        .from("materials")
        .insert(rowFor(repA.id, `${repA.id}/${crypto.randomUUID()}.png`));
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("refuses a rep uploading into the bucket", async () => {
      // The storage half. Without this an ordinary rep could fill the bucket
      // even though they could not create the row describing it.
      const { error } = await repA.db.storage
        .from("materials")
        .upload(`${repA.id}/${crypto.randomUUID()}.png`, PNG, {
          contentType: "image/png",
        });
      expect(error).not.toBeNull();
    });

    it("refuses a rep editing or deleting someone else's material", async () => {
      const { data: existing } = await admin
        .from("materials")
        .select("id")
        .like("title", `${TAG}%`)
        .limit(1)
        .single();

      // No UPDATE or DELETE policy applies to a rep, so both are no-ops rather
      // than errors under PostgREST — the row surviving is the assertion.
      await repA.db
        .from("materials")
        .update({ title: `${TAG} hijacked` })
        .eq("id", existing!.id);
      await repA.db.from("materials").delete().eq("id", existing!.id);

      const { data: after } = await admin
        .from("materials")
        .select("title")
        .eq("id", existing!.id)
        .maybeSingle();
      expect(after?.title).toBe(`${TAG} poster`);
    });

    it("lets a rep read the stored object, which is the point of the library", async () => {
      const path = paths[0];
      const { data, error } = await repA.db.storage
        .from("materials")
        .createSignedUrl(path, 60);
      expect(error).toBeNull();
      expect(data?.signedUrl).toBeTruthy();
    });

    it("keeps the bucket private", async () => {
      const { data } = await admin.storage.getBucket("materials");
      expect(data?.public).toBe(false);
      expect(data?.file_size_limit).toBe(5242880);
      expect(data?.allowed_mime_types).toContain("application/pdf");
    });

    it("refuses a category outside the six", async () => {
      const path = `${boss.id}/${crypto.randomUUID()}.png`;
      const { error } = await boss.db
        .from("materials")
        .insert({ ...rowFor(boss.id, path), category: "Newsletter" });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses a file type outside the four", async () => {
      const path = `${boss.id}/${crypto.randomUUID()}.zip`;
      const { error } = await boss.db
        .from("materials")
        .insert({ ...rowFor(boss.id, path), file_type: "application/zip" });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses a row claiming a file over the cap", async () => {
      const path = `${boss.id}/${crypto.randomUUID()}.png`;
      const { error } = await boss.db
        .from("materials")
        .insert({ ...rowFor(boss.id, path), file_size: 5242881 });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses two rows pointing at one stored object", async () => {
      const path = paths[0];
      const { error } = await boss.db
        .from("materials")
        .insert(rowFor(boss.id, path));
      expect(error?.code).toBe("23505");
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0013)("targets — one mechanism, three periods", () => {
    /**
     * The point of these is the RANGE. All three periods read the same two
     * sources (Rule 7: meetings from daily_plans, the rest from visits) and
     * differ only in the dates they count over, so the failure worth catching
     * is a month quietly reporting a week's numbers.
     */
    let subject: Member;
    let houseId: string;
    const day = iso();
    const week = mondayOf(day);
    const month = `${day.slice(0, 7)}-01`;

    beforeAll(async () => {
      subject = await makeMember("rep", "targets");
      const { data, error } = await admin
        .from("institutes")
        .insert({ name: `${TAG} targets school`, type: "school" })
        .select("id")
        .single();
      if (error) throw new Error(`institute: ${error.message}`);
      houseId = data.id;
    });

    afterAll(async () => {
      if (!configured || !has0013 || !subject) return;
      await admin.from("targets").delete().eq("member", subject.id);
      await admin.from("visits").delete().eq("member", subject.id);
      await admin.from("daily_plans").delete().eq("member", subject.id);
      await admin.from("profiles").delete().eq("id", subject.id);
      await admin.auth.admin.deleteUser(subject.id);
    });

    it("accepts a commitment for each of the three periods", async () => {
      for (const [period, start] of [
        ["daily", day],
        ["weekly", week],
        ["monthly", month],
      ] as const) {
        const { error } = await subject.db.from("targets").insert({
          member: subject.id,
          period,
          period_start: start,
          meetings: 3,
          institutes_covered: 2,
        });
        expect(error, period).toBeNull();
      }
    });

    it("refuses a period_start off its own grid", async () => {
      // The generalisation of weekly_targets_week_starts_monday. A Wednesday is
      // a fine day and a hopeless week.
      const wednesday = "2026-09-16";
      const weekly = await subject.db
        .from("targets")
        .insert({ member: subject.id, period: "weekly", period_start: wednesday });
      expect(weekly.error?.code).toBe(CHECK_VIOLATION);

      const monthly = await subject.db
        .from("targets")
        .insert({ member: subject.id, period: "monthly", period_start: wednesday });
      expect(monthly.error?.code).toBe(CHECK_VIOLATION);

      // ...and the same date is perfectly valid as a day.
      const daily = await subject.db
        .from("targets")
        .insert({ member: subject.id, period: "daily", period_start: wednesday });
      expect(daily.error).toBeNull();
    });

    it("refuses a period it does not know", async () => {
      // The `else false` in targets_period_start_aligned matters here: without
      // it the CASE would return NULL and a CHECK lets NULL through.
      const { error } = await subject.db
        .from("targets")
        .insert({ member: subject.id, period: "quarterly", period_start: month });
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("lets one member hold all three periods at once", async () => {
      const { data } = await admin
        .from("targets")
        .select("period")
        .eq("member", subject.id)
        .in("period", ["daily", "weekly", "monthly"]);
      const periods = new Set((data ?? []).map((r) => r.period));
      expect(periods.has("daily")).toBe(true);
      expect(periods.has("weekly")).toBe(true);
      expect(periods.has("monthly")).toBe(true);
    });

    it("applies Rule 6's lock to a day exactly as to a week", async () => {
      const lockDay = iso(-3);
      await subject.db.from("targets").insert({
        member: subject.id,
        period: "daily",
        period_start: lockDay,
        meetings: 2,
        locked: true,
      });

      const { data: row } = await admin
        .from("targets")
        .select("locked, submitted_at")
        .eq("member", subject.id)
        .eq("period", "daily")
        .eq("period_start", lockDay)
        .single();
      expect(row?.locked).toBe(true);
      expect(row?.submitted_at).not.toBeNull(); // stamped by the trigger

      const edit = await subject.db
        .from("targets")
        .update({ meetings: 99 })
        .eq("member", subject.id)
        .eq("period", "daily")
        .eq("period_start", lockDay);
      expect(edit.error?.code).toBe(CHECK_VIOLATION);

      const selfUnlock = await subject.db
        .from("targets")
        .update({ locked: false })
        .eq("member", subject.id)
        .eq("period", "daily")
        .eq("period_start", lockDay);
      expect(selfUnlock.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      const adminUnlock = await boss.db
        .from("targets")
        .update({ locked: false })
        .eq("member", subject.id)
        .eq("period", "daily")
        .eq("period_start", lockDay);
      expect(adminUnlock.error).toBeNull();

      const { data: after } = await admin
        .from("targets")
        .select("locked, reopened_by")
        .eq("member", subject.id)
        .eq("period", "daily")
        .eq("period_start", lockDay)
        .single();
      expect(after?.locked).toBe(false);
      expect(after?.reopened_by).toBe(boss.id);
    });

    it("counts achieved figures over each period's own range", async () => {
      // Two visits: one today, one 20 days back. The day sees one; the month
      // sees both whenever the older one fell in the same calendar month. That
      // gap between the ranges is the whole feature.
      const old = iso(-20);
      const oldInSameMonth = old.slice(0, 7) === day.slice(0, 7);

      await admin.from("visits").insert([
        {
          institute_id: houseId,
          member: subject.id,
          activity: "olympiad",
          date: day,
          photo_url: photoFor(subject.id),
        },
        {
          institute_id: houseId,
          member: subject.id,
          activity: "olympiad",
          date: old,
          photo_url: photoFor(subject.id),
        },
      ]);

      const inRange = async (start: string, end: string) => {
        const { data } = await admin
          .from("visits")
          .select("id")
          .eq("member", subject.id)
          .gte("date", start)
          .lte("date", end);
        return (data ?? []).length;
      };

      expect(await inRange(day, day)).toBe(1);

      const monthEnd = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
      expect(await inRange(month, monthEnd)).toBe(oldInSameMonth ? 2 : 1);
    });

    it("counts institutes covered as distinct, not as visits", async () => {
      // Self-contained on its own date. Leaning on rows another test inserted
      // makes the count depend on test order, which is how this one was wrong
      // the first time.
      const coverDay = iso(-6);
      const { data: second } = await admin
        .from("institutes")
        .insert({ name: `${TAG} second school`, type: "school" })
        .select("id")
        .single();

      // Three visits, two schools: the first school twice.
      await admin.from("visits").insert([
        {
          institute_id: houseId,
          member: subject.id,
          activity: "olympiad",
          date: coverDay,
          photo_url: photoFor(subject.id),
        },
        {
          institute_id: houseId,
          member: subject.id,
          activity: "application",
          date: coverDay,
          photo_url: photoFor(subject.id),
        },
        {
          institute_id: second!.id,
          member: subject.id,
          activity: "olympiad",
          date: coverDay,
          photo_url: photoFor(subject.id),
        },
      ]);

      const { data } = await admin
        .from("visits")
        .select("institute_id")
        .eq("member", subject.id)
        .eq("date", coverDay);

      // Three rows, but "covered" is two — the distinction the ninth metric
      // exists for.
      expect((data ?? []).length).toBe(3);
      expect(new Set((data ?? []).map((r) => r.institute_id)).size).toBe(2);
    });

    it("keeps one member's targets away from another rep", async () => {
      const { data } = await repB.db
        .from("targets")
        .select("id")
        .eq("member", subject.id);
      expect(data ?? []).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------- */

  describe.skipIf(!has0014)("check-in / check-out — the presence record", () => {
    /**
     * Feature 2, built but unshipped. The two things worth proving are the two
     * that field reality attacks: a check-in must survive having no location at
     * all, and a visit must never be able to get permanently stuck.
     */
    let houseId: string;
    const day = iso();

    const plan = async (label: string, date = day) => {
      const { data: house, error: hErr } = await admin
        .from("institutes")
        .insert({ name: `${TAG} ${label}`, type: "school" })
        .select("id")
        .single();
      if (hErr) throw new Error(`institute: ${hErr.message}`);
      const { data, error } = await repA.db
        .from("daily_plans")
        .insert({
          member: repA.id,
          date,
          institute_id: house.id,
          purpose: `${TAG} ${label}`,
        })
        .select("id")
        .single();
      if (error) throw new Error(`plan: ${error.message}`);
      return { planId: data.id as string, instituteId: house.id as string };
    };

    beforeAll(async () => {
      const { data } = await admin
        .from("institutes")
        .insert({ name: `${TAG} presence base`, type: "school" })
        .select("id")
        .single();
      houseId = data!.id;
    });

    it("derives the same status the app does, for all four shapes", async () => {
      // The database and src/lib/validation/checkin.ts must never disagree:
      // one is what the report reads, the other is what the Dashboard renders.
      const cases: [string | null, string | null, boolean, string][] = [
        [null, null, false, "Scheduled"],
        ["2026-09-06T09:00:00Z", null, false, "In Progress"],
        ["2026-09-06T09:00:00Z", "2026-09-06T10:00:00Z", false, "Completed"],
        ["2026-09-06T09:00:00Z", null, true, "Completed"],
      ];
      for (const [checkin, checkout, missing, expected] of cases) {
        const { data, error } = await admin.rpc("plan_visit_status", {
          p_checkin_at: checkin,
          p_checkout_at: checkout,
          p_checkout_missing: missing,
        });
        expect(error, expected).toBeNull();
        expect(data, `${checkin}/${checkout}/${missing}`).toBe(expected);
        expect(
          visitStatusOf({
            checkinAt: checkin,
            checkoutAt: checkout,
            checkoutMissing: missing,
          }),
        ).toBe(expected);
      }
    });

    it("computes the same duration the app does, and null when open", async () => {
      const { data: minutes } = await admin.rpc("plan_visit_minutes", {
        p_checkin_at: "2026-09-06T09:00:00Z",
        p_checkout_at: "2026-09-06T10:25:00Z",
      });
      expect(minutes).toBe(85);
      expect(
        visitMinutes({
          checkinAt: "2026-09-06T09:00:00Z",
          checkoutAt: "2026-09-06T10:25:00Z",
          checkoutMissing: false,
        }),
      ).toBe(85);

      const { data: open } = await admin.rpc("plan_visit_minutes", {
        p_checkin_at: "2026-09-06T09:00:00Z",
        p_checkout_at: null,
      });
      expect(open).toBeNull();
    });

    it("ACCEPTS a check-in with no location at all", async () => {
      // The escape valve, at the layer that actually enforces things. A denied
      // permission must never stop a rep recording that they arrived.
      const { planId } = await plan("no gps");
      const { error } = await repA.db
        .from("daily_plans")
        .update({ checkin_at: new Date().toISOString() })
        .eq("id", planId);
      expect(error).toBeNull();

      const { data } = await admin
        .from("daily_plans")
        .select("checkin_at, checkin_lat")
        .eq("id", planId)
        .single();
      expect(data?.checkin_at).not.toBeNull();
      expect(data?.checkin_lat).toBeNull();
    });

    it("refuses a check-out with no check-in, and one that precedes it", async () => {
      const { planId } = await plan("bad order");
      const noCheckin = await repA.db
        .from("daily_plans")
        .update({ checkout_at: new Date().toISOString() })
        .eq("id", planId);
      expect(noCheckin.error?.code).toBe(CHECK_VIOLATION);

      await repA.db
        .from("daily_plans")
        .update({ checkin_at: "2026-09-06T10:00:00Z" })
        .eq("id", planId);
      const before = await repA.db
        .from("daily_plans")
        .update({ checkout_at: "2026-09-06T09:00:00Z" })
        .eq("id", planId);
      expect(before.error?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses a row that both has a check-out and claims one is missing", async () => {
      const { planId } = await plan("contradiction");
      await repA.db
        .from("daily_plans")
        .update({
          checkin_at: "2026-09-06T09:00:00Z",
          checkout_at: "2026-09-06T10:00:00Z",
        })
        .eq("id", planId);
      const { error } = await repA.db
        .from("daily_plans")
        .update({ checkout_missing: true })
        .eq("id", planId);
      expect(error?.code).toBe(CHECK_VIOLATION);
    });

    it("lets a stuck visit be closed without a check-out", async () => {
      const { planId } = await plan("forgot");
      await repA.db
        .from("daily_plans")
        .update({ checkin_at: "2026-09-06T09:00:00Z" })
        .eq("id", planId);

      const { error } = await repA.db
        .from("daily_plans")
        .update({ checkout_missing: true })
        .eq("id", planId);
      expect(error).toBeNull();

      const { data } = await admin
        .from("daily_plans")
        .select("checkin_at, checkout_at, checkout_missing")
        .eq("id", planId)
        .single();
      expect(
        visitStatusOf({
          checkinAt: data!.checkin_at,
          checkoutAt: data!.checkout_at,
          checkoutMissing: data!.checkout_missing,
        }),
      ).toBe("Completed");
      expect(
        visitMinutes({
          checkinAt: data!.checkin_at,
          checkoutAt: data!.checkout_at,
          checkoutMissing: data!.checkout_missing,
        }),
      ).toBeNull();
    });

    it("lets an admin close a rep's forgotten visit", async () => {
      const { planId } = await plan("admin closes");
      await repA.db
        .from("daily_plans")
        .update({ checkin_at: "2026-09-06T09:00:00Z" })
        .eq("id", planId);

      const { error } = await boss.db
        .from("daily_plans")
        .update({ checkout_missing: true })
        .eq("id", planId);
      expect(error).toBeNull();
    });

    it("refuses a meeting on a planned visit nobody checked in to", async () => {
      // The presence guarantee. enforce_meeting_gate still requires the plan
      // row; this adds that the rep has to have actually turned up.
      const { planId, instituteId } = await plan("no checkin meeting");
      const { error } = await repA.db.rpc("log_visit", {
        p_institute_id: instituteId,
        p_activity: "meeting",
        p_photo_url: photoFor(repA.id),
        p_daily_plan_id: planId,
      });
      expect(error?.code).toBe("FO009");
    });

    it("accepts the same meeting once the rep has checked in", async () => {
      const { planId, instituteId } = await plan("checked in meeting");
      await repA.db
        .from("daily_plans")
        .update({ checkin_at: new Date().toISOString() })
        .eq("id", planId);

      const { error } = await repA.db.rpc("log_visit", {
        p_institute_id: instituteId,
        p_activity: "meeting",
        p_photo_url: photoFor(repA.id),
        p_daily_plan_id: planId,
      });
      expect(error).toBeNull();
    });

    it("leaves the other activities alone", async () => {
      // Sessions and the one-shots do not run off the daily plan, so they are
      // exempt from the presence guarantee exactly as they are exempt from the
      // meeting gate.
      const { error } = await repA.db.from("visits").insert({
        institute_id: houseId,
        member: repA.id,
        activity: "olympiad",
        date: day,
        photo_url: photoFor(repA.id),
      });
      expect(error).toBeNull();
    });
  });
});
