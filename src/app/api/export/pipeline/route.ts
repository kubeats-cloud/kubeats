import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin";
import { buildPipelineExport } from "@/lib/exports/pipeline-export";
import { pipelineRangeSchema } from "@/lib/validation/pipeline-report";

/**
 * Pipeline by Rep's Excel export — NEW with the Activity tab.
 *
 * ⚠ THE SCREEN HAD NO EXPORT BEFORE THIS. `/institutes/report` has never
 * offered a download; the Activity tab's brief explicitly allows adding one
 * "only if it has none today... reuse the on-screen query" — this route does
 * exactly that: `buildPipelineExport()` calls the same `getInstituteStatusModel()`
 * the screen renders, nothing new is counted, and the gate matches every
 * other export here (`requireStaff`, same as the screen's own page).
 *
 * Same optional, uncapped range as the screen — see `pipelineRangeSchema`'s
 * own header for why: the report's contract is "right now", so an empty
 * range exports the whole pipeline rather than defaulting to a month.
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

  const result = await buildPipelineExport({
    range: parsedRange.data,
    sort: {
      key: params.get("sort") ?? undefined,
      dir: params.get("dir") ?? undefined,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Copied into a fresh ArrayBuffer — same stance as every other export route
  // here, see /api/export/activity for why a view onto a larger buffer must
  // not be handed to Response directly.
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
