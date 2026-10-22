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
  custom_fields?: Record<string, string> | null;
  profiles:{name:string|null}|null; institutes:{name:string;status:string|null}|null;
}

const columns = "id, member, institute_id, reported_at, status_set_to, expected_date, follow_up_date, students_attended, session_topic, session_taken_by, call_notes, next_action, note, due_date, custom_fields, profiles!follow_up_tasks_member_fkey(name), institutes!inner(name,status)";

export async function listCallReports(filters: VisitFilters = {}): Promise<CallReport[]> {
  if (filters.activity || filters.reported === "unreported" || filters.lifecycle || filters.visitStatus === "__none__") return [];
  const db=await createClient();
  const categoryStatuses = filters.statusCategory
    ? (await listStatusCatalogue()).filter(s=>s.category===filters.statusCategory).map(s=>s.status) : null;
  if(categoryStatuses?.length===0)return [];
  const all:CallReport[]=[];
  for(let offset=0;;offset+=1000){
    let query=db.from("follow_up_tasks").select(columns).eq("kind","call")
      .not("reported_at","is",null).order("reported_at",{ascending:false}).order("id")
      .range(offset,offset+999);
    if(filters.member)query=query.eq("member",filters.member);
    if(filters.institute)query=query.eq("institute_id",filters.institute);
    if(filters.from)query=query.gte("reported_at",istDayStart(filters.from)!);
    if(filters.to)query=query.lt("reported_at",istDayAfter(filters.to)!);
    if(filters.visitStatus)query=query.eq("status_set_to",filters.visitStatus);
    if(filters.instituteStatus)query=query.eq("institutes.status",filters.instituteStatus);
    if(categoryStatuses)query=query.in("status_set_to",categoryStatuses);
    const {data,error}=await query;
    if(error)throw new Error("We could not load Call Reports.");
    all.push(...(data as unknown as CallReport[]));
    if(data.length<1000)return all;
  }
}

export async function getCallReport(id:string):Promise<CallReport|null>{
  const db=await createClient();
  const {data,error}=await db.from("follow_up_tasks").select(columns).eq("id",id)
    .eq("kind","call").not("reported_at","is",null).maybeSingle();
  if(error)throw new Error("We could not load this Call Report.");
  return data as unknown as CallReport|null;
}
