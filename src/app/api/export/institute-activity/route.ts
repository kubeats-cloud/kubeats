import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin";
import {
  buildInstituteActivityExport,
  buildInstituteStatusActivityExport,
} from "@/lib/exports/institute-activity-export";
import {
  isInstituteActivitySortKey,
  isStatusActivitySortKey,
} from "@/lib/institute-activity-counts";
import {
  instituteActivityExportRangeProblem,
} from "@/lib/institute-activity-links";
import { pipelineRangeSchema } from "@/lib/validation/pipeline-report";
import { getCurrentUser } from "@/lib/auth";

/**
 * The Institute Activity export, as an .xlsx download.
 *
 * TWO SHAPES, TWO GATES:
 *
 *   - No `view` is the admin/team-lead report: one row per visit with one
 *     column per active status. `requireStaff()` gates the route and
 *     `audit_institute_activity` checks the same roles again in SQL, so a rep
 *     calling this endpoint directly is refused twice.
 *   - `view=rep` (the rep's own institute list) and `view=presence` (R7) are
 *     rep-only. The SQL behind them takes NO rep id; it derives the member
 *     from auth.uid(), so a forged URL cannot widen the file.
 *
 * EVERY VIEW REQUIRES A COMPLETE RANGE OF AT MOST 31 DAYS. The check happens
 * here before any query and again inside the RPC, so neither a crafted URL nor
 * a future caller can build a wider file. Nothing is assembled in the browser.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawView = params.get("view");
  const view =
    rawView === "rep" || rawView === "presence" ? rawView : undefined;
  const gatedView = rawView !== null && view === undefined;

  const gate = await requireStaff();
  if (gatedView) {
    return NextResponse.json({ error: "Unknown export view." }, { status: 400 });
  }

  if (view) {
    const user = gate.ok ? gate.user : await getCurrentUser();
    if (!user || user.role !== "rep") {
      return NextResponse.json(
        { error: "This export belongs to a rep." },
        { status: 403 },
      );
    }
  } else if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

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

  const rangeProblem = instituteActivityExportRangeProblem(parsedRange.data);
  if (rangeProblem) {
    return NextResponse.json({ error: rangeProblem }, { status: 400 });
  }

  const rawSort = params.get("sort") ?? undefined;
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const result = view
    ? await buildInstituteActivityExport({
        range: parsedRange.data,
        sort: {
          key: isInstituteActivitySortKey(rawSort) ? rawSort : "institute",
          dir,
        },
        view,
      })
    : await buildInstituteStatusActivityExport({
        range: parsedRange.data,
        sort: {
          key: isStatusActivitySortKey(rawSort) ? rawSort : "institute",
          dir,
        },
        search: params.get("q") ?? undefined,
        member: params.get("member") ?? undefined,
        campus: params.get("campus") ?? undefined,
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
