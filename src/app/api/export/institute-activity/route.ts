import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin";
import { buildInstituteActivityExport } from "@/lib/exports/institute-activity-export";
import {
  isInstituteActivitySortKey,
  type InstituteActivitySortKey,
} from "@/lib/institute-activity-counts";
import { pipelineRangeSchema } from "@/lib/validation/pipeline-report";

/**
 * The institute-wise Activity Report export, as an .xlsx download.
 *
 * STAFF-GATED, NOT ADMIN-ONLY — same gate as `/institutes/report` itself
 * (`requireStaff`), because a team lead's Excel must match the team lead's
 * own screen. RLS underneath is what actually scopes the rows, the same way
 * every other export in this app works: the query runs as the signed-in
 * caller, never with an elevated key.
 *
 * Same model the screen renders (`getInstituteActivityModel`, reached through
 * `buildInstituteActivityExport`), so the file always matches the filtered,
 * sorted table — there is no second counting path to drift from it.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireStaff();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const parsedRange = pipelineRangeSchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });

  if (!parsedRange.success) {
    return NextResponse.json(
      {
        error:
          parsedRange.error.issues[0]?.message ??
          "That date range is not one we can report on.",
      },
      { status: 400 },
    );
  }

  const rawSort = params.get("sort") ?? undefined;
  const sortKey: InstituteActivitySortKey = isInstituteActivitySortKey(rawSort)
    ? rawSort
    : "institute";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const result = await buildInstituteActivityExport({
    range: parsedRange.data,
    sort: { key: sortKey, dir },
    page: params.get('page') ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Copied into a fresh ArrayBuffer: the Uint8Array the writer returns may be a
  // view onto a larger buffer, and handing that straight to Response would send
  // the whole backing store. Same stance as /api/export/activity.
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
