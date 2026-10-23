import "server-only";
import { auditWindow } from "@/lib/audit-pagination";

import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { logError } from "@/lib/errors";

/**
 * Admin #4 / Rep #6 — the Owned / Missed / Closed follow-up cards.
 *
 * Three SQL HEAD counts and one optional 50-row page. Count and list use
 * the same filter builder; the pure classifier below supplies row labels.
 *
 * SCOPED BY RLS ONLY — no `.eq("member", ...)` here. `follow_up_tasks_select`
 * (migration 0038, rewritten by 0042 to `supervises(i.registered_by)`) is
 * what actually decides which rows come back: an admin reads the whole
 * team's, a rep reads their own. This function applies no filter of its own,
 * the same stance `getInstituteActivityModel()` already takes.
 *
 * "Owned" is every task not yet closed — `done_at is null` — which is a
 * SUPERSET of "Missed", not a third, disjoint bucket: an overdue follow-up is
 * still "currently assigned to a Rep" (the client's own words for Owned), it
 * is simply also late. "Closed" is the complement: `done_at is not null`.
 * Owned + Closed therefore always equals every row RLS returns.
 */

export type FollowUpCardStatus = "owned" | "missed" | "closed";

/** The agreed rule, and the only place it is written. */
export function classifyFollowUpTask(
  task: { dueDate: string; doneAt: string | null },
  today: string,
): FollowUpCardStatus {
  if (task.doneAt !== null) return "closed";
  if (task.dueDate < today) return "missed";
  return "owned";
}

export interface FollowUpCardCounts {
  owned: number;
  missed: number;
  closed: number;
}

export interface FollowUpCardItem {
  id: string;
  repName: string;
  instituteName: string;
  dueDate: string;
  /** Exactly one of "Owned", "Missed" or "Closed" — `classifyFollowUpTask()`, titled for display. */
  status: "Owned" | "Missed" | "Closed";
}

export interface FollowUpCardModel {
  counts: FollowUpCardCounts;
  /** Only the selected max-50 page; counts always cover the entire matching set. */
  items: FollowUpCardItem[];
}

interface RawTask {
  id: string;
  due_date: string;
  done_at: string | null;
  institutes: { name: string | null } | null;
  profiles: { name: string | null } | null;
}

const STATUS_LABEL: Record<FollowUpCardStatus, FollowUpCardItem["status"]> = {
  owned: "Owned",
  missed: "Missed",
  closed: "Closed",
};

export async function getFollowUpCardModel(status?: FollowUpCardStatus, requestedPage?: string): Promise<
  {ok: true; model: FollowUpCardModel; page: number; pages: number} | {ok: false; error: string}
> {
  const supabase = await createClient();
  const today = todayISO();
  const build = (state: FollowUpCardStatus,head: boolean) => {
    let q = supabase.from('follow_up_tasks').select(
      'id,due_date,done_at,institutes(name),profiles!follow_up_tasks_member_fkey(name)',
      {count:'exact',head});
    if (state === 'closed') q = q.not('done_at','is',null);
    else q = q.is('done_at',null);
    if (state === 'missed') q = q.lt('due_date',today);
    return q;
  };
  const states = ['owned','missed','closed'] as const;
  const counted = await Promise.all(states.map(state => build(state,true)));
  if (counted.some(result => result.error)) {
    logError('follow-up-cards:counts',counted.find(result => result.error)?.error);
    return {ok:false,error:'We could not load follow-up counts.'};
  }
  const counts = Object.fromEntries(states.map((state,index) => [state,counted[index].count ?? 0])) as unknown as FollowUpCardCounts;
  const window = auditWindow(requestedPage,status ? counts[status] : 0);
  const result = status && counts[status]
    ? await build(status,false).order('due_date').order('id').range(window.from,window.to)
    : {data:[],error:null};
  if (result.error) {
    logError('follow-up-cards:page',result.error);
    return {ok:false,error:'We could not load follow-ups.'};
  }
  const items = ((result.data ?? []) as unknown as RawTask[]).map(row => ({
    id:row.id,repName:row.profiles?.name ?? 'Unknown',instituteName:row.institutes?.name ?? 'Unknown',
    dueDate:row.due_date,status:STATUS_LABEL[classifyFollowUpTask({dueDate:row.due_date,doneAt:row.done_at},today)],
  }));
  return {ok:true,model:{counts,items},page:window.page,pages:window.pages};
}

/** The rows one card's "complete list" shows — Owned includes Missed. */
export function followUpCardItemsFor(
  items: readonly FollowUpCardItem[],
  status: FollowUpCardStatus,
): FollowUpCardItem[] {
  if (status === "owned") {
    return items.filter((item) => item.status === "Owned" || item.status === "Missed");
  }
  const label = STATUS_LABEL[status];
  return items.filter((item) => item.status === label);
}
