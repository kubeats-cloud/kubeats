import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { CallReport } from "@/lib/call-reports";

export function CallReports({reports}:{reports:CallReport[]}){
  return <div className="mb-6 space-y-3">{reports.map(report=><Card key={report.id} className="gap-2 p-4">
    <Badge variant="secondary">Call Report</Badge>
    <p className="font-medium">{report.institutes?.name}</p>
    <p className="text-muted-foreground text-sm">{report.profiles?.name} · {formatDateTime(report.reported_at)}</p>
    <p className="text-sm">{report.status_set_to}</p>
    {report.call_notes&&<p className="line-clamp-2 text-sm whitespace-pre-wrap">{report.call_notes}</p>}
    <Button asChild variant="outline" className="w-fit"><Link href={`/review/${report.id}?kind=call`}>Open full Call Report</Link></Button>
  </Card>)}</div>;
}

export function CallReportDetails({report}:{report:CallReport}){
  const entries:[string,string|number|null][]=[
    ["Rep",report.profiles?.name??null],["Institute",report.institutes?.name??null],
    ["Call date",formatDateTime(report.reported_at)],["Status",report.status_set_to],
    ["Expected Date",report.expected_date?formatDate(report.expected_date):null],
    ["Follow-up Date",report.follow_up_date?formatDate(report.follow_up_date):null],
    ["Number of Students",report.students_attended],["Topic Title",report.session_topic],
    ["Taken By",report.session_taken_by],["Next Action",report.next_action === "call" ? "Call" : report.next_action === "meeting" ? "Meeting" : null],
    ["Notes",report.call_notes],
  ];
  return <Card className="p-5"><dl className="space-y-4">{entries.filter(([,v])=>v!==null).map(([label,value])=>
    <div key={label}><dt className="text-muted-foreground text-xs">{label}</dt><dd className="whitespace-pre-wrap text-sm">{value}</dd></div>
  )}</dl></Card>;
}
