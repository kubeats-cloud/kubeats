"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Input } from "@/components/ui/input";
import { RepInstituteTable } from "@/components/report/rep-institute-table";
import { institutesMatchingQuery } from "@/lib/rep-institute-search";
import type { InstituteActivityRow, InstituteActivitySortKey } from "@/lib/institute-activity-counts";
import type { PipelineRange } from "@/lib/validation/pipeline-report";
import type { StatusCatalogue } from "@/lib/validation/institute";

/**
 * The search box above R1's consolidated table.
 *
 * Same idiom as `AdminTeamWeek` (Admin #5): filtering is local over the rows
 * the page already loaded for its date range, so typing never refetches and
 * clearing the box returns that same list.
 */
export function RepInstituteSearch({
  rows,
  sort,
  range,
  caption,
  basePath,
  extraParams,
  catalogue,
}: {
  rows: readonly InstituteActivityRow[];
  sort: { key: InstituteActivitySortKey; dir: "asc" | "desc" };
  range: PipelineRange;
  caption: string;
  basePath: string;
  extraParams?: Record<string, string>;
  catalogue: StatusCatalogue;
}) {
  const [query, setQuery] = useState("");
  const matched = institutesMatchingQuery(rows, query);
  const searching = query.trim() !== "";

  return (
    <>
      <div className="relative mb-4 md:max-w-lg">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          className="h-11 pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, city or area"
          aria-label="Search your institutes"
          autoComplete="off"
        />
      </div>

      {searching && matched.length === 0 ? (
        <EmptyState title="No institute found" />
      ) : (
        <RepInstituteTable
          rows={matched}
          sort={sort}
          range={range}
          caption={caption}
          basePath={basePath}
          extraParams={extraParams}
          catalogue={catalogue}
        />
      )}
    </>
  );
}
