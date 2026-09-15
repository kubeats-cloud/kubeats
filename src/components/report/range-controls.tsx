"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarIcon } from "lucide-react";
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
}: {
  start: string;
  end: string;
  basePath: string;
  member?: string;
}) {
  const router = useRouter();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);

  const valid = start !== "" && end !== "" && start <= end;
  const dirty = start !== initialStart || end !== initialEnd;

  function apply() {
    if (!valid) return;
    const params = new URLSearchParams({ start, end });
    if (member) params.set("member", member);
    router.push(`${basePath}?${params.toString()}`);
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
      {!valid && (
        <p className="text-danger w-full text-xs">
          The start date has to be on or before the end date.
        </p>
      )}
    </div>
  );
}
