import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { buildWorkbook } from "@/lib/xlsx";
import {
  shapeRpcPayload,
  type CallActivityFilters,
  type RpcPayload,
} from "@/lib/call-activity-report";
import {
  buildCallActivitySheet,
  callActivityExportFilename,
} from "@/lib/exports/call-activity-grid";

/**
 * The Call Activity Report's .xlsx — its own route, its own file name,
 * never `activity-export.ts`'s (the client's Visit/Activity template).
 *
 * ONE RPC CALL, NOT A LOOP. `call_activity_report()` already has an "export"
 * mode — `p_page < 1` returns every matching rep in one answer instead of
 * 50 at a time (the same convention `audit_institute_activity`, 0055-0060,
 * uses for its own Excel route) — so this asks for that rather than paging
 * through the screen's own 50-at-a-time endpoint in a loop. One round trip,
 * and the worker never holds a single `follow_up_tasks` row — only the
 * per-rep counts the RPC already aggregated in SQL.
 *
 * THE SAME 31-DAY CAP THE RPC ALREADY ENFORCES for export mode (0064,
 * mirroring 0055-0060's own Excel routes) — not the plain `/api/export/
 * activity` route's 400-day guard, which belongs to a different report and
 * is not "the other exports" this one was built to match. Followed here by
 * DEFAULTING the range to the last 31 days ending today when the reader
 * applied no date filter at all, rather than refusing a download that
 * simply never set one.
 */
const EXPORT_MAX_DAYS = 31;
const DAY_MS = 86_400_000;

function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export async function buildCallActivityExport(
  filters: CallActivityFilters,
): Promise<
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; error: string }
> {
  // "No date filter set" means neither end was given — a half-set range
  // (only `from` or only `to`) is a real, if incomplete, request and is left
  // for the RPC's own "Choose a From and To date" refusal rather than
  // guessed at here.
  let from = filters.from;
  let to = filters.to;
  if (!from && !to) {
    to = todayISO();
    from = daysBefore(to, EXPORT_MAX_DAYS - 1);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("call_activity_report", {
    p_from: from ?? null,
    p_to: to ?? null,
    p_member: filters.member ?? null,
    p_institute: filters.institute ?? null,
    p_status: filters.status ?? null,
    p_sort: "rep",
    p_desc: false,
    // Export mode: every matching rep, not one page of 50.
    p_page: 0,
  });

  if (error) {
    if (error.code === "42501") {
      return {
        ok: false,
        error: "Only an admin or a team lead can download the Call Activity Report.",
      };
    }
    // The RPC's own 22023 refusals (no range, inverted range, over 31 days)
    // already read as a complete sentence — passed through rather than
    // rewritten, the same way `audit_institute_activity`'s callers do.
    return { ok: false, error: error.message || "We could not build the Call Activity Report just now." };
  }

  const model = shapeRpcPayload(data as RpcPayload);

  // One bounded, single-row lookup — cheap, and the only extra read this
  // export makes beyond the one RPC call.
  let repLabel: string | null = null;
  if (filters.member) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", filters.member)
      .maybeSingle();
    repLabel = profile?.name ?? null;
  }

  const sheet = buildCallActivitySheet(model.reps, model.columns, model.totals, {
    from: from!,
    to: to!,
    repLabel,
    institute: filters.institute ?? null,
    status: filters.status ?? null,
  });

  return {
    ok: true,
    bytes: buildWorkbook(sheet),
    filename: callActivityExportFilename(from!, to!, repLabel),
  };
}

