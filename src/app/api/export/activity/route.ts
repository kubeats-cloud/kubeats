import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin";
import { buildActivityExport } from "@/lib/exports/activity-export";
import { buildFieldVisitExport } from "@/lib/exports/field-visit-export";
import { exportRangeSchema } from "@/lib/validation/export";

/**
 * The staff (admin or team lead) activity export, as an .xlsx download.
 *
 * STAFF-ONLY, AND ENFORCED HERE. proxy.ts returns early for /api/*, so nothing
 * under it is behind the page gate — every route authenticates itself or it is
 * public, which is the rule /api/health is the worked example of. `requireStaff`
 * is that check, and it is the same one Call Activity's and Institute-Wise
 * Activity's export routes already use: role plus `profileStatus === "ready"`,
 * so an unreadable profile is never treated as staff. Hiding the button would
 * not have been a control; a rep who knows the URL gets 403 from this line
 * whatever the UI shows them.
 *
 * Underneath it, RLS is still what decides which rows the queries return —
 * `buildActivityExport()` reads `visits`/`daily_plans`/`profiles`, all
 * `supervises()`-scoped since migration 0042. The export runs as the signed-in
 * caller, not with any elevated key — so the gate failing open would still
 * not hand a rep the team's numbers, it would hand them their own, and a team
 * lead already gets exactly their own reps rather than the whole company.
 * Two locks on one door, as everywhere else in this app.
 *
 * A GET RATHER THAN A SERVER ACTION, because a download wants a URL: the
 * browser navigates to it, the file lands in Downloads, and nothing has to
 * marshal bytes back through React. It also means a caller can bookmark a
 * range. Nothing here writes, so a GET is honest about what it does.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireStaff();
  if (!gate.ok) {
    // 403 rather than a redirect: this is an API, and a signed-out caller
    // following a stale bookmark should see why rather than get an HTML login
    // page saved as a .xlsx.
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = exportRangeSchema.safeParse({
    start: params.get("start") ?? undefined,
    end: params.get("end") ?? undefined,
    member: params.get("member") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That date range is not valid." },
      { status: 400 },
    );
  }

  const { start, end, member } = parsed.data;
  const report = params.get("report");
  if (report !== null && report !== "field-visits") {
    return NextResponse.json({ error: "Unknown report." }, { status: 400 });
  }
  /*
   * The Overview's sort rides along so the file is ordered like the table it
   * was downloaded from. Parsed leniently by the model: a stale status name
   * falls back to the name order rather than turning a download into an error.
   */
  const sort = {
    key: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
  };
  /*
   * The Overview's table shows Open/Closed per activity rather than the 18
   * status columns, so its file asks for that layout explicitly. Absent is the
   * client template `/team/report` downloads, unchanged.
   */
  const layout = params.get("layout");
  if (layout !== null && layout !== "activity-status") {
    return NextResponse.json({ error: "Unknown layout." }, { status: 400 });
  }
  const result = report === "field-visits"
    ? await buildFieldVisitExport({ start, end })
    : await buildActivityExport(
        { start, end },
        member ?? null,
        sort,
        layout === "activity-status" ? { layout } : {},
      );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Copied into a fresh ArrayBuffer: the Uint8Array the writer returns may be a
  // view onto a larger buffer, and handing that straight to Response would send
  // the whole backing store.
  const body = result.bytes.slice().buffer as ArrayBuffer;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.bytes.length),
      // A report of live data; a cached copy would quietly be yesterday's.
      "Cache-Control": "no-store",
    },
  });
}
