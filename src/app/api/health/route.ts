import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { healthCheckToken } from "@/lib/env";
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

export async function GET(request: Request) {
  const expected = healthCheckToken();

  // The deep answer, for a caller that proves it is the monitor.
  if (expected && tokenMatches(request.headers.get("x-health-token"), expected)) {
    const startedAt = Date.now();
    const ok = await databaseReachable();

    return NextResponse.json(
      {
        status: ok ? "ok" : "degraded",
        checks: { database: ok ? "ok" : "unreachable" },
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      },
      { status: ok ? 200 : 503, headers: NO_STORE },
    );
  }

  // The public answer: proof the Worker is serving, and nothing else. No
  // database call, no timing, no clue about what is behind it.
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
