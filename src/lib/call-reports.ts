import "server-only";
import { createClient } from "@/lib/supabase/server";
import { istDayStart, istDayAfter } from "@/lib/dates";
import type { VisitFilters } from "@/lib/admin-workspace";
import { listStatusCatalogue } from "@/lib/statuses";

export interface CallReport {
  id:string; member:string; institute_id:string; reported_at:string;
  status_set_to:string|null; expected_date:string|null; follow_up_date:string|null;
  students_attended:number|null; session_topic:string|null; session_taken_by:string|null;
  call_notes:string|null; next_action:string|null; note:string|null; due_date:string;
  /** How this task ended: done / no_answer / rescheduled / cancelled. Admin-editable (0063). */
  outcome:string|null;
  custom_fields?: Record<string, string> | null;
  profiles:{name:string|null}|null; institutes:{name:string;status:string|null}|null;
}

const columns = "id, member, institute_id, reported_at, status_set_to, expected_date, follow_up_date, students_attended, session_topic, session_taken_by, call_notes, next_action, note, due_date, outcome, custom_fields, profiles!follow_up_tasks_member_fkey(name), institutes!inner(name,status)";

export interface CallReportPage {
  reports: CallReport[];
  total: number;
}

export async function listCallReports(
  filters: VisitFilters = {},
  limit = 50,
): Promise<({ ok: true } & CallReportPage) | { ok: false }> {
  if (filters.activity && filters.activity !== "call") {
    return { ok: true, reports: [], total: 0 };
  }
  const db=await createClient();
  const categoryStatuses = filters.statusCategory && !filters.visitStatus
    ? (await listStatusCatalogue()).filter(s=>s.category===filters.statusCategory).map(s=>s.status) : null;
  if(categoryStatuses?.length===0)return { ok: true, reports: [], total: 0 };
  const build=(head:boolean)=>{
    let query=db.from("follow_up_tasks").select(columns,{count:"exact",head}).eq("kind","call")
      .not("reported_at","is",null);
    if(filters.member)query=query.eq("member",filters.member);
    if(filters.institute)query=query.eq("institute_id",filters.institute);
    if(filters.from)query=query.gte("reported_at",istDayStart(filters.from)!);
    if(filters.to)query=query.lt("reported_at",istDayAfter(filters.to)!);
    if(filters.visitStatus==="__none__")query=query.is("status_set_to",null);
    else if(filters.visitStatus)query=query.eq("status_set_to",filters.visitStatus);
    else if(categoryStatuses)query=query.in("status_set_to",categoryStatuses);
    if(filters.instituteStatus)query=query.eq("institutes.status",filters.instituteStatus);
    return query;
  };
  const counted=await build(true);
  if(counted.error)return { ok: false };
  const total=counted.count??0;
  if(total===0)return { ok: true, reports: [], total: 0 };
  const {data,error}=await build(false).order("reported_at",{ascending:false}).order("id")
    .range(0,Math.max(0,limit-1));
  if(error)return { ok: false };
  return { ok: true, reports: data as unknown as CallReport[], total };
}

export async function getCallReport(id:string):Promise<CallReport|null>{
  const db=await createClient();
  const {data,error}=await db.from("follow_up_tasks").select(columns).eq("id",id)
    .eq("kind","call").not("reported_at","is",null).maybeSingle();
  if(error)throw new Error("We could not load this Call Report.");
  return data as unknown as CallReport|null;
}
