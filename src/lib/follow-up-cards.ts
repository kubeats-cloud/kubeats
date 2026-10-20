import "server-only";

import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { logError } from "@/lib/errors";

/**
 * Admin #4 / Rep #6 — the Owned / Missed / Closed follow-up cards.
 *
 * ONE QUERY, ONE CLASSIFIER, so there is exactly one definition of each
 * bucket anywhere in the app: `classifyFollowUpTask()` below. The cards'
 * counts and "the complete list" each card opens both read this same model,
 * so a count and the rows behind it cannot disagree.
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
  /** Every row visible under RLS, in every bucket — callers filter by `.status`. */
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

export async function getFollowUpCardModel(): Promise<
  { ok: true; model: FollowUpCardModel } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const today = todayISO();

  const { data, error } = await supabase
    .from("follow_up_tasks")
    .select(
      "id, due_date, done_at, institutes(name), profiles!follow_up_tasks_member_fkey(name)",
    )
    .order("due_date", { ascending: true });

  if (error) {
    logError("follow-up-cards:list", error);
    return {
      ok: false,
      error: "We could not load follow-ups just now. Please try again in a moment.",
    };
  }

  const rows = (data ?? []) as unknown as RawTask[];

  const counts: FollowUpCardCounts = { owned: 0, missed: 0, closed: 0 };
  const items: FollowUpCardItem[] = rows.map((row) => {
    const bucket = classifyFollowUpTask(
      { dueDate: row.due_date, doneAt: row.done_at },
      today,
    );
    if (bucket === "closed") {
      counts.closed += 1;
    } else {
      // Owned counts every unclosed row; Missed is the overdue subset of it.
      counts.owned += 1;
      if (bucket === "missed") counts.missed += 1;
    }
    return {
      id: row.id,
      repName: row.profiles?.name ?? "Unknown",
      instituteName: row.institutes?.name ?? "Unknown",
      dueDate: row.due_date,
      status: STATUS_LABEL[bucket],
    };
  });

  return { ok: true, model: { counts, items } };
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
