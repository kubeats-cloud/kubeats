import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appCommitSha, healthCheckToken } from "@/lib/env";
import { logError } from "@/lib/errors";

/**
 * Health check, for uptime monitoring and deploy smoke tests.
 *
 * TWO ANSWERS, AND THE PUBLIC ONE IS CHEAP
 *
 * This endpoint is unauthenticated by design: proxy.ts exempts /api/*, so a
 * monitor can poll it without a session. Anyone else can poll it too, which is
 * why the public answer is now a static {"ok":true} that touches nothing. It
 * used to run a database count on every request — a pen-test finding (F2),
 * and a fair one on two counts: it let an anonymous caller spend Supabase
 * quota at will, and its latencyMs plus checks.database told them whether our
 * database was up and how loaded it was. Neither is information a stranger
 * needs.
 *
 * The real check still exists for whoever is meant to have it. Set
 * HEALTH_CHECK_TOKEN and send it as x-health-token; without that variable the
 * deep check is not merely locked, it is absent, so a default deployment has
 * no second surface at all.
 *
 * The deep answer also names the COMMIT the bundle was built from, which is
 * what makes "has the new build gone out?" a one-line check:
 *
 *     curl -s -H "x-health-token: $TOKEN" https://.../api/health
 *     {"status":"ok","checks":{"database":"ok"},...,"commit":"41491ff..."}
 *
 * Worth having because every screen this app has changed lately sits behind
 * auth, so two consecutive builds are indistinguishable from outside. The
 * alternative — comparing content-hashed asset names against a local build —
 * does not work: those hashes are not reproducible across build environments.
 *
 * THE PATTERN NOTE, WHICH MATTERS MORE THAN THIS FILE
 *
 * proxy.ts returns early for /api/*, so NO route under it is behind the page
 * gate. Every future /api/* route has to authenticate itself — check a session,
 * a role, or a secret — or it is public. That is the rule this endpoint is an
 * example of, not an exception to.
 */

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 4000;

/**
 * Constant-time comparison, so the header cannot be guessed a byte at a time.
 *
 * Hand-written rather than node:crypto's timingSafeEqual: this runs on the
 * Workers runtime, and a Node built-in is exactly the kind of host-specific
 * dependency the portability rule exists to avoid.
 */
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

async function databaseReachable(): Promise<boolean> {
  try {
    const db = createAdminClient();
    const check = db
      .from("purposes")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    const { error } = (await Promise.race([
      check,
      new Promise<{ error: Error }>((resolve) =>
        setTimeout(() => resolve({ error: new Error("timed out") }), TIMEOUT_MS),
      ),
    ])) as { error: unknown };

    if (error) {
      logError("health:database", error);
      return false;
    }
    return true;
  } catch (error) {
    logError("health:database", error);
    return false;
  }
}

/**
 * The two pg_cron jobs this app's rules actually depend on.
 *
 * WHY THEY ARE WORTH A MONITOR'S ATTENTION. Neither failure shows up anywhere
 * else. No screen goes red and no request 500s:
 *
 *   purge-visit-photos    photographs outlive the retention promise made in
 *                         /privacy, and the bucket grows without limit.
 *   sweep-open-checkins   a rep who forgot to finish a visit is still checked
 *                         in the next morning, and FO013 then refuses them
 *                         every other institute for the rest of the day.
 *
 * THREE ANSWERS, NOT TWO, and the third is the point:
 *
 *   "ok"       both jobs found and active.
 *   "missing"  the database answered and they are not there. A real fault, and
 *              the only cron answer that degrades the endpoint.
 *   "unknown"  the question could not be ASKED — migration 0031 is not applied,
 *              or pg_cron is not installed. That is a gap in monitoring, not an
 *              outage, and paging somebody at 3am because a helper function is
 *              missing would teach them to ignore this endpoint. It is reported
 *              so a human notices; it does not raise the alarm.
 */
const CRON_JOBS = ["purge-visit-photos", "sweep-open-checkins"] as const;

type CronStatus = "ok" | "missing" | "unknown";

async function cronScheduled(): Promise<{
  status: CronStatus;
  jobs?: Record<string, boolean>;
}> {
  try {
    const db = createAdminClient();
    const call = db.rpc("health_cron_jobs");

    const { data, error } = (await Promise.race([
      call,
      new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(
          () => resolve({ data: null, error: new Error("timed out") }),
          TIMEOUT_MS,
        ),
      ),
    ])) as { data: { jobname: string; active: boolean }[] | null; error: unknown };

    if (error) {
      // Includes PGRST202 — "no function by that name" — which is simply a
      // database that has not had 0031 applied. Logged at the same level as
      // any other failure to ask; the caller decides it does not degrade.
      logError("health:cron", error);
      return { status: "unknown" };
    }

    const active = new Set(
      (data ?? []).filter((row) => row.active).map((row) => row.jobname),
    );
    const jobs = Object.fromEntries(
      CRON_JOBS.map((name) => [name, active.has(name)]),
    );
    return {
      status: CRON_JOBS.every((name) => active.has(name)) ? "ok" : "missing",
      jobs,
    };
  } catch (error) {
    logError("health:cron", error);
    return { status: "unknown" };
  }
}

export async function GET(request: Request) {
  const expected = healthCheckToken();

  // The deep answer, for a caller that proves it is the monitor.
  if (expected && tokenMatches(request.headers.get("x-health-token"), expected)) {
    const startedAt = Date.now();

    /*
     * BOTH CHECKS AT ONCE, and neither can reject. Each helper catches its own
     * failures and returns a verdict, so this Promise.all is a way of not
     * paying for the second round trip rather than a risk: a health endpoint
     * that can 500 tells a monitor nothing except that it cannot be trusted.
     */
    const [databaseOk, cron] = await Promise.all([
      databaseReachable(),
      cronScheduled(),
    ]);

    /*
     * WHAT MAKES IT "degraded", stated once so the HTTP status and the body
     * cannot drift apart. An unreachable database is an outage. Jobs that are
     * genuinely not scheduled are a fault worth waking up for. A cron answer of
     * "unknown" is neither — see cronScheduled() for why it must not page.
     */
    const ok = databaseOk && cron.status !== "missing";

    return NextResponse.json(
      {
        status: ok ? "ok" : "degraded",
        checks: {
          database: databaseOk ? "ok" : "unreachable",
          cron: cron.status,
        },
        // Per-job detail, and only when the question could be asked at all.
        // Omitted rather than filled with guesses, so "absent from the body"
        // and "false" mean different things.
        ...(cron.jobs ? { jobs: cron.jobs } : {}),
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
        // WHICH BUILD IS ANSWERING. Null unless APP_COMMIT_SHA was set when the
        // bundle was built — see env.ts for how a platform maps its own
        // variable onto that name without any platform spelling reaching src/.
        //
        // Here and nowhere else. The public answer below stays a static
        // {"ok":true}: a stranger polling this endpoint learns that a Worker is
        // serving, and nothing whatever about what it is serving.
        commit: appCommitSha(),
      },
      { status: ok ? 200 : 503, headers: NO_STORE },
    );
  }

  // The public answer: proof the Worker is serving, and nothing else. No
  // database call, no timing, no clue about what is behind it.
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
