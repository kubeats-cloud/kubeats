"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterXIcon,
  SearchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { ACTIVITIES } from "@/lib/validation/visit";
import type { VisitRow } from "@/lib/admin-workspace";
import { formatDate } from "@/lib/dates";

/**
 * Review — the screen an admin spends their time on.
 *
 * Filtering happens on the server, driven by the URL: every filter is a search
 * param, so a filtered view is a link. An admin who finds "everything Priya did
 * at Greenfield last week" can send that to someone, and the back button walks
 * back through their filters instead of dumping them at the top of the list.
 *
 * The value of "all" rather than an empty string is deliberate — a Radix Select
 * cannot hold an empty string as a value, and mapping it here keeps that detail
 * out of the query builder.
 */

const ALL = "all";
/** Matches VISIT_STATUS_NONE in admin-workspace.ts — `status_set_to IS NULL`. */
const NONE = "__none__";

interface Option {
  id: string;
  name: string;
}

interface StatusOption {
  status: string;
  /** False once an admin has retired it. Still filterable — see the panel. */
  isActive: boolean;
}

export function VisitReview({
  visits,
  total,
  page,
  pageCount,
  reps,
  institutes,
  statuses,
  pageSize,
}: {
  visits: VisitRow[];
  total: number;
  /** 1-based, already clamped by the server to a page that exists. */
  page: number;
  pageCount: number;
  reps: Option[];
  institutes: Option[];
  /** The whole vocabulary in display order, retired statuses included. */
  statuses: StatusOption[];
  pageSize: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const value = (key: string) => params.get(key) ?? "";

  function apply(key: string, next: string) {
    const search = new URLSearchParams(params.toString());
    if (!next || next === ALL) search.delete(key);
    else search.set(key, next);
    /*
     * ⚠ CHANGING A FILTER ALWAYS RETURNS TO PAGE ONE.
     *
     * Without this, narrowing from 300 visits to 12 while sitting on page 4
     * asks for rows 151-200 of a 12-row result. The server clamps that to the
     * last page rather than showing nothing, so it would not look broken — it
     * would quietly show the END of the new result, and the reader would have
     * no idea they were not at the top of it.
     */
    search.delete("page");
    startTransition(() => router.push(`/review?${search.toString()}`));
  }

  /** The same URL with a different page, every filter preserved. */
  function pageHref(next: number) {
    const search = new URLSearchParams(params.toString());
    if (next <= 1) search.delete("page");
    else search.set("page", String(next));
    const query = search.toString();
    return query ? `/review?${query}` : "/review";
  }

  // 1-based and inclusive, for the "Showing 51-100 of 352" line. Clamped
  // against what actually arrived so a short last page reads correctly.
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = total === 0 ? 0 : firstRow + visits.length - 1;

  const activeCount = [
    "member",
    "institute",
    "activity",
    "from",
    "to",
    "reported",
    "status",
    "visitStatus",
    "lifecycle",
  ].filter((k) => params.get(k)).length;

  return (
    <div className="space-y-5">
      {/* Filters ---------------------------------------------------------- */}
      <Card className="p-4 md:p-5">
        {/* Four across rather than six: seven fields over six columns leaves
            one stranded on a row of its own. */}
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Field label="Rep">
            <Select value={value("member") || ALL} onValueChange={(v) => apply("member", v)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Everyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everyone</SelectItem>
                {reps.map((rep) => (
                  <SelectItem key={rep.id} value={rep.id}>
                    {rep.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Institute">
            <Select
              value={value("institute") || ALL}
              onValueChange={(v) => apply("institute", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="All institutes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All institutes</SelectItem>
                {institutes.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Activity">
            <Select
              value={value("activity") || ALL}
              onValueChange={(v) => apply("activity", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="All activities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All activities</SelectItem>
                {ACTIVITIES.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="From">
            <Input
              type="date"
              className="h-10"
              value={value("from")}
              onChange={(e) => apply("from", e.target.value)}
            />
          </Field>

          <Field label="To">
            <Input
              type="date"
              className="h-10"
              value={value("to")}
              onChange={(e) => apply("to", e.target.value)}
            />
          </Field>

          <Field label="Report">
            <Select
              value={value("reported") || ALL}
              onValueChange={(v) => apply("reported", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                <SelectItem value="reported">Filed</SelectItem>
                <SelectItem value="unreported">Not filed</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/*
            "INSTITUTE STATUS NOW", AND THE WORDING IS THE POINT.

            This filters on `institutes.status` — where the school stands today,
            the same value the badge on /institutes shows and the same one
            Pending keys on. The register's own "Status" column is
            `visits.status_set_to`: where THAT visit left the institute, which a
            later visit may since have superseded. Two different questions, and
            a filter labelled plain "Status" beside a column labelled "Status"
            would look like it filtered the column and quietly would not.

            So filtering to "Session done" lists every visit ever made to a
            school that is at "Session done" now — including the early meetings
            that happened long before it got there. That is the question an
            admin is actually asking when they reach for this.
          */}
          <Field label="Institute status now">
            <Select
              value={value("status") || ALL}
              onValueChange={(v) => apply("status", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any status</SelectItem>
                {statuses.map((entry) => (
                  <SelectItem key={entry.status} value={entry.status}>
                    {/* Retired ones are still offered: an admin filtering the
                        register is searching history, and the visits that
                        carry a retired status are exactly what they are
                        looking for. Marked so it does not read as a mistake. */}
                    {entry.isActive ? entry.status : `${entry.status} (retired)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/*
            "STATUS SET BY THIS VISIT" — the sibling of the control above, and
            the labels are the whole of why both can exist without confusing
            anybody. That one asks where the SCHOOL stands now; this one asks
            what THIS VISIT decided. A drill-down from a visit's own badge
            lands here, because clicking "Session scheduled" on a row must
            narrow to the visits that set it, not to every visit ever made to a
            school that happens to sit there today.
          */}
          <Field label="Status set by this visit">
            <Select
              value={value("visitStatus") || ALL}
              onValueChange={(v) => apply("visitStatus", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                {/* Legal only before FO024 made a status compulsory, and this
                    is how those visits are found. */}
                <SelectItem value={NONE}>No status set</SelectItem>
                {statuses.map((entry) => (
                  <SelectItem key={entry.status} value={entry.status}>
                    {entry.isActive ? entry.status : `${entry.status} (retired)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Open loops and closed ones. "Set" means STILL open — see
              VisitFilters for why the lifecycle alone cannot say that. */}
          <Field label="Loop">
            <Select
              value={value("lifecycle") || ALL}
              onValueChange={(v) => apply("lifecycle", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                <SelectItem value="Set">Set &mdash; still open</SelectItem>
                <SelectItem value="Done">Done</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {pending ? (
              "Filtering…"
            ) : (
              <>
                {/*
                  THE TRUE FILTERED TOTAL, and which slice of it is on screen.
                  This used to read "Showing 50 of 352 · newest 50 shown",
                  which was honest about the cap and offered no way past it.
                */}
                {total === 0
                  ? "No visits match these filters"
                  : `Showing ${firstRow}–${lastRow} of ${total} visit${total === 1 ? "" : "s"}`}
                {pageCount > 1 && ` · page ${page} of ${pageCount}`}
              </>
            )}
          </p>
          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="h-8"
              onClick={() => startTransition(() => router.push("/review"))}
            >
              <FilterXIcon className="size-4" aria-hidden />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </Card>

      {visits.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="No visits match those filters"
          description="Widen the date range, or clear a filter to see the whole team's work."
        />
      ) : (
        <>
          {/* Phone: cards ------------------------------------------------ */}
          <ul className="space-y-3 md:hidden">
            {visits.map((visit) => (
              <li key={visit.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* Name links stay live at every width — a full-width
                          row is a fine tap target, unlike a grid cell. */}
                      <Link
                        href={`/institutes/${visit.instituteId}`}
                        className="focus-visible:ring-ring block truncate rounded-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {visit.instituteName}
                      </Link>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        <Link
                          href={`/team/${visit.memberId}`}
                          className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {visit.memberName}
                        </Link>{" "}
                        · {formatDate(visit.date)}
                      </p>
                    </div>
                    {visit.photo && (
                      <VisitPhotoThumb
                        photo={visit.photo}
                        caption={`${visit.activityLabel} at ${visit.instituteName}`}
                      />
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{visit.activityLabel}</Badge>
                    {visit.lifecycle && (
                      <Badge
                        variant={visit.lifecycle === "Done" ? "success" : "warning"}
                      >
                        {visit.lifecycle}
                      </Badge>
                    )}
                    <Badge variant={visit.reportedAt ? "success" : "neutral"}>
                      {visit.reportedAt ? "Report filed" : "No report"}
                    </Badge>
                  </div>
                  {/*
                    ONE LINE ON A PHONE, NOT TWO COLUMNS. Seven columns is the
                    ceiling on the desktop table and there is no room for either
                    of them on a card, so both facts share a sentence — and the
                    sentence names the institute, which is what stops them being
                    read as this visit's own dates.

                    Rendered only when there is something to say. A card with
                    "Follow-up — · Status changed —" on it is noise on the one
                    layout with no room to spare.
                  */}
                  {(visit.instituteFollowUpDate ||
                    visit.instituteStatusUpdatedAt) && (
                    <p className="text-muted-foreground mt-2 text-xs">
                      This institute:
                      {visit.instituteFollowUpDate &&
                        ` follow up ${formatDate(visit.instituteFollowUpDate)}`}
                      {visit.instituteFollowUpDate &&
                        visit.instituteStatusUpdatedAt &&
                        " ·"}
                      {visit.instituteStatusUpdatedAt &&
                        ` status changed ${formatDate(visit.instituteStatusUpdatedAt)}`}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: the register --------------------------------------- */}
          <Card className="hidden gap-0 overflow-hidden p-0 shadow-xs md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Every visit the team has logged, newest first. Status is where
                  that visit left the institute; Follow-up and Status changed
                  describe the institute as it stands now, so they repeat across
                  a school&rsquo;s visits.
                </caption>
                <thead>
                  <tr className="border-border bg-secondary/40 text-muted-foreground border-b text-left">
                    <Th className="w-20">Photo</Th>
                    <Th>Date</Th>
                    <Th>Rep</Th>
                    <Th>Institute</Th>
                    <Th>Activity</Th>
                    <Th>Status</Th>
                    {/*
                      The two per-institute columns. They repeat down a run of
                      visits to one school, which is accepted: they answer
                      "where does this school stand", not "what happened on this
                      visit".

                      Both carry a second line, because both would be read as
                      per-visit otherwise — "Follow-up" beside a visit row looks
                      like that visit's follow-up, and "Status changed" looks
                      like the moment this visit changed it. The subtitle is the
                      cheapest place to say which question is being answered.
                    */}
                    <Th>
                      Follow-up
                      <span className="block font-normal">at this institute</span>
                    </Th>
                    <Th>
                      Status changed
                      <span className="block font-normal">last actual change</span>
                    </Th>
                    <Th>Report</Th>
                    <th className="w-10 px-2 py-2.5">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((visit) => (
                    <tr
                      key={visit.id}
                      className="border-border hover:bg-accent/50 border-b align-middle transition-colors last:border-0"
                    >
                      <td className="px-5 py-2">
                        {visit.photo ? (
                          <VisitPhotoThumb
                            photo={visit.photo}
                            caption={`${visit.activityLabel} at ${visit.instituteName}`}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap tabular-nums">
                        {formatDate(visit.date)}
                      </td>
                      <td className="px-5 py-3">
                        {/* The person, not this visit — their hub. */}
                        <Link
                          href={`/team/${visit.memberId}`}
                          className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {visit.memberName}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        {/*
                          TWO DESTINATIONS, because they are two questions. The
                          NAME opens the institute — everything about that
                          school in one place — and the chevron at the end of
                          the row still opens THIS VISIT. A name should get you
                          to the thing it names.
                        */}
                        <Link
                          href={`/institutes/${visit.instituteId}`}
                          className="focus-visible:ring-ring rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {visit.instituteName}
                        </Link>
                        {visit.city && (
                          <p className="text-muted-foreground text-xs">{visit.city}</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/review?activity=${visit.activity}`}
                            aria-label={`Show every ${visit.activityLabel}`}
                            className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <Badge variant="secondary" className="hover:ring-ring hover:ring-1">
                              {visit.activityLabel}
                            </Badge>
                          </Link>
                          {visit.lifecycle && (
                            <Link
                              href={`/review?lifecycle=${visit.lifecycle}`}
                              aria-label={
                                visit.lifecycle === "Done"
                                  ? "Show every closed loop"
                                  : "Show every loop still open"
                              }
                              className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <Badge
                                variant={
                                  visit.lifecycle === "Done" ? "success" : "warning"
                                }
                                className="hover:ring-ring hover:ring-1"
                              >
                                {visit.lifecycle}
                              </Badge>
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="text-muted-foreground px-5 py-3">
                        {/*
                          ?visitStatus=, NOT ?status=. This cell is
                          `status_set_to` — what THIS visit decided — so the
                          link must narrow to the visits that decided the same.
                          ?status= would have answered "every visit to a school
                          sitting there today", a different set and a different
                          number than the column implies.
                        */}
                        {visit.status ? (
                          <Link
                            href={`/review?visitStatus=${encodeURIComponent(visit.status)}`}
                            aria-label={`Show every visit that set ${visit.status}`}
                            className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {visit.standing ?? visit.status}
                          </Link>
                        ) : (
                          (visit.standing ?? "—")
                        )}
                      </td>
                      <td className="text-muted-foreground px-5 py-3 whitespace-nowrap tabular-nums">
                        {visit.instituteFollowUpDate
                          ? formatDate(visit.instituteFollowUpDate)
                          : "—"}
                      </td>
                      <td className="text-muted-foreground px-5 py-3 whitespace-nowrap tabular-nums">
                        {visit.instituteStatusUpdatedAt
                          ? formatDate(visit.instituteStatusUpdatedAt)
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={visit.reportedAt ? "success" : "neutral"}>
                          {visit.reportedAt ? "Filed" : "None"}
                        </Badge>
                      </td>
                      <td className="px-2 py-3">
                        <Link
                          href={`/review/${visit.id}`}
                          className="text-muted-foreground hover:text-foreground block"
                          aria-label={`Open the report for ${visit.instituteName}`}
                        >
                          <ChevronRightIcon className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/*
        THE PAGER, and the reason this screen now has one.

        The register was capped at the newest fifty with no way past it: a
        filter matching sixty-five showed fifty and the rest were simply
        unreachable. The filters themselves were never the problem — they have
        always run across every visit — so what was needed was not a wider net
        but a way to haul the rest of it in.

        LINKS, NOT BUTTONS, and the same reasoning the pipeline report's sort
        headers carry: the page lives in the URL and the screen is
        server-rendered, so what a pager does is NAVIGATE. A link works with
        JavaScript off, can be opened in a new tab, and can be sent to somebody
        — and `pageHref()` preserves every active filter, so a shared link
        lands on the same rows.

        Hidden entirely on a single page: a pager over one page of results is
        furniture that says nothing.
      */}
      {pageCount > 1 && (
        <nav
          className="flex items-center justify-between gap-3 pt-1"
          aria-label="Register pages"
        >
          <Button
            asChild={page > 1}
            variant="outline"
            className="h-11"
            disabled={page <= 1}
          >
            {page > 1 ? (
              <Link href={pageHref(page - 1)} scroll={false}>
                <ChevronLeftIcon className="size-4" aria-hidden />
                Newer
              </Link>
            ) : (
              <span>
                <ChevronLeftIcon className="size-4" aria-hidden />
                Newer
              </span>
            )}
          </Button>

          <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
            Page {page} of {pageCount}
          </p>

          <Button
            asChild={page < pageCount}
            variant="outline"
            className="h-11"
            disabled={page >= pageCount}
          >
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} scroll={false}>
                Older
                <ChevronRightIcon className="size-4" aria-hidden />
              </Link>
            ) : (
              <span>
                Older
                <ChevronRightIcon className="size-4" aria-hidden />
              </span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={`px-5 py-2.5 text-xs font-medium ${className ?? ""}`}>
      {children}
    </th>
  );
}
