import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #6 / #7 — a rep cannot sign out of a visit they are standing in.
 *
 * WHAT THE RULE IS. A visit ends by being FINISHED: the report is filed and
 * "Save and check out" stamps the departure with a live position. Signing out
 * mid-visit does not end it — it abandons it, and the row stays open until the
 * nightly sweep or an admin writes it off as "duration not recorded". So the
 * app's sign-out asks first, and names the institute still holding them.
 *
 * WHAT IT MUST NOT DO, AND THIS IS THE HALF WORTH GUARDING. It must not check
 * the rep out on the way past. That would invent a departure time of "whenever
 * they tapped sign-out", which the duration report cannot tell from a measured
 * one — the exact thing migration 0030 and `sweep_open_checkins()` both refuse
 * to do. The action READS and never writes.
 *
 * WHY THIS IS READ AT SOURCE LEVEL. The rule lives in a server action and a
 * client component. There is no DOM test environment here on purpose
 * (vitest.config.mts; log-visit-form.test.ts explains why adding one is an
 * architectural decision rather than a side effect of a bug fix), and the
 * action needs a request context to run. What is checkable from Node is the
 * shape — which is what the regressions would actually look like.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

/**
 * The file with its comments taken out.
 *
 * Needed because the assertions below are ABSENCES, and this project comments
 * heavily: auth-actions.ts explains at length that it never touches
 * `daily_plans` and never invents a `checkout_at`, so a bare `not.toContain`
 * fails on the very sentence that promises the thing being checked for. The
 * mirror image is the real danger — a file that HAD grown a write would still
 * "contain" the word either way, so the check could not tell the cure from the
 * explanation of it. The same trap log-visit-form.test.ts was caught by.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ACTIONS = "src/lib/auth-actions.ts";
const PLAIN_SIGN_OUT = ACTIONS;
const BUTTON = "src/components/layout/sign-out-button.tsx";
const TOP_BAR = "src/components/layout/top-bar.tsx";
const VISITS = "src/lib/visits.ts";

describe("the block is enforced on the server", () => {
  const source = read(ACTIONS);

  it("the guarded sign-out asks who is signed in and what is open", () => {
    expect(source).toContain("export async function signOutIfFinished(");
    // Identity from the session, never from the request body — a rep cannot
    // post somebody else's id, or a claim that nothing is open.
    expect(source).toContain("await getCurrentUser()");
    expect(source).toContain("await openVisitFor(user.id)");
  });

  it("the top bar uses the guarded one, not the plain one", () => {
    // THE REGRESSION. `signOut` still exists for the MFA screen, so wiring the
    // bar back to it would compile, run, and silently drop the whole rule.
    const button = read(BUTTON);
    expect(button).toContain("signOutIfFinished");
    expect(codeOnly(button)).not.toMatch(/\bsignOut\b(?!IfFinished)/);
    expect(read(TOP_BAR)).toContain("<SignOutButton />");
  });

  it("names the institute, because 'you have an open visit' is not actionable", () => {
    expect(source).toContain("instituteName: open.instituteName");
    expect(read(BUTTON)).toContain("blocked?.instituteName");
  });

  it("offers the way back to the visit", () => {
    // A refusal with no route out of it is a dead end.
    expect(read(BUTTON)).toContain("/log?plan=${blocked.planId}");
  });
});

/**
 * The guarantee the client cannot give.
 *
 * A component check would be a hint: the form can be posted directly, and this
 * is precisely the button a rep in a hurry would want to get past. So the
 * component is allowed to know nothing — it submits and reads the answer.
 */
describe("the component decides nothing", () => {
  const button = read(BUTTON);

  it("holds no idea of its own about open visits", () => {
    // If a `checkin`/`openVisit` prop ever appears here, the rule has moved to
    // a place a rep can edit.
    const code = codeOnly(button);
    expect(code).not.toMatch(/checkin_at|checkout_at|checkout_missing/);
    expect(code).not.toContain("openVisitFor");
  });

  it("shows the refusal only once the server has given one", () => {
    expect(button).toContain("const blocked = state.blockedBy");
    expect(button).toContain("blocked !== null");
  });
});

describe("no fake check-out is ever created", () => {
  const source = read(ACTIONS);

  it("the sign-out path writes nothing to daily_plans", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A checkout stamped on the way out
    // would be an invented duration that looks exactly like a measured one.
    const code = codeOnly(source);
    expect(code).not.toContain("daily_plans");
    expect(code).not.toMatch(/checkout_at|checkout_lat|checkout_lng|checkout_missing/);
    expect(code).not.toMatch(/\.update\(|\.insert\(|\.upsert\(/);
  });

  it("the lookup it uses is a read", () => {
    const whole = read(VISITS);
    const helper = whole.slice(whole.indexOf("export async function openVisitFor"));
    const body = codeOnly(helper.slice(0, helper.indexOf("\n}\n") + 2));
    expect(body).toContain("openVisitFor(");
    expect(body).toContain(".select(");
    expect(body).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
  });

  it("says in the code why, so nobody 'helpfully' adds one", () => {
    expect(source).toMatch(/invent/i);
    expect(source).toContain("0030");
  });
});

/**
 * Who the rule does NOT apply to, and the ways out that must survive it.
 *
 * A rule that traps somebody is worse than the problem it solves. Each of these
 * is a door that has to stay open.
 */
describe("it blocks a rep mid-visit and nobody else", () => {
  const source = read(ACTIONS);

  it("lets an admin straight through", () => {
    // An admin has no campus and does no field work (FO021), so the query would
    // find nothing anyway — the role is checked first so their sign-out cannot
    // be held up by a data oddity, and costs no round trip.
    expect(source).toContain("if (isAdmin(user)) return await finish()");
  });

  it("lets a rep with nothing open straight through", () => {
    expect(source).toContain("if (!open) return await finish()");
  });

  it("never strands a session it cannot identify", () => {
    expect(source).toContain("if (!user) return await finish()");
  });

  it("leaves the MFA screen's sign-out unguarded", () => {
    // A rep who cannot get past verification cannot reach /log to finish
    // anything, so guarding that door would lock them in rather than out.
    expect(read("src/app/verify/verify-form.tsx")).toContain("action={signOut}");
    expect(read(PLAIN_SIGN_OUT)).toContain("export async function signOut(): Promise<void>");
  });
});

/**
 * The two escape valves this rule leans on, asserted where they live.
 *
 * Blocking sign-out is only defensible because a rep who genuinely cannot
 * finish — dead phone, already left the site — has somebody who can close it
 * for them. If either of these goes, the block becomes a trap.
 */
describe("the recourse for a rep who cannot finish still exists", () => {
  it("an admin can still clear a stuck visit", () => {
    const source = read("src/lib/checkin-actions.ts");
    expect(source).toContain("export async function clearStuckCheckIn(");
    expect(source).toContain("checkout_missing: true");
    // And still without inventing a departure time.
    expect(source).not.toMatch(/checkout_at:\s*new Date/);
  });

  it("the nightly sweep is still installed", () => {
    const migration = read("supabase/migrations/0018_core_flow.sql");
    expect(migration).toContain("sweep_open_checkins");
  });
});
