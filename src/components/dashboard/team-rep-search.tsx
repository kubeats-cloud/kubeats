"use client";

import { useState, type ReactNode } from "react";
import { PencilIcon, SearchIcon } from "lucide-react";
import { TeamSnapshot } from "@/components/dashboard/team-snapshot";
import { MemberEditDialog } from "@/components/settings/member-edit-dialog";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { repsMatchingName } from "@/lib/team-rep-search";
import type { TeamMember } from "@/lib/admin";
import type { Campus } from "@/lib/campus-display";
import type { TeamMemberWeek } from "@/lib/week-summary";

/**
 * The search bar on Admin → Team, above the controls the page already had.
 *
 * Filtering is local: the rows are the ones `getTeamWeek` already loaded, so
 * typing does not refetch and clearing the box puts that same list back.
 * A team lead never mounts this — `/team` renders `TeamSnapshot` directly
 * for them, which is what keeps the search out of the Team Lead section.
 *
 * THE EDIT BUTTON AND ITS FORM LIVE HERE, once for the list rather than once
 * per row. `MemberEditDialog` is the same component Settings opens, mounted
 * outside the rows for the reason it documents: a successful edit revalidates
 * the page and rebuilds every row, and the receipt has to outlive the row it
 * was opened from.
 */
export function AdminTeamWeek({
  members,
  weekStart,
  editableMembers,
  campuses,
  children,
}: {
  members: TeamMemberWeek[];
  weekStart: string;
  /** The full account records, so a row can preselect its campus and role. */
  editableMembers: TeamMember[];
  campuses: Campus[];
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const matched = repsMatchingName(members, query);
  const searching = query.trim() !== "";

  const byId = new Map(editableMembers.map((member) => [member.id, member]));

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
        <TeamSnapshot
          members={matched}
          weekStart={weekStart}
          renderAction={(memberId) => {
            const member = byId.get(memberId);
            if (!member) return null;
            return (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-9 shrink-0"
                aria-label={`Edit ${member.name}`}
                title={`Edit ${member.name}`}
                onClick={() => setEditing(member)}
              >
                <PencilIcon className="size-4" aria-hidden />
              </Button>
            );
          }}
        />
      )}

      {editing && (
        <MemberEditDialog
          key={editing.id}
          member={editing}
          campuses={campuses}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
