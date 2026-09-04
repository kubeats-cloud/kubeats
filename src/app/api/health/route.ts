import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/errors";

/**
 * Health check, for uptime monitoring and deploy smoke tests.
 *
 * Answers two questions and no others: is the app serving, and can it reach the
 * database? It returns no data and no configuration — a failure is reported as
 * a plain "unreachable", with the real reason going to the server log. That
 * matters because this endpoint is deliberately public: the proxy exempts
 * /api/*, so a monitor can poll it without a session.
 *
 * The query is a HEAD count against a tiny seeded table, so it touches one
 * index and returns no rows.
 */

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 4000;

export async function GET() {
  const startedAt = Date.now();
  let database: "ok" | "unreachable" = "unreachable";

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

    if (error) logError("health:database", error);
    else database = "ok";
  } catch (error) {
    logError("health:database", error);
  }

  const healthy = database === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { database },
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
