import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { PageColumn } from "@/components/layout/page-column";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, HistoryIcon, MilestoneIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { EmptyState, ErrorState } from "@/components/states";
import { InstituteStatusBadge } from "@/components/institutes/status-badge";
import { StatusTimeline } from "@/components/institutes/status-timeline";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import {
  getInstitute,
  getInstituteStatusHistory,
  getInstituteVisits,
} from "@/lib/institutes";
import { activityLabel } from "@/lib/activities";
import { listStatusCatalogue } from "@/lib/statuses";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listRepsForCampus } from "@/lib/admin";
import { ReassignOwner } from "@/components/institutes/reassign-owner";
import { class12Total, STREAMS, TYPE_LABELS } from "@/lib/validation/institute";

export const metadata = { title: "Institute" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-muted-foreground shrink-0 text-sm">{label}</dt>
      <dd className="text-right text-sm break-words">{children}</dd>
    </div>
  );
}

/** Mobile numbers are tappable — a rep is holding a phone. */
function Phone({ number }: { number: string | null }) {
  if (!number) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={`tel:${number}`} className="text-primary underline-offset-2 hover:underline">
      {number}
    </a>
  );
}

export default async function InstituteDetailPage(
  props: PageProps<"/institutes/[id]">,
) {
  const { id } = await props.params;
  const institute = await getInstitute(id);
  if (!institute) notFound();

  const admin = isAdmin(await getCurrentUser());

  // Independent reads, so the slower one does not hold up the others. The reps
  // list is fetched for an ADMIN only: it is the reassign picker's, and a rep
  // has nothing to reassign.
  const [history, statusHistory, catalogue, reps] = await Promise.all([
    getInstituteVisits(id),
    getInstituteStatusHistory(id),
    listStatusCatalogue(),
    admin ? listRepsForCampus(institute.campus_id) : Promise.resolve([]),
  ]);
  const total = class12Total(institute.class12);

  return (
    <PageColumn>
      <PageHeader
        title={institute.name}
        description={[institute.area, institute.city, institute.state]
          .filter(Boolean)
          .join(", ")}
        action={
          <Button asChild variant="ghost" className="h-11">
            <Link href="/institutes">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Back
            </Link>
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <InstituteStatusBadge status={institute.status} catalogue={catalogue} />
        <Badge variant="secondary">{TYPE_LABELS[institute.type]}</Badge>
        {institute.status_updated_at && (
          <span className="text-muted-foreground text-xs">
            updated {formatDate(institute.status_updated_at)}
          </span>
        )}
      </div>

      <FormSection
        title="Details"
        description="What was recorded when this institute was registered."
        className="mb-4"
      >
          <dl className="divide-border divide-y">
            <Row label="Address">
              {institute.address || <span className="text-muted-foreground">—</span>}
            </Row>
            <Row label="PIN code">
              {institute.pincode || <span className="text-muted-foreground">—</span>}
            </Row>
            <Row label="Boards">
              {institute.boards?.length ? (
                <span className="flex flex-wrap justify-end gap-1.5">
                  {institute.boards.map((b) => (
                    <Badge key={b} variant="secondary">
                      {b}
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
          </dl>
      </FormSection>

      <FormSection
        title="Contacts"
        description="Who to ask for, and who can decide."
        className="mb-4"
      >
          <dl className="divide-border divide-y">
            <Row label="Principal / owner">
              {institute.principal_name || (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="Principal mobile">
              <Phone number={institute.principal_mobile} />
            </Row>
            <Row label="Decision maker">
              {institute.decision_maker_name ? (
                <>
                  {institute.decision_maker_name}
                  {institute.decision_maker_designation && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {institute.decision_maker_designation}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="Decision maker mobile">
              <Phone number={institute.decision_maker_mobile} />
            </Row>
          </dl>
      </FormSection>

      <FormSection
        title="Streams"
        description="Roughly how many students, by class."
        className="mb-6"
      >
          <dl className="divide-border divide-y">
            <Row label="Class 11">
              {institute.class11?.length ? (
                <span className="capitalize">{institute.class11.join(", ")}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            {STREAMS.map((stream) =>
              stream in (institute.class12 ?? {}) ? (
                <Row key={stream} label={`Class 12 · ${stream}`}>
                  ~{institute.class12[stream]} students
                </Row>
              ) : null,
            )}
            <Row label="Approx. class 12 total">
              <span className="font-semibold">{total}</span>
            </Row>
          </dl>
      </FormSection>

      <SectionTitle>Status history</SectionTitle>
      <div className="mb-6">
        {!statusHistory.ok ? (
          <ErrorState message="We could not load this institute's status history just now." />
        ) : statusHistory.changes.length === 0 ? (
          <EmptyState
            icon={MilestoneIcon}
            title="No status changes recorded"
            description={
              institute.status
                ? "This institute's status was set before status history was kept. Every change from now on is recorded here."
                : "Once someone sets this institute's status, every change will be recorded here."
            }
          />
        ) : (
          <StatusTimeline
            changes={statusHistory.changes}
            currentStatus={institute.status}
            catalogue={catalogue}
          />
        )}
      </div>

      {/*
        OWNERSHIP, ADMIN-ONLY, and placed here rather than at the top on
        purpose: it is administration of the record, not a fact about the
        school, so it sits below the school's own details and above its history.
        A rep never sees it — they own everything they can open.
      */}
      {admin && (
        <div className="mb-4">
          <ReassignOwner
            instituteId={institute.id}
            ownerName={institute.ownerName}
            reps={reps}
          />
        </div>
      )}

      <SectionTitle>Visit history</SectionTitle>
      {!history.ok ? (
        <ErrorState message="We could not load this institute's history just now." />
      ) : history.visits.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No visits logged yet"
          description="Meetings, sessions and campus visits recorded against this institute will appear here."
        />
      ) : (
        <ul className="space-y-2">
          {history.visits.map((visit) => (
            <li
              key={visit.id}
              className="border-primary bg-card flex items-start justify-between gap-3 rounded-r-md border-l-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {activityLabel(visit.activity)}
                  {visit.lifecycle_status && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {visit.lifecycle_status}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground text-xs">
                  {visit.memberName ?? "Unknown"} ·{" "}
                  {formatDate(visit.date)}
                </p>

                {/* The closing report, in one line each, with the full account
                    a tap away. A visit without one shows nothing extra. */}
                {visit.reportedAt && (
                  <div className="mt-2 space-y-1.5">
                    {visit.activitiesConducted?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {visit.activitiesConducted.map((item) => (
                          <Badge key={item} variant="secondary">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    <p className="text-muted-foreground text-xs">
                      {[
                        visit.visitOutcome,
                        visit.studentsAttended !== null
                          ? `${visit.studentsAttended} students`
                          : null,
                        visit.studentResponse,
                        visit.managementResponse?.length
                          ? visit.managementResponse.join(", ")
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>

                    {visit.followUpAction && (
                      <p className="text-warning-subtle-foreground bg-warning-subtle inline-block rounded px-2 py-0.5 text-xs">
                        Follow up: {visit.followUpAction}
                        {visit.followUpDate
                          ? ` by ${formatDate(visit.followUpDate)}`
                          : ""}
                      </p>
                    )}

                    {visit.discussionSummary && (
                      <p className="line-clamp-2 text-sm">{visit.discussionSummary}</p>
                    )}

                    <Button asChild variant="outline" className="mt-1 h-9">
                      <Link href={`/pending/${visit.id}`}>Open the full report</Link>
                    </Button>
                  </div>
                )}
              </div>

              {visit.photo && (
                <VisitPhotoThumb
                  photo={visit.photo}
                  caption={`${activityLabel(visit.activity)} on ${formatDate(visit.date)}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </PageColumn>
  );
}
