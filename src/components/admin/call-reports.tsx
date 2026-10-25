import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { CallReport } from "@/lib/call-reports";

export function CallReportDetails({report}:{report:CallReport}){
  const entries:[string,string|number|null][]=[
    ["Rep",report.profiles?.name??null],["Institute",report.institutes?.name??null],
    ["Call date",formatDateTime(report.reported_at)],["Status",report.status_set_to],
    ["Expected Date",report.expected_date?formatDate(report.expected_date):null],
    ["Follow-up Date",report.follow_up_date?formatDate(report.follow_up_date):null],
    ["Number of Students",report.students_attended],["Topic Title",report.session_topic],
    ["Taken By",report.session_taken_by],["Next Action",report.next_action === "call" ? "Call" : report.next_action === "meeting" ? "Meeting" : null],
    ["Notes",report.call_notes],
    ...(report.custom_fields && typeof report.custom_fields === "object"
      ? Object.entries(report.custom_fields).map(([k, v]) => [k, String(v)] as [string, string])
      : []),
  ];
  return <Card className="p-5"><dl className="space-y-4">{entries.filter(([,v])=>v!==null).map(([label,value])=>
    <div key={label}><dt className="text-muted-foreground text-xs">{label}</dt><dd className="whitespace-pre-wrap text-sm">{value}</dd></div>
  )}</dl></Card>;
}
