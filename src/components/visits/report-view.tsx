import { Badge } from "@/components/ui/badge";
import { formatArea, formatCoordinates } from "@/lib/location-display";
import { formatDate } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { activityLabelFor } from "@/lib/validation/visit";
import { hasCampusVisit, hasSession } from "@/lib/validation/closing-report";
import { discussionOf, metPersonOf } from "@/lib/report-display";
import type { VisitReport } from "@/lib/closing-report";

/**
 * A filed closing report, read only.
 *
 * Shown to the rep who filed it and to any admin. Nobody edits one: the report
 * is an account of a particular day, and a record that can be revised later is
 * not much of a record.
 */
export function ReportView({ report }: { report: VisitReport }) {
  const coords = formatCoordinates(report.latitude, report.longitude);

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
    report.session_duration_mins !== null ? `${report.session_duration_mins} min` : null,
    report.session_participation && `${report.session_participation} participation`,
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * The head count has its own row rather than sitting inside the "Session"
   * line, because it is no longer only a session's number: a campus visit
   * fills the same field. On a campus visit with no session it would otherwise
   * have printed as "Session: 40 students" against a report that had no
   * session in it.
   */
  const done = report.activities_conducted ?? [];

  /**
   * WHICH ERA FILED THIS, because the second count means opposite things in
   * the two.
   *
   * `activities_conducted` was always required by the retired long report and
   * is never written by the short one, so a non-empty list is the marker for a
   * report filed before 0022. In that era `students_reached` was the WIDER
   * number — "reached overall, often more than attended" (0009). Since 0022 it
   * is the NARROWER one: how many of those present took part.
   *
   * So the labels are chosen per report rather than globally. Relabelling an
   * old row "participated" would put a number under a word it does not mean,
   * which is worse than the slightly dated wording it keeps instead.
   */
  const richEra = done.length > 0;

  /**
   * Both of these are two-era reads — see report-display.ts for which column
   * each form writes. The short form records ONE person on the visit row;
   * `visit_people` holds the long report's list. A report has one or the other,
   * never both, but rendering both costs nothing and means neither era comes
   * out blank.
   */
  const discussion = discussionOf(report);
  const metPerson = metPersonOf(report);
  const peopleMet = report.people.length + (metPerson ? 1 : 0);

  /**
   * The school's own contacts, for reports filed since change #17.
   *
   * The per-visit "Who did you meet?" pair is withdrawn, so a new report
   * records nobody of its own and this card would otherwise read "Nobody was
   * recorded" on every report for ever — which is true of the VISIT and useless
   * to the admin reading it, who wants to know who to ring.
   *
   * Shown only when the visit itself names nobody, and under its own heading:
   * the institute's standing contacts are a different claim from "this rep met
   * this person that afternoon", and presenting one as the other would invent a
   * fact nobody recorded. Older reports that DO name someone are unchanged.
   */
  const instituteContacts = [
    {
      name: report.institute?.decision_maker_name ?? null,
      detail: report.institute?.decision_maker_designation ?? "Decision maker",
      phone: report.institute?.decision_maker_mobile ?? null,
    },
    {
      name: report.institute?.principal_name ?? null,
      detail: "Principal",
      phone: report.institute?.principal_mobile ?? null,
    },
  ].filter((c): c is { name: string; detail: string; phone: string | null } =>
    Boolean(c.name),
  );
  const presentLabel = richEra
    ? hasCampusVisit(done) && !hasSession(done)
      ? "Students who visited"
      : "Students attended"
    : "Students present";
  const secondCountLabel = richEra ? "Students reached" : "Students who participated";

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
            {/* The school's registered address, from the institute record. It
                sits with the other institute facts and is labelled for what it
                is: it is NOT evidence of where anybody stood, and it used to be
                called "Where" directly above the GPS row, which read as though
                the two were the same claim. */}
            {row(
              "Institute address",
              [report.institute?.area, report.institute?.city, report.institute?.state]
                .filter(Boolean)
                .join(", ") || null,
            )}
            {row("Boards", chips(report.institute?.boards ?? null))}
            {/* Where the phone actually was: exact coordinates, and the
                approximate area they fall in. Nothing else belongs here. */}
            {row(
              "GPS location",
              coords ? (
                <span className="block text-right">
                  <span className="block tabular-nums">{coords}</span>
                  <span className="text-muted-foreground block text-xs">
                    {formatArea(report.area)}
                  </span>
                </span>
              ) : (
                "Not captured"
              ),
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
            {row(presentLabel, report.students_attended)}
            {row(secondCountLabel, report.students_reached)}
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
            <p className="mt-1 text-sm whitespace-pre-wrap">{discussion ?? "—"}</p>
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
              {peopleMet}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {peopleMet === 0 ? (
            instituteContacts.length > 0 ? (
              <>
                <p className="text-muted-foreground mb-2 text-xs">
                  This visit recorded nobody. The institute&rsquo;s contacts:
                </p>
                <ul className="space-y-2">
                  {instituteContacts.map((contact) => (
                    <li
                      key={contact.detail}
                      className="border-border flex items-start justify-between gap-3 rounded-md border border-dashed px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{contact.name}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {contact.detail}
                          {contact.phone ? ` · ${contact.phone}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Nobody was recorded.</p>
            )
          ) : (
            <ul className="space-y-2">
              {metPerson && (
                <li className="border-border flex items-start justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{metPerson.name}</p>
                    {/* Optional means "may be absent", never "may be wrong":
                        a number that IS here has passed visits_met_phone_valid,
                        and one that is not simply leaves the line off. */}
                    {metPerson.phone && (
                      <p className="text-muted-foreground truncate text-xs tabular-nums">
                        {metPerson.phone}
                      </p>
                    )}
                  </div>
                </li>
              )}
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
