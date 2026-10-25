"use client";

import { useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { FileSpreadsheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

/**
 * "Export to Excel", with the range it covers.
 *
 * ONE COMPONENT FOR BOTH BUTTONS. The all-reps export on Team and the per-rep
 * export on a rep's report differ by a single query parameter, so they are the
 * same control with a different `member` — which is what stops the two drifting
 * into different date defaults or different wording.
 *
 * A PLAIN LINK, NOT A FETCH. The endpoint answers with
 * `Content-Disposition: attachment`, so navigating to it downloads the file and
 * leaves the page exactly where it was. Fetching the bytes into JS and building
 * an object URL would add a blob to revoke, a progress state to fake, and a
 * memory copy, to arrive at the same file. The one thing it costs: an error
 * comes back as JSON in a new tab rather than as a notice on this page — which
 * is why the endpoint's failures are written as sentences.
 *
 * The date inputs are uncontrolled-with-state rather than a form: there is
 * nothing to submit, the href simply tracks what they say.
 */
export function DownloadButton({
  href,
  children,
  className,
  variant,
  disabled = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (disabled || busyRef.current) {
      event.preventDefault();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    window.setTimeout(() => {
      busyRef.current = false;
      setBusy(false);
    }, 4000);
  }

  return (
    <Button asChild variant={variant} className={className}>
      <a
        href={disabled ? undefined : href}
        download
        aria-disabled={disabled || busy}
        className={
          disabled || busy ? "pointer-events-none opacity-50" : undefined
        }
        onClick={onClick}
      >
        {children}
      </a>
    </Button>
  );
}

export function ExportExcel({
  start: initialStart,
  end: initialEnd,
  member,
  sort,
  showActivityStatuses = false,
  label = "Export to Excel",
}: {
  /** The range the picker mounts with. Both call sites pass a {start,end}. */
  start: string;
  end: string;
  /** Omitted for the all-reps export; a member id for one rep. */
  member?: string;
  /**
   * The report's current sort. `/team/report` passes none and keeps its
   * alphabetical file; the Overview passes its own state so the download's
   * rows are in the same order as the table it sits above.
   */
  sort?: { key: string; dir: "asc" | "desc" };
  /**
   * The Overview's layout: Open/Closed per activity instead of the 18 status
   * columns. The file then carries the columns that table shows by default.
   */
  showActivityStatuses?: boolean;
  label?: string;
}) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [open, setOpen] = useState(false);

  const params = new URLSearchParams({ start, end });
  if (member) params.set("member", member);
  if (sort) {
    params.set("sort", sort.key);
    params.set("dir", sort.dir);
  }
  if (showActivityStatuses) params.set("layout", "activity-status");
  const href = `/api/export/activity?${params.toString()}`;

  const valid = start !== "" && end !== "" && start <= end;

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => setOpen(true)}
      >
        <FileSpreadsheetIcon className="size-4" aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">
          {member
            ? "Their activity counted over the dates below."
            : "One row per rep, counted over the dates below."}
        </p>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-[9rem] flex-1 space-y-2">
            <Label htmlFor="export-start">From</Label>
            <Input
              id="export-start"
              type="date"
              className="h-11"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="min-w-[9rem] flex-1 space-y-2">
            <Label htmlFor="export-end">To</Label>
            <Input
              id="export-end"
              type="date"
              className="h-11"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
        </div>

        {!valid && (
          <p className="text-danger text-xs">
            The start date has to be on or before the end date.
          </p>
        )}

        <div className="flex gap-2">
          {/* `download` is a hint the same-origin endpoint already enforces with
              Content-Disposition; it is here so the filename survives a browser
              that would otherwise navigate. */}
          <DownloadButton
            href={href}
            disabled={!valid}
            className="h-11 flex-1"
          >
            <FileSpreadsheetIcon className="size-4" aria-hidden />
            Download .xlsx
          </DownloadButton>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
