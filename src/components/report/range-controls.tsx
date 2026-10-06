"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The date range the report is counted over.
 *
 * NAVIGATES RATHER THAN FETCHES. The range lives in the URL, so the page is a
 * server component that reads `?start=&end=` and counts — which means a range
 * can be linked, bookmarked and sent to somebody, and the report an admin is
 * looking at is the report the export button will produce, because both read
 * the same two parameters.
 *
 * The Apply button is deliberate rather than applying on change: a date input
 * fires an onChange for every keystroke in a typed date, so a live range would
 * re-run the whole report against half-finished years.
 */
export function RangeControls({
  start: initialStart,
  end: initialEnd,
  basePath,
  member,
  optional = false,
  extraParams,
  hint,
}: {
  start: string;
  end: string;
  basePath: string;
  member?: string;
  /**
   * Both ends may be blank, and blank means "no bound".
   *
   * OFF BY DEFAULT, so `/team/report` and the per-rep report are untouched:
   * their range is mandatory because `exportRangeSchema` defaults it to the
   * current month and the export has to cover *something*. The pipeline report
   * is the opposite case — its contract is "right now", so no range is the
   * normal state and a window is what the reader asks for.
   *
   * Turning it on adds a Clear button and stops an empty field counting as
   * invalid. One component rather than two, for the reason `ExportExcel` is one
   * component for two buttons: a second copy would be free to drift into
   * different wording and a different idea of what a valid range is.
   */
  optional?: boolean;
  /**
   * Anything else already in the URL that must survive pressing Apply.
   *
   * The pipeline report's `?sort=` / `?dir=` is the only caller. Without this
   * the two parameter sets would knock each other out — applying a range would
   * silently reset the sort, which reads as the table jumping about for no
   * reason.
   */
  extraParams?: Record<string, string>;
  /** One line under the controls, for what the range actually filters on. */
  hint?: string;
}) {
  const router = useRouter();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);

  const bothEnds = start !== "" && end !== "";
  // An optional range is valid while either end is blank; what is never valid
  // is a range that runs backwards.
  const valid = optional
    ? !bothEnds || start <= end
    : bothEnds && start <= end;
  const dirty = start !== initialStart || end !== initialEnd;
  const anything = start !== "" || end !== "";

  function hrefFor(from: string, to: string) {
    const params = new URLSearchParams();
    if (from) params.set(optional ? "from" : "start", from);
    if (to) params.set(optional ? "to" : "end", to);
    if (member) params.set("member", member);
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      params.set(key, value);
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  function apply() {
    if (!valid) return;
    router.push(hrefFor(start, end));
  }

  function clear() {
    setStart("");
    setEnd("");
    router.push(hrefFor("", ""));
  }

  return (
    <div className="border-border bg-card mb-4 flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <div className="min-w-[8.5rem] flex-1 space-y-1.5">
        <Label htmlFor="range-start" className="text-xs">
          From
        </Label>
        <Input
          id="range-start"
          type="date"
          className="h-11"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </div>
      <div className="min-w-[8.5rem] flex-1 space-y-1.5">
        <Label htmlFor="range-end" className="text-xs">
          To
        </Label>
        <Input
          id="range-end"
          type="date"
          className="h-11"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
        />
      </div>
      <Button
        type="button"
        className="h-11"
        onClick={apply}
        disabled={!valid || !dirty}
      >
        <CalendarIcon className="size-4" aria-hidden />
        Apply
      </Button>
      {optional && (
        /* Shown always rather than only when a range is set, so the control
           does not change shape as it is used — but disabled when there is
           nothing to clear, which says the same thing without moving. */
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={clear}
          disabled={!anything}
        >
          <XIcon className="size-4" aria-hidden />
          Clear
        </Button>
      )}
      {!valid && (
        <p className="text-danger w-full text-xs">
          The start date has to be on or before the end date.
        </p>
      )}
      {hint && valid && (
        <p className="text-muted-foreground w-full text-xs">{hint}</p>
      )}
    </div>
  );
}
