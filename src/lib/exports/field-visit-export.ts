import "server-only";

import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, type CellValue } from "@/lib/xlsx";
import { formatTime, istDayStart, istDayAfter } from "@/lib/dates";
import { areasFor } from "@/lib/place-cache";
import { cellFor } from "@/lib/places";
import type { ExportRange, ExportResult } from "@/lib/exports/activity-export";

export async function buildFieldVisitExport({ start, end }: ExportRange): Promise<ExportResult> {
  const supabase = await createClient();
  const rows: CellValue[][] = [["Institution Name", "Check-In Date", "Check-In Time", "Check-Out Time", "Location"]];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("daily_plans")
      .select("id, checkin_at, checkout_at, checkin_lat, checkin_lng, institutes(name)")
      .gte("checkin_at", istDayStart(start)!)
      .lt("checkin_at", istDayAfter(end)!)
      .order("checkin_at").order("id")
      .range(offset, offset + 999);
    if (error) return { ok: false, error: "We could not load field visits for this date range." };
    const areas = await areasFor((data ?? []).map((row) => ({ latitude: row.checkin_lat, longitude: row.checkin_lng })));
    const exported = (data ?? []).map((row) => {
      const institute = row.institutes as unknown as { name: string } | null;
      const area = row.checkin_lat != null && row.checkin_lng != null
        ? areas.get(cellFor(row.checkin_lat, row.checkin_lng)) : null;
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(row.checkin_at));
      const location = area ?? (row.checkin_lat != null && row.checkin_lng != null
        ? `${row.checkin_lat}, ${row.checkin_lng}` : "Location unavailable");
      return [institute?.name ?? "Unknown institution", date, formatTime(row.checkin_at),
        row.checkout_at ? formatTime(row.checkout_at) : "", location];
    });
    rows.push(...exported);
    if (!data || data.length < 1000) break;
  }
  return {
    ok: true, filename: `field-visits-${start}_${end}.xlsx`,
    bytes: buildWorkbook({ name: "Field Visit Report", rows, boldRows: [0], freezeRows: 1,
      widths: [35, 20, 20, 20, 45] }),
  };
}
