import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, HistoryIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { EmptyState, ErrorState } from "@/components/states";
import { InstituteStatusBadge } from "@/components/institutes/status-badge";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { getInstitute, getInstituteVisits } from "@/lib/institutes";
import { activityLabel } from "@/lib/activities";
import { class12Total, STREAMS, TYPE_LABELS } from "@/lib/validation/institute";

export const metadata = { title: "Institute · Field Ops" };

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

  const history = await getInstituteVisits(id);
  const total = class12Total(institute.class12);

  return (
    <>
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
        <InstituteStatusBadge status={institute.status} />
        <Badge variant="secondary">{TYPE_LABELS[institute.type]}</Badge>
        {institute.status_updated_at && (
          <span className="text-muted-foreground text-xs">
            updated {new Date(institute.status_updated_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Streams</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

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
              <div className="min-w-0">
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
                  {new Date(visit.date).toLocaleDateString()}
                </p>
              </div>

              {visit.photo && (
                <VisitPhotoThumb
                  photo={visit.photo}
                  caption={`${activityLabel(visit.activity)} on ${new Date(visit.date).toLocaleDateString()}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
