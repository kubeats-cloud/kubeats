import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { PageColumn } from "@/components/layout/page-column";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  MilestoneIcon,
  PencilIcon,
  UsersIcon,
} from "lucide-react";
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
import { getOpenFollowUps } from "@/lib/visits";
import { instituteCounts, workedItBy } from "@/lib/institute-hub";
import { isOpenStatus } from "@/lib/validation/institute";
import { Card } from "@/components/ui/card";
import { listRepsForCampus } from "@/lib/admin";
import { ReassignOwner } from "@/components/institutes/reassign-owner";
import { class12Total, STREAMS, TYPE_LABELS } from "@/lib/validation/institute";
import { cn } from "@/lib/utils";

export const metadata = { title: "Institute" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-muted-foreground shrink-0 text-sm">{label}</dt>
      <dd className="text-right text-sm break-words">{children}</dd>
    </div>
  );
}

/** One of the three numbers in the counts header. */
function Fact({
  value,
  label,
}: {
  value: React.ReactNode;
  label: string;
}) {
  return (
    <Card className="gap-0 p-4">
      <p
        className={cn(
          "leading-none font-semibold tracking-tight tabular-nums",
          typeof value === "number" ? "text-[26px]" : "text-base",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-2 text-[11px] font-medium tracking-wide">
        {label}
      </p>
    </Card>
  );
}

/** A line in the follow-up panel. Absent values say so rather than vanishing. */
function FollowUpFact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="text-right text-xs break-words">
        {value ?? <span className="text-muted-foreground">Not recorded</span>}
      </dd>
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

  const user = await getCurrentUser();
  const admin = isAdmin(user);

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

  const visits = history.ok ? history.visits : [];
  const counts = instituteCounts(visits, institute.status_updated_at);

  /*
   * WHO HAS WORKED IT — admin-only, and for a DATA reason rather than a
   * permissions one.
   *
   * `getInstituteVisits()` is scoped by RLS to `member = auth.uid() or
   * is_admin()`, so a rep's copy of this tally is always exactly one row:
   * themselves. A panel headed "Who's worked it" showing one name is not
   * partial information, it is misleading information — it says nobody else
   * has been here, which is the opposite of what RLS actually means. So the
   * panel is the admin's, whose copy is the whole team's and is true.
   *
   * The counts above are shown to BOTH and are labelled by role instead:
   * "Visits" for an admin, "Your visits" for a rep. A number with an honest
   * name is worth keeping; a list that implies completeness is not.
   */
  const workedIt = admin ? workedItBy(visits) : [];

  /*
   * FOLLOW-UP OWED — asked only when the status is actually OPEN.
   *
   * Rule 5: an OPEN status needs a follow-up date, a CLOSED one merely permits
   * one. `getOpenFollowUps()` reads every open institute and the visits that
   * explain them, which is the right answer and the wrong amount of work for
   * one school — so the cheap local question is asked first and the expensive
   * shared one only when it can return something.
   *
   * Reused rather than reimplemented so this panel and /pending cannot
   * disagree about what is owed: they are the same computation, filtered.
   */
  const statusIsOpen = isOpenStatus(catalogue, institute.status);
  const openStatuses = catalogue
    .filter((row) => row.category === "open")
    .map((row) => row.status);

  const followUps =
    statusIsOpen && user
      ? await getOpenFollowUps(openStatuses, user.id)
      : ({ ok: true, items: [] } as const);
  const owed = followUps.ok
    ? (followUps.items.find((item) => item.instituteId === id) ?? null)
    : null;

  return (
    <PageColumn>
      <PageHeader
        title={institute.name}
        description={[institute.area, institute.city, institute.state]
          .filter(Boolean)
          .join(", ")}
        action={
          <div className="flex items-center gap-1">
            {/* Admin-only, and hidden rather than disabled for a rep: the
                editor is theirs alone, proxy.ts redirects a rep off it, and
                updateInstitute() refuses one regardless. */}
            {admin && (
              <Button asChild variant="ghost" className="h-11">
                <Link href={`/institutes/${institute.id}/edit`}>
                  <PencilIcon className="size-4" aria-hidden />
                  Edit
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" className="h-11">
              <Link href="/institutes">
                <ArrowLeftIcon className="size-4" aria-hidden />
                Back
              </Link>
            </Button>
          </div>
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

      {/*
        THE THREE NUMBERS, and the first two are labelled by ROLE.

        `getInstituteVisits()` is RLS-scoped, so "visits" means the whole
        team's to an admin and only their own to a rep. Printing "3 visits" to
        a rep who cannot see their colleague's seven would be a number that
        reads as a fact about the school and is actually a fact about them —
        so for a rep it says "Your visits" and means it.

        Days at status is NOT scoped: `status_updated_at` is a column on the
        institute, so it is the same number for everyone who can open the page.
      */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Fact
          value={counts.visits}
          label={admin ? "Visits" : "Your visits"}
        />
        <Fact
          value={counts.lastVisit ? formatDate(counts.lastVisit) : "—"}
          label={admin ? "Last visit" : "Your last visit"}
        />
        <Fact
          value={counts.daysAtStatus === null ? "—" : counts.daysAtStatus}
          label={
            counts.daysAtStatus === null
              ? "Days at status"
              : counts.daysAtStatus === 1
                ? "Day at this status"
                : "Days at this status"
          }
        />
      </div>

      {/*
        WHAT IS OWED. Shown only when the current status is OPEN, because that
        is the whole of Rule 5: an open status requires a follow-up date, a
        closed one merely permits one. A closed institute with a stale date on
        it is not owed anything, and saying so would put this screen at odds
        with Pending.
      */}
      {statusIsOpen && (
        <div className="mb-6">
          <SectionTitle>Follow-up owed</SectionTitle>
          <Card className="p-4">
            <p className="text-sm">
              This institute is{" "}
              <span className="font-medium">{institute.status}</span>, which is
              an open status — someone still owes it a visit.
            </p>
            <dl className="mt-3 space-y-1.5">
              <FollowUpFact
                label="Follow up by"
                value={owed?.followUpDate ? formatDate(owed.followUpDate) : null}
              />
              {owed?.expectedDate && (
                <FollowUpFact
                  label="Expected on"
                  value={formatDate(owed.expectedDate)}
                />
              )}
              <FollowUpFact
                label="Left open by"
                value={owed?.memberName ?? null}
              />
              <FollowUpFact
                label="Set on"
                value={owed?.setOn ? formatDate(owed.setOn) : null}
              />
            </dl>
            {!owed && (
              /* Reachable: the status is open but no VISIBLE visit explains
                 it — a rep looking at a colleague's work, or a status set
                 directly by an admin edit. The status is still the fact; the
                 explanation simply is not this reader's to see. */
              <p className="text-muted-foreground mt-3 text-xs">
                No visit visible to you explains this status.
              </p>
            )}
          </Card>
        </div>
      )}

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
            ownerId={institute.registered_by}
            ownerName={institute.ownerName}
            reps={reps}
          />
        </div>
      )}

      {/*
        WHO HAS WORKED IT. Admin-only — see the note where `workedIt` is built:
        a rep's copy would always be one row, themselves, under a heading that
        implies it is everyone.

        Each name opens that rep's hub. Gated with the panel rather than
        separately, because /team/[memberId] is admin-only at the proxy and a
        rep following one would be 307'd to the dashboard.
      */}
      {admin && workedIt.length > 0 && (
        <>
          <SectionTitle>Who&rsquo;s worked it</SectionTitle>
          <Card className="divide-border mb-6 gap-0 divide-y p-0 shadow-xs">
            {workedIt.map((rep) => (
              <Link
                key={rep.memberId}
                href={`/team/${rep.memberId}`}
                className="hover:bg-accent/50 focus-visible:ring-ring flex items-center gap-3 px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <UsersIcon
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rep.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    last visit {formatDate(rep.lastVisit)}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {rep.visits} visit{rep.visits === 1 ? "" : "s"}
                </Badge>
                <ChevronRightIcon
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
              </Link>
            ))}
          </Card>
        </>
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

                    {/*
                      ONE LINK, TWO DESTINATIONS — and it IS branched by role
                      now, which reverses what stood here.

                      `/pending/[id]` works for both and always did: its
                      ownership check ends `if (!mine && !isAdmin(user))
                      notFound()`, so an admin was always meant to be able to
                      open it. That is still true and is why the rep's half is
                      unchanged.

                      What changed is that an admin has a BETTER page. Since
                      `/pending` left `REP_ONLY_PATHS` this button worked for
                      them, but it landed them in the rep-facing report reader —
                      a screen built around "what do I still owe" — when the
                      admin's own visit view at `/review/[id]` shows the same
                      report with the photo, the presence record and the way
                      back into the filtered register. Sending a supervisor to
                      the worker's screen was a missed door, not a broken one.
                    */}
                    <Button asChild variant="outline" className="mt-1 h-9">
                      <Link
                        href={
                          admin ? `/review/${visit.id}` : `/pending/${visit.id}`
                        }
                      >
                        Open the full report
                      </Link>
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
