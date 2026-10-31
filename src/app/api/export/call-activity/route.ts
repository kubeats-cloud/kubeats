import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin";
import { listCallStatusCatalogue } from "@/lib/statuses";
import { parseCallActivityFilters } from "@/lib/call-activity-report";
import { buildCallActivityExport } from "@/lib/exports/call-activity-export";

/**
 * The Call Activity Report's .xlsx download — its own route, separate from
 * `/api/export/activity` (the client's Visit/Activity template) and from
 * `/api/export/institute-activity`. Touches neither.
 *
 * ADMIN **OR TEAM LEAD**, unlike `/api/export/activity` which is
 * `requireAdmin()`-only — this report's own viewing permission (Part 2) is
 * `requireStaff()`, and the download has to match it or a team lead would
 * see the table on screen and a 403 on the button beside it. A rep is
 * refused here exactly as they are refused on screen: `requireStaff()`
 * first, and `call_activity_report()`'s own `is_admin() or is_team_lead()`
 * check underneath it either way.
 *
 * RLS, NOT THIS ROUTE, DECIDES WHOSE REPS ARE IN THE FILE. The export runs
 * as the signed-in caller and calls the same RPC the screen does — a team
 * lead's file contains only their own reps because `supervises()` already
 * narrows the registry, the same two-locks-on-one-door shape every other
 * route in this app uses.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireStaff();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const catalogue = await listCallStatusCatalogue();
  const { filters } = parseCallActivityFilters(
    {
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      member: params.get("member") ?? undefined,
      institute: params.get("institute") ?? undefined,
      status: params.get("status") ?? undefined,
    },
    catalogue,
  );

  const result = await buildCallActivityExport(filters);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Copied into a fresh ArrayBuffer — same reason `/api/export/activity`
  // does: the writer's Uint8Array may be a view onto a larger buffer, and
  // handing that straight to Response would send the whole backing store.
  const body = result.bytes.slice().buffer as ArrayBuffer;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
