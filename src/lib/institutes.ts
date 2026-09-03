import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import type { InstituteStatus, InstituteType } from "@/lib/validation/institute";

export interface Institute {
  id: string;
  name: string;
  type: InstituteType;
  pincode: string | null;
  address: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  boards: string[];
  principal_name: string | null;
  principal_mobile: string | null;
  decision_maker_name: string | null;
  decision_maker_designation: string | null;
  decision_maker_mobile: string | null;
  class11: string[];
  class12: Record<string, number>;
  status: InstituteStatus | null;
  status_updated_at: string | null;
  created_at: string;
}

const COLUMNS = `
  id, name, type, pincode, address, area, city, state, boards,
  principal_name, principal_mobile,
  decision_maker_name, decision_maker_designation, decision_maker_mobile,
  class11, class12, status, status_updated_at, created_at
`;

/**
 * Every institute. The registry is shared — the RLS select policy is `true` —
 * so reps and admins see the same list.
 *
 * Loaded whole and filtered in the browser. At this scale that is the right
 * trade: a few hundred rows is a small payload, and search and filters respond
 * instantly with no round trip, which matters on a phone. If the registry ever
 * grows past a few thousand this should move to server-side filtering.
 */
export async function listInstitutes(): Promise<
  { ok: true; institutes: Institute[] } | { ok: false }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institutes")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    logError("institutes:list", error);
    return { ok: false };
  }
  return { ok: true, institutes: (data ?? []) as unknown as Institute[] };
}

export async function getInstitute(id: string): Promise<Institute | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institutes")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logError("institutes:get", error);
    return null;
  }
  return (data as unknown as Institute) ?? null;
}

export interface VisitSummary {
  id: string;
  activity: string;
  lifecycle_status: string | null;
  date: string;
  notes: string | null;
  member: string;
  memberName: string | null;
}

/**
 * The institute's visit history.
 *
 * Scoped by RLS, not by us: a rep sees only their own visits here, an admin
 * sees the whole team's. Member names are fetched separately rather than as an
 * embedded join, so this does not depend on PostgREST inferring the right
 * relationship.
 */
export async function getInstituteVisits(
  instituteId: string,
): Promise<{ ok: true; visits: VisitSummary[] } | { ok: false }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("visits")
    .select("id, activity, lifecycle_status, date, notes, member")
    .eq("institute_id", instituteId)
    .order("date", { ascending: false });

  if (error) {
    logError("institutes:visits", error);
    return { ok: false };
  }

  const rows = data ?? [];
  const memberIds = [...new Set(rows.map((r) => r.member))];

  const names = new Map<string, string | null>();
  if (memberIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", memberIds);

    if (profileError) {
      // Names are decoration; the history is still worth showing without them.
      logError("institutes:visit-members", profileError);
    }
    for (const p of profiles ?? []) names.set(p.id, p.name);
  }

  return {
    ok: true,
    visits: rows.map((r) => ({
      ...r,
      memberName: names.get(r.member) ?? null,
    })),
  };
}
