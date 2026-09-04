import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { signVisitPhotos, type VisitPhoto } from "@/lib/photos";

/**
 * Everything the closing report needs to show, and everything it has already
 * been told.
 *
 * The header is read-only on purpose: the institute, the rep, the date and the
 * coordinates were all captured when the visit was logged, and asking again
 * would invite a second, disagreeing answer.
 */

export interface ReportPerson {
  id: string;
  name: string;
  contact_type: string;
  designation: string | null;
  contact_number: string | null;
  is_decision_maker: boolean;
}

export interface VisitReport {
  id: string;
  member: string;
  memberName: string | null;
  activity: string;
  lifecycle_status: string | null;
  date: string;
  expected_date: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  reported_at: string | null;
  photo: VisitPhoto | null;

  institute: {
    id: string;
    name: string;
    type: string;
    boards: string[];
    city: string | null;
    area: string | null;
    state: string | null;
  } | null;

  people: ReportPerson[];

  // The report itself. All null until it is filed.
  activities_conducted: string[] | null;
  session_topic: string | null;
  session_class: string | null;
  session_streams: string[] | null;
  students_attended: number | null;
  session_duration_mins: number | null;
  other_faculty_present: string | null;
  other_faculty_count: number | null;
  session_participation: string | null;
  student_questions: string | null;
  student_response: string | null;
  student_interest: number | null;
  management_response: string[] | null;
  management_feedback: string | null;
  discussion_summary: string | null;
  visit_outcome: string | null;
  applications_collected: number | null;
  admissions_generated: number | null;
  follow_up_action: string | null;
  follow_up_date: string | null;
  employee_remarks: string | null;
}

const REPORT_COLUMNS = `
  id, member, activity, lifecycle_status, date, expected_date, latitude, longitude,
  notes, photo_url, reported_at, institute_id,
  activities_conducted, session_topic, session_class, session_streams,
  students_attended, session_duration_mins, other_faculty_present,
  other_faculty_count, session_participation, student_questions,
  student_response, student_interest, management_response, management_feedback,
  discussion_summary, visit_outcome, applications_collected, admissions_generated,
  follow_up_action, follow_up_date, employee_remarks
`;

/** One visit, with its institute, its people and its photo. RLS-scoped. */
export async function getVisitReport(visitId: string): Promise<VisitReport | null> {
  const supabase = await createClient();

  const { data: visit, error } = await supabase
    .from("visits")
    .select(REPORT_COLUMNS)
    .eq("id", visitId)
    .maybeSingle();

  if (error) {
    logError("closing:visit", error);
    return null;
  }
  if (!visit) return null;

  const row = visit as unknown as Record<string, unknown> & {
    institute_id: string;
    member: string;
    photo_url: string | null;
  };

  const [instituteResult, memberResult, peopleResult, photos] = await Promise.all([
    supabase
      .from("institutes")
      .select("id, name, type, boards, city, area, state")
      .eq("id", row.institute_id)
      .maybeSingle(),
    supabase.from("profiles").select("name").eq("id", row.member).maybeSingle(),
    supabase
      .from("visit_people")
      .select("id, name, contact_type, designation, contact_number, is_decision_maker")
      .eq("visit_id", visitId)
      .order("created_at"),
    signVisitPhotos([row.photo_url]),
  ]);

  if (peopleResult.error) logError("closing:people", peopleResult.error);

  const value = <T>(key: string): T => row[key] as T;

  return {
    id: value("id"),
    member: row.member,
    memberName: memberResult.data?.name ?? null,
    activity: value("activity"),
    lifecycle_status: value("lifecycle_status"),
    date: value("date"),
    expected_date: value("expected_date"),
    latitude: value("latitude"),
    longitude: value("longitude"),
    notes: value("notes"),
    reported_at: value("reported_at"),
    photo: row.photo_url ? (photos.get(row.photo_url) ?? { status: "expired" }) : null,
    institute: instituteResult.data ?? null,
    people: peopleResult.data ?? [],
    activities_conducted: value("activities_conducted"),
    session_topic: value("session_topic"),
    session_class: value("session_class"),
    session_streams: value("session_streams"),
    students_attended: value("students_attended"),
    session_duration_mins: value("session_duration_mins"),
    other_faculty_present: value("other_faculty_present"),
    other_faculty_count: value("other_faculty_count"),
    session_participation: value("session_participation"),
    student_questions: value("student_questions"),
    student_response: value("student_response"),
    student_interest: value("student_interest"),
    management_response: value("management_response"),
    management_feedback: value("management_feedback"),
    discussion_summary: value("discussion_summary"),
    visit_outcome: value("visit_outcome"),
    applications_collected: value("applications_collected"),
    admissions_generated: value("admissions_generated"),
    follow_up_action: value("follow_up_action"),
    follow_up_date: value("follow_up_date"),
    employee_remarks: value("employee_remarks"),
  };
}

/** The team, for the admin's assign form. */
export async function listReps(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .order("name");

  if (error) {
    logError("closing:reps", error);
    return [];
  }
  return (data ?? []).map((p) => ({ id: p.id, name: p.name ?? "Unnamed member" }));
}
