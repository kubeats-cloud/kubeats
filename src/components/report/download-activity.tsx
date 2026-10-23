"use client";

import { useState } from "react";
import { FileSpreadsheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { repActivityExportRangeProblem } from "@/lib/validation/export";

/**
 * "Download Activity (Excel)" on the rep's Institutes tab.
 *
 * A PLAIN LINK TO THE EXISTING ROUTE, like `ExportExcel`: the endpoint answers
 * with `Content-Disposition: attachment`, so the browser downloads the file
 * and leaves the table where it was.
 *
 * THE RANGE IS THE ONE THING THAT DIFFERS FROM THE ADMIN CONTROL. A rep's
 * download is capped at 31 days, and the sentence explaining that comes from
 * `repActivityExportRangeProblem()` — the same function the route uses — so the
 * button cannot be enabled for a range the server would refuse.
 */
export function DownloadActivity({
  start: initialStart,
  end: initialEnd,
  sort,
}: {
  /** The range the control mounts with: the table's range, or this month. */
  start: string;
  end: string;
  /** The table's sort, so the file's rows are in the same order. */
  sort?: { key: string; dir: "asc" | "desc" };
}) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [open, setOpen] = useState(false);

  const problem = repActivityExportRangeProblem(start, end);
  const valid = problem === null;

  const params = new URLSearchParams({
    view: "rep",
    from: start,
    to: end,
  });
  if (sort) {
    params.set("sort", sort.key);
    params.set("dir", sort.dir);
  }
  const href = `/api/export/institute-activity?${params.toString()}`;

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => setOpen(true)}
      >
        <FileSpreadsheetIcon className="size-4" aria-hidden />
        Download Activity (Excel)
      </Button>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm font-medium">Download Activity (Excel)</p>
        <p className="text-muted-foreground text-xs">
          Your institutes&apos; activity counted over the dates below.
        </p>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-[9rem] flex-1 space-y-2">
            <Label htmlFor="rep-export-start">From</Label>
            <Input
              id="rep-export-start"
              type="date"
              className="h-11"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="min-w-[9rem] flex-1 space-y-2">
            <Label htmlFor="rep-export-end">To</Label>
            <Input
              id="rep-export-end"
              type="date"
              className="h-11"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
        </div>

        {problem && <p className="text-danger text-xs">{problem}</p>}

        <div className="flex gap-2">
          <Button asChild className="h-11 flex-1" disabled={!valid}>
            <a href={valid ? href : undefined} download>
              <FileSpreadsheetIcon className="size-4" aria-hidden />
              Download .xlsx
            </a>
          </Button>
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
