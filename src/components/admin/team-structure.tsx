"use client";

import { useActionState } from "react";
import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormNotice } from "@/components/form-notice";
import { assignRepToTeam } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";
import type { TeamMember } from "@/lib/admin";

/**
 * Who reports to whom — the chart that DOES decide what people see (H3).
 *
 * ⚠ IT SITS BESIDE THE created_by CHART, NOT INSTEAD OF IT, and the contrast is
 * the documentation. That one records how the roster was set up and says in its
 * own description that it "does not decide what anyone can see"; this one is
 * `profiles.team_lead_id`, which every policy rewritten by 0042 turns on. Two
 * charts of the same people meaning opposite kinds of thing is exactly the
 * distinction this codebase has spent three migrations keeping straight, and
 * showing them together is the cheapest way to keep it visible.
 *
 * THREE TIERS, AND THE THIRD IS THE ONE THAT MATTERS ON DAY ONE. Admins, then
 * each team lead with their reps, then REPS ON NO TEAM — which is every rep
 * until somebody is assigned, because 0041 backfills nothing. A roster that
 * quietly omitted them would hide the entire starting state.
 *
 * WHO SEES WHAT IS RLS'S ANSWER. A team lead opening this page gets their own
 * reps and themselves, because `profiles_select` is supervises(id); there is no
 * filter here and must not be, or the screen and the policy could disagree.
 * `canAssign` decides whether the CONTROL renders, never which rows do.
 */
export function TeamStructure({
  members,
  canAssign,
}: {
  members: TeamMember[];
  /** An admin divides everybody; a team lead's own control is per-rep below. */
  canAssign: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    assignRepToTeam,
    EMPTY_ADMIN_STATE,
  );

  const admins = members.filter((m) => m.role === "admin");
  const leads = members.filter((m) => m.role === "team_lead");
  const reps = members.filter((m) => m.role === "rep");
  const unassigned = reps.filter((m) => !m.teamLeadId);

  /** A rep's lead must be on their campus — FO033 and FO034 both refuse otherwise. */
  const leadsFor = (rep: TeamMember) =>
    leads.filter((l) => l.campusId === rep.campusId);

  const RepRow = ({ rep }: { rep: TeamMember }) => (
    <li className="border-border flex flex-col gap-2 border-t px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link
          href={`/team/${rep.id}`}
          className="hover:text-primary truncate text-sm font-medium underline decoration-dotted underline-offset-4"
        >
          {rep.name}
        </Link>
        <p className="text-muted-foreground text-xs">
          {rep.campusName ?? "No campus"}
          {rep.ownedInstitutes > 0 && ` · ${rep.ownedInstitutes} institutes`}
        </p>
      </div>

      {canAssign && (
        <form action={formAction} className="flex shrink-0 items-center gap-2">
          <input type="hidden" name="member" value={rep.id} />
          <label className="sr-only" htmlFor={`lead-${rep.id}`}>
            Team lead for {rep.name}
          </label>
          {/*
            A plain <select>, not the Radix one. It posts its value with the
            form, which is what lets this be ONE control for assign AND release
            with no client state at all — "" is the release, as the schema says.

            Only leads on the REP'S OWN CAMPUS are offered, because FO033 and
            FO034 both refuse the rest and a picker that lists an option the
            database will reject is a picker that teaches people to distrust it.
          */}
          <select
            id={`lead-${rep.id}`}
            name="team_lead"
            defaultValue={rep.teamLeadId ?? ""}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            <option value="">— no team —</option>
            {leadsFor(rep).map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm" className="h-9" disabled={isPending}>
            Save
          </Button>
        </form>
      )}

      {!canAssign && rep.teamLeadName && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {rep.teamLeadName}
        </span>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {state.error && <FormNotice message={state.error} fieldErrors={state.fieldErrors} />}
      {!state.error && state.ok && state.message && (
        <p className="text-muted-foreground text-xs" role="status">
          {state.message}
        </p>
      )}

      {admins.length > 0 && (
        <Card className="gap-0 p-0">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">
              Admins
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                every campus, every team
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul>
              {admins.map((a) => (
                <li key={a.id} className="border-border border-t px-4 py-2.5 text-sm">
                  {a.name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {leads.map((lead) => {
        const theirs = reps.filter((r) => r.teamLeadId === lead.id);
        return (
          <Card key={lead.id} className="gap-0 p-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <UsersIcon className="size-4" aria-hidden />
                {lead.name}
                <Badge variant="neutral">{lead.campusName ?? "No campus"}</Badge>
                <span className="text-muted-foreground text-xs font-normal">
                  {theirs.length} rep{theirs.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {theirs.length === 0 ? (
                <p className="text-muted-foreground border-border border-t px-4 py-3 text-xs">
                  Nobody on this team yet.
                </p>
              ) : (
                <ul>
                  {theirs.map((rep) => (
                    <RepRow key={rep.id} rep={rep} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card className="gap-0 p-0">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">
              On no team
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                supervised by admins only
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* THE DAY-ONE STATE, and it is not an error. 0041 assigns nobody,
                so every rep starts here and moves out one at a time. */}
            <ul>
              {unassigned.map((rep) => (
                <RepRow key={rep.id} rep={rep} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {leads.length === 0 && (
        <p className="text-muted-foreground text-xs">
          No team leads yet. Create one from Settings → Team, then assign reps to
          them here.
        </p>
      )}
    </div>
  );
}
