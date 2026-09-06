import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { activityLabelFor } from "@/lib/validation/visit";
import type { VisitReport } from "@/lib/closing-report";

/**
 * A filed closing report, read only.
 *
 * Shown to the rep who filed it and to any admin. Nobody edits one: the report
 * is an account of a particular day, and a record that can be revised later is
 * not much of a record.
 */
export function ReportView({ report }: { report: VisitReport }) {
  const row = (label: string, value: React.ReactNode) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="flex items-start justify-between gap-4 py-2">
        <dt className="text-muted-foreground shrink-0 text-sm">{label}</dt>
        <dd className="text-right text-sm break-words">{value}</dd>
      </div>
    );

  const chips = (values: string[] | null) =>
    values && values.length > 0 ? (
      <span className="flex flex-wrap justify-end gap-1.5">
        {values.map((value) => (
          <Badge key={value} variant="secondary">
            {value}
          </Badge>
        ))}
      </span>
    ) : null;

  const session = [
    report.session_topic,
    report.session_class && `class ${report.session_class}`,
    report.session_streams?.length ? report.session_streams.join(", ") : null,
    report.students_attended !== null ? `${report.students_attended} students` : null,
    report.students_reached !== null ? `${report.students_reached} reached` : null,
    report.session_duration_mins !== null ? `${report.session_duration_mins} min` : null,
    report.session_participation && `${report.session_participation} participation`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The visit</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-border divide-y">
            {row("Activity", activityLabelFor(report.activity))}
            {row("Date", formatDate(report.date))}
            {row("Rep", report.memberName)}
            {row("Institute", report.institute?.name)}
            {row(
              "Where",
              [report.institute?.area, report.institute?.city, report.institute?.state]
                .filter(Boolean)
                .join(", ") || null,
            )}
            {row("Boards", chips(report.institute?.boards ?? null))}
            {row(
              "Location",
              report.latitude !== null && report.longitude !== null
                ? `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`
                : "Not captured",
            )}
            {row(
              "Photo",
              report.photo ? (
                <span className="flex justify-end">
                  <VisitPhotoThumb
                    photo={report.photo}
                    caption={`${activityLabelFor(report.activity)} on ${formatDate(report.date)}`}
                  />
                </span>
              ) : (
                "None"
              ),
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happened</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-border divide-y">
            {row("Activities", chips(report.activities_conducted))}
            {row("Session", session || null)}
            {row("Questions asked", report.student_questions)}
            {row("Faculty present", report.other_faculty_present)}
            {row("Student response", report.student_response)}
            {row(
              "Student interest",
              report.student_interest !== null ? `${report.student_interest} / 5` : null,
            )}
            {row("Interested in", chips(report.most_interested_programs))}
            {row("Student intent", report.student_intent)}
            {row("Management response", chips(report.management_response))}
            {row("Management interest", report.management_interest)}
            {row("Management said", report.management_feedback)}
            {row("Primary outcome", report.primary_outcome)}
            {row("Outcome", report.visit_outcome)}
            {row(
              "Applications collected",
              report.applications_collected !== null ? report.applications_collected : null,
            )}
            {row(
              "Admissions",
              report.admissions_generated !== null ? report.admissions_generated : null,
            )}
            {row(
              "Follow-up",
              report.follow_up_action
                ? `${report.follow_up_action}${report.follow_up_date ? ` by ${formatDate(report.follow_up_date)}` : ""}`
                : null,
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">In their words</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-muted-foreground text-xs">Discussion</p>
            <p className="mt-1 text-sm whitespace-pre-wrap">
              {report.discussion_summary ?? "—"}
            </p>
          </div>
          {report.employee_remarks && (
            <div>
              <p className="text-muted-foreground text-xs">Remarks</p>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {report.employee_remarks}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            People met
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {report.people.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.people.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody was recorded.</p>
          ) : (
            <ul className="space-y-2">
              {report.people.map((person) => (
                <li
                  key={person.id}
                  className="border-border flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{person.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {person.contact_type}
                      {person.designation ? ` · ${person.designation}` : ""}
                      {person.contact_number ? ` · ${person.contact_number}` : ""}
                    </p>
                  </div>
                  {person.is_decision_maker && (
                    <Badge variant="success" className="shrink-0">
                      Decides
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
