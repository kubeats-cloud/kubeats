"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

interface RepOption {
  id: string;
  name: string;
}

interface StatusOption {
  status: string;
  category: "open" | "closed";
}

/**
 * The Call Activity Report's own filter bar (Part 3) — From, To,
 * Representative, Institute, Call Status, with Apply and Clear.
 *
 * ⚠ APPLY ON A BUTTON, NOT ON CHANGE — unlike `VisitReview`'s filter card
 * above it on this same page, which pushes a new URL the instant a Select
 * changes. The client asked for Apply/Clear specifically, so five fields
 * are drafted in local state and only pushed as one navigation when Apply
 * is pressed — a reader picking a date range one field at a time does not
 * refetch the table on every keystroke or every Select.
 *
 * SERVER-SIDE, STILL. Pressing Apply is a `router.push()` to a new URL;
 * nothing here filters a row that already arrived in the browser. The
 * server component above (`review/page.tsx`) re-reads these same params
 * and calls `call_activity_report()` again — that round trip is the whole
 * point, and is what keeps the worker from ever holding more than one
 * rep's institute pool in memory to filter client-side.
 *
 * INSTITUTE IS A NAME-CONTAINS TEXT BOX, not a Select. A full dropdown of
 * every institute would be 700-odd `<option>`s rendered for a filter that
 * only narrows a handful of rows — the client's own instruction. The RPC's
 * `strpos(lower(...))` match is cheap and case-insensitive on the way in.
 */
export function CallActivityFilters({
  reps,
  statuses,
  initial,
  basePath = "/review",
  extraParams,
  actions,
}: {
  /** Every rep the caller may filter to — a team lead's own reps only,
   *  the same `supervises()` scoping the RPC itself applies. */
  reps: RepOption[];
  /** The full configured vocabulary, open and closed. */
  statuses: StatusOption[];
  initial: {
    from?: string;
    to?: string;
    member?: string;
    institute?: string;
    status?: string;
  };
  /**
   * Where Apply/Clear navigate to. Defaults to `/review`, where this filter
   * bar originally lived; the Activity tab — now its only call site — points
   * it at `/activity`. `navigate()` below merges onto `useSearchParams()`
   * rather than rebuilding from scratch, so it already preserves whatever
   * else that page's URL carries (the selected tab, the other three reports'
   * own params) with no further change needed here.
   */
  basePath?: string;
  /**
   * Forced onto the URL after the self-merge above, overriding anything the
   * same-named key already carries. The Activity tab's only use: `{ tab:
   * "call" }`, so applying a filter here lands back on the Call Activity card
   * even when the browser's current `?tab=` is stale — the active card is
   * local React state (so switching cards costs no navigation), and that
   * state can drift from the URL between card switches. Every outgoing link
   * this box writes must restate its own identity rather than trust the URL.
   */
  extraParams?: Record<string, string>;
  /**
   * Rendered at the right-hand end of the Apply/Clear row. The Activity tab
   * passes its Download Excel here so the filter bar and the download are one
   * toolbar, as the consolidated layout requires. Omitted everywhere else, and
   * then the Apply/Clear row keeps its original right alignment.
   */
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [member, setMember] = useState(initial.member ?? "");
  const [institute, setInstitute] = useState(initial.institute ?? "");
  const [status, setStatus] = useState(initial.status ?? "");

  const activeCount = [
    initial.from,
    initial.to,
    initial.member,
    initial.institute,
    initial.status,
  ].filter((v) => v && v.trim() !== "").length;

  function navigate(next: {
    from: string;
    to: string;
    member: string;
    institute: string;
    status: string;
  }) {
    const search = new URLSearchParams(params.toString());
    const set = (key: string, value: string) => {
      if (!value.trim()) search.delete(key);
      else search.set(key, value.trim());
    };
    set("callFrom", next.from);
    set("callTo", next.to);
    set("callMember", next.member);
    set("callInstitute", next.institute);
    set("callStatus", next.status);
    // A new filter result may be a different length — same rule as the
    // register above: a filter change always returns to page one.
    search.delete("callPage");
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      search.set(key, value);
    }
    const query = search.toString();
    router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
  }

  function apply() {
    navigate({ from, to, member, institute, status });
  }

  function clear() {
    setFrom("");
    setTo("");
    setMember("");
    setInstitute("");
    setStatus("");
    navigate({ from: "", to: "", member: "", institute: "", status: "" });
  }

  return (
    <Card className="mb-4 p-4 md:p-5">
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Field label="From">
          <Input
            type="date"
            className="h-10"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
          />
        </Field>

        <Field label="To">
          <Input
            type="date"
            className="h-10"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
          />
        </Field>

        <Field label="Representative">
          <Select value={member || ALL} onValueChange={(v) => setMember(v === ALL ? "" : v)}>
            <SelectTrigger className="h-10 w-full" aria-label="Representative">
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
          <Input
            className="h-10"
            placeholder="Name contains…"
            value={institute}
            onChange={(e) => setInstitute(e.target.value)}
            aria-label="Institute name contains"
          />
        </Field>

        <Field label="Call Status">
          <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? "" : v)}>
            <SelectTrigger className="h-10 w-full" aria-label="Call Status">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {statuses.map((entry) => (
                <SelectItem key={entry.status} value={entry.status}>
                  {entry.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div
        className={cn(
          "mt-4 flex flex-wrap items-center gap-2",
          actions ? "justify-between" : "justify-end",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {activeCount > 0 && (
            <Button type="button" variant="ghost" className="h-9" onClick={clear}>
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
          <Button type="button" className="h-9" onClick={apply}>
            Apply
          </Button>
        </div>
        {/* Wrapped rather than rendered bare: a JSX element passed in as a
            prop and placed beside a static sibling is an array child to
            React's dev validator, which then asks it for a key. */}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </Card>
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
