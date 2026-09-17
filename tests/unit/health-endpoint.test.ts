import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * /api/health, and the one line in it that is a security control.
 *
 * THE ANONYMOUS ANSWER IS THE POINT OF THIS FILE. It is a static `{"ok":true}`
 * that touches nothing, and it is that way because of a pen-test finding (F2):
 * the endpoint used to run a database count on every request, which let a
 * stranger spend Supabase quota at will and told them, through `latencyMs` and
 * `checks.database`, whether our database was up and how loaded it was.
 *
 * That is exactly the kind of thing a later change quietly undoes. Deepening
 * the token-gated answer — adding the cron check — meant editing the same
 * function, one `if` away from the public branch, which is the moment the
 * finding is most likely to be reintroduced by accident. So the split is pinned
 * here rather than trusted to review.
 *
 * WHAT CANNOT BE TESTED FROM NODE is the route running: it needs a Request, the
 * environment and a database. vitest.config.mts documents why this project has
 * no DOM or server harness, and log-visit-form.test.ts explains why adding one
 * is an architectural decision rather than a side effect of a change. So this
 * reads the source for the properties that are checkable and that are the ones
 * actually at risk.
 */

const source = readFileSync(
  fileURLToPath(new URL("../../src/app/api/health/route.ts", import.meta.url)),
  "utf8",
);

/**
 * The file with its comments taken out.
 *
 * Every assertion below about what is ABSENT needs this: the file explains the
 * F2 finding at length, so it necessarily contains the words for the thing it
 * must not do. Three tests in this repo have been caught by that already —
 * see error-boundaries.test.ts for the history.
 */
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Everything after the token check — the deep answer's code. */
const deepBranch = codeOnly.slice(codeOnly.indexOf("tokenMatches("));
/** The tail after the deep branch returns — the anonymous answer's code. */
const publicBranch = codeOnly.slice(codeOnly.lastIndexOf("return NextResponse.json("));

describe("the anonymous answer gives nothing away (F2)", () => {
  it("is a static { ok: true }", () => {
    expect(publicBranch).toContain("NextResponse.json({ ok: true }");
    expect(publicBranch).toContain("status: 200");
  });

  it("makes no database call, so it cannot spend quota or be timed", () => {
    // THE REGRESSION F2 WAS RAISED FOR. Anything that awaits here hands a
    // stranger a probe into whether Postgres is up and how slow it is.
    expect(publicBranch).not.toContain("await");
    expect(publicBranch).not.toContain("createAdminClient");
    expect(publicBranch).not.toContain("databaseReachable");
    expect(publicBranch).not.toContain("cronScheduled");
  });

  it("leaks no subsystem detail, no build and no timing", () => {
    // NB: not "status:" — the public return legitimately carries
    // `{ status: 200 }` as the HTTP option. What must not appear is a BODY
    // field describing anything behind the Worker.
    for (const leak of ["latencyMs", "commit", "checks", "cron", "jobs"]) {
      expect(publicBranch, `${leak} must not reach an anonymous caller`).not.toContain(
        leak,
      );
    }
  });

  it("is reached only when the token does not match", () => {
    // The public return is the LAST statement in the handler, after the gated
    // branch has returned. If that ordering were ever inverted, everyone would
    // get the deep answer.
    expect(codeOnly.indexOf("tokenMatches(")).toBeLessThan(
      codeOnly.lastIndexOf("return NextResponse.json("),
    );
  });
});

describe("the deep answer is gated and constant-time", () => {
  it("requires both the configured token and a matching header", () => {
    // `expected &&` is what makes the deep check ABSENT rather than merely
    // locked on a deployment that never set HEALTH_CHECK_TOKEN.
    expect(codeOnly).toContain("if (expected && tokenMatches(");
    expect(codeOnly).toContain('request.headers.get("x-health-token")');
  });

  it("compares without an early return, so the token cannot be guessed", () => {
    expect(codeOnly).toContain("difference |=");
    expect(codeOnly).not.toMatch(/provided\s*===\s*expected/);
  });
});

describe("the deep answer reports each subsystem", () => {
  it("checks the database and the cron jobs", () => {
    expect(deepBranch).toContain("databaseReachable()");
    expect(deepBranch).toContain("cronScheduled()");
    expect(deepBranch).toContain("database: databaseOk");
    expect(deepBranch).toContain("cron: cron.status");
  });

  it("answers 503 when degraded, so a monitor can alert on the status code", () => {
    expect(deepBranch).toContain('status: ok ? "ok" : "degraded"');
    expect(deepBranch).toContain("status: ok ? 200 : 503");
  });

  it("degrades on an unreachable database and on missing jobs — but not on 'unknown'", () => {
    // The whole judgement, in one line of source. "unknown" means the question
    // could not be ASKED (0031 not applied, or no pg_cron): a monitoring gap,
    // not an outage. Paging on it would teach somebody to ignore this endpoint.
    expect(deepBranch).toContain('const ok = databaseOk && cron.status !== "missing"');
  });

  it("never lets a subsystem check take the endpoint down", () => {
    // A health endpoint that can 500 tells a monitor nothing except that it
    // cannot be trusted. Both helpers catch and return a verdict instead.
    const helpers = codeOnly.slice(
      codeOnly.indexOf("async function databaseReachable"),
      codeOnly.indexOf("export async function GET"),
    );
    expect((helpers.match(/catch \(error\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(helpers).not.toContain("throw");
  });

  it("bounds every query, so a hung database cannot hang the monitor", () => {
    expect(codeOnly).toContain("TIMEOUT_MS");
    expect((codeOnly.match(/Promise\.race/g) ?? []).length).toBe(2);
  });
});

describe("no response is cacheable and none carries a secret", () => {
  it("sends no-store on both answers", () => {
    expect((codeOnly.match(/headers: NO_STORE/g) ?? []).length).toBe(2);
  });

  it("never puts the token or a key into a response body", () => {
    // Scoped to the BODY, because `expected` legitimately appears in the
    // comparison that gates the branch — an assertion over the whole file
    // could not tell the two apart. A health endpoint is the last place to
    // echo back a credential that was just proved correct.
    const deepBody = codeOnly.slice(
      codeOnly.indexOf("NextResponse.json("),
      codeOnly.indexOf("commit: appCommitSha()"),
    );
    for (const secret of ["expected", "x-health-token", "SERVICE_ROLE"]) {
      expect(deepBody, secret).not.toContain(secret);
    }
    expect(codeOnly).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("logs the error, never the header it was given", () => {
    // logError takes the caught error and a context string. Handing it the
    // request or the token would put a credential in the Worker log.
    for (const call of codeOnly.match(/logError\([^)]*\)/g) ?? []) {
      expect(call).not.toContain("request");
      expect(call).not.toContain("expected");
    }
  });
});

describe("the cron check knows which jobs matter", () => {
  it("asks about exactly the two this app schedules", () => {
    expect(codeOnly).toContain('"purge-visit-photos"');
    expect(codeOnly).toContain('"sweep-open-checkins"');
  });

  it("calls the function 0031 adds, not the cron catalogue directly", () => {
    // `cron.job` is not exposed to PostgREST, and exposing it would publish
    // every job's command text. 0031's function answers one question instead.
    expect(codeOnly).toContain('db.rpc("health_cron_jobs")');
    expect(codeOnly).not.toContain('from("cron.job")');
  });

  it("only counts a job that is ACTIVE", () => {
    // A job can be present and paused, which is a stopped job wearing a
    // disguise. Scheduled-but-inactive must read as missing.
    expect(codeOnly).toContain("filter((row) => row.active)");
  });
});
