import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { signVisitPhotos, type VisitPhoto } from "@/lib/photos";
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
  /** Null when the visit never had a photo; "expired" when the file is gone. */
  photo: VisitPhoto | null;
  /** The closing report, when one has been filed. */
  reportedAt: string | null;
  activitiesConducted: string[] | null;
  studentsAttended: number | null;
  studentResponse: string | null;
  managementResponse: string[] | null;
  visitOutcome: string | null;
  followUpAction: string | null;
  followUpDate: string | null;
  discussionSummary: string | null;
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
    .select(
      "id, activity, lifecycle_status, date, notes, member, photo_url, reported_at, activities_conducted, students_attended, student_response, management_response, visit_outcome, institute_interested, follow_up_action, follow_up_date, discussion_summary",
    )
    .eq("institute_id", instituteId)
    .order("date", { ascending: false });

  if (error) {
    logError("institutes:visits", error);
    return { ok: false };
  }

  const rows = data ?? [];
  const memberIds = [...new Set(rows.map((r) => r.member))];

  // Signed on the caller's own session, so RLS decides whose photos resolve.
  const photos = await signVisitPhotos(rows.map((r) => r.photo_url));

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
      id: r.id,
      activity: r.activity,
      lifecycle_status: r.lifecycle_status,
      date: r.date,
      notes: r.notes,
      member: r.member,
      memberName: names.get(r.member) ?? null,
      photo: r.photo_url ? (photos.get(r.photo_url) ?? { status: "expired" }) : null,
      reportedAt: r.reported_at,
      activitiesConducted: r.activities_conducted,
      studentsAttended: r.students_attended,
      studentResponse: r.student_response,
      managementResponse: r.management_response,
      // visit_outcome is collected again, so it leads; institute_interested
      // stands behind it for a report that left the outcome blank.
      visitOutcome:
        r.visit_outcome ??
        (r.institute_interested === null
          ? null
          : r.institute_interested
            ? "Interested"
            : "Not interested"),
      followUpAction: r.follow_up_action,
      followUpDate: r.follow_up_date,
      discussionSummary: r.discussion_summary,
    })),
  };
}

export interface StatusChange {
  id: string;
  status: InstituteStatus;
  changedAt: string;
  changedBy: string | null;
  /** Null when RLS hides that profile — a rep may only read their own. */
  changedByName: string | null;
  /** The visit that caused it, when one did. */
  visitId: string | null;
}

/**
 * The institute's status journey, newest first (migration 0011).
 *
 * Readable by everyone: institute_status_history_select is `using (true)`,
 * like the registry itself. "This school went cold in March" is a fact about
 * the school, not about the rep who recorded it, and the next person to pick
 * it up needs it.
 *
 * The open/closed category is deliberately not selected — it is not stored.
 * Derive it with statusCategory() from the shared catalogue, so this feature
 * cannot become a second opinion about which statuses are closed.
 */
export async function getInstituteStatusHistory(
  instituteId: string,
): Promise<{ ok: true; changes: StatusChange[] } | { ok: false }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("institute_status_history")
    .select("id, status, changed_at, changed_by, visit_id")
    .eq("institute_id", instituteId)
    .order("changed_at", { ascending: false });

  if (error) {
    logError("institutes:status-history", error);
    return { ok: false };
  }

  const rows = data ?? [];
  const changerIds = [
    ...new Set(rows.map((r) => r.changed_by).filter((id): id is string => Boolean(id))),
  ];

  const names = new Map<string, string>();
  if (changerIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", changerIds);

    if (profileError) {
      // Names are decoration; the journey still reads without them.
      logError("institutes:status-history-members", profileError);
    }
    for (const p of profiles ?? []) names.set(p.id, p.name);
  }

  return {
    ok: true,
    changes: rows.map((r) => ({
      id: r.id,
      status: r.status as InstituteStatus,
      changedAt: r.changed_at,
      changedBy: r.changed_by,
      changedByName: r.changed_by ? (names.get(r.changed_by) ?? null) : null,
      visitId: r.visit_id,
    })),
  };
}
