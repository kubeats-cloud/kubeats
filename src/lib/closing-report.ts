import "server-only";
import { areaFor } from "@/lib/place-cache";

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
  /**
   * The approximate area those coordinates fall in, recovered from the shared
   * place cache. Null when nobody ever looked that square up, which the view
   * renders as "Area unavailable".
   *
   * It is NOT the institute's registered address — that is institute.area, a
   * different fact about a different thing, and the two are labelled so they
   * cannot be read as one.
   */
  area: string | null;
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
    /**
     * WHO TO ASK FOR AT THIS SCHOOL, carried since change #17.
     *
     * The per-visit "Who did you meet?" pair is withdrawn, so a report filed
     * from now on records no person of its own. These four are the institute's
     * standing contacts, captured once at registration, and they are what the
     * report's People card shows instead — clearly labelled as the school's
     * contacts rather than as somebody met on the day, because that is a
     * different claim and conflating the two would invent a fact.
     */
    principal_name: string | null;
    principal_mobile: string | null;
    decision_maker_name: string | null;
    decision_maker_designation: string | null;
    decision_maker_mobile: string | null;
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
  students_reached: number | null;
  student_response: string | null;
  student_interest: number | null;
  most_interested_programs: string[] | null;
  student_intent: string | null;
  management_response: string[] | null;
  management_feedback: string | null;
  management_interest: string | null;
  discussion_summary: string | null;
  visit_outcome: string | null;
  primary_outcome: string | null;
  applications_collected: number | null;
  admissions_generated: number | null;
  follow_up_action: string | null;
  follow_up_date: string | null;
  employee_remarks: string | null;

  /**
   * The one person the SHORT form recorded, between 0022 and change #17.
   *
   * DORMANT NOW, AND STILL READ. The form no longer asks and `close_visit()`
   * is passed null, so every report filed from now on has both null — but the
   * months of reports that DO carry a name still render one, which is the whole
   * reason the columns were left in place rather than dropped.
   *
   * Deliberately not `visit_people`. That table belongs to the retired long
   * report and nothing has written a row to it since; reading only it is why
   * every report filed by the short form said "Nobody was recorded" while the
   * name sat in this column.
   */
  met_name: string | null;
  met_phone: string | null;
}

const REPORT_COLUMNS = `
  id, member, activity, lifecycle_status, date, expected_date, latitude, longitude,
  notes, photo_url, reported_at, institute_id,
  activities_conducted, session_topic, session_class, session_streams,
  students_attended, session_duration_mins, other_faculty_present,
  other_faculty_count, session_participation, student_questions, students_reached,
  student_response, student_interest, most_interested_programs, student_intent,
  management_response, management_feedback, management_interest,
  discussion_summary, visit_outcome, primary_outcome,
  applications_collected, admissions_generated,
  follow_up_action, follow_up_date, employee_remarks,
  met_name, met_phone
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
      // ONE LITERAL, not a concatenation: supabase-js infers the row type from
      // the select string itself, and a built-up string infers as `never`.
      .select(
        "id, name, type, boards, city, area, state, principal_name, principal_mobile, decision_maker_name, decision_maker_designation, decision_maker_mobile",
      )
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

  // Cache read only. Never a fresh geocode from a page load.
  const area = await areaFor(
    value<number | null>("latitude"),
    value<number | null>("longitude"),
  );

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
    area,
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
    students_reached: value("students_reached"),
    student_response: value("student_response"),
    student_interest: value("student_interest"),
    most_interested_programs: value("most_interested_programs"),
    student_intent: value("student_intent"),
    management_response: value("management_response"),
    management_feedback: value("management_feedback"),
    management_interest: value("management_interest"),
    discussion_summary: value("discussion_summary"),
    visit_outcome: value("visit_outcome"),
    primary_outcome: value("primary_outcome"),
    applications_collected: value("applications_collected"),
    admissions_generated: value("admissions_generated"),
    follow_up_action: value("follow_up_action"),
    follow_up_date: value("follow_up_date"),
    employee_remarks: value("employee_remarks"),
    met_name: value("met_name"),
    met_phone: value("met_phone"),
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
