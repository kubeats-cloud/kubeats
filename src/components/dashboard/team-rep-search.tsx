"use client";

import { useState, type ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { TeamSnapshot } from "@/components/dashboard/team-snapshot";
import { EmptyState } from "@/components/states";
import { Input } from "@/components/ui/input";
import { repsMatchingName } from "@/lib/team-rep-search";
import type { TeamMemberWeek } from "@/lib/week-summary";

/**
 * The search bar on Admin → Team, above the controls the page already had.
 *
 * Filtering is local: the rows are the ones `getTeamWeek` already loaded, so
 * typing does not refetch and clearing the box puts that same list back.
 * A team lead never mounts this — `/team` renders `TeamSnapshot` directly
 * for them, which is what keeps the search out of the Team Lead section.
 */
export function AdminTeamWeek({
  members,
  weekStart,
  children,
}: {
  members: TeamMemberWeek[];
  weekStart: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const matched = repsMatchingName(members, query);
  const searching = query.trim() !== "";

  return (
    <>
      <div className="relative mt-4 md:max-w-lg">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          className="h-11 pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reps by name"
          aria-label="Search reps by name"
          autoComplete="off"
        />
      </div>

      {children}

      {searching && matched.length === 0 ? (
        <EmptyState title="No Rep found" />
      ) : (
        <TeamSnapshot members={matched} weekStart={weekStart} />
      )}
    </>
  );
}
