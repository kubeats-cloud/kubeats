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

const iso = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

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
        activity: "meeting",
        date: iso(1),
      });
      expect(error?.code).toBe(CHECK_VIOLATION);
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
        { institute_id: instituteId, member: repA.id, activity: "session", lifecycle_status: "Set", date: iso(), expected_date: iso(7) },
        { institute_id: instituteId, member: repA.id, activity: "session", lifecycle_status: "Done", date: iso() },
        { institute_id: instituteId, member: repA.id, activity: "olympiad", date: iso() },
        // Dated well outside the week: must not be counted.
        { institute_id: instituteId, member: repA.id, activity: "olympiad", date: iso(-40) },
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
