"use client";

import { useActionState, useState } from "react";
import { ShieldCheckIcon, UserIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { FormNotice } from "@/components/form-notice";
import { setMemberCreator } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";
import type { TeamMember } from "@/lib/admin";

/**
 * Who created whom — VIEW-ONLY, and flat on purpose.
 *
 * TWO LEVELS, AND THERE IS NO THIRD. The model this app has is `role` (rep or
 * admin) crossed with `campus_id`, and nothing else: there is no reports-to
 * column, no manager, no chain, and `profiles.created_by` (migration 0034) is
 * NOT one. It records which admin opened an account and is read by this screen
 * and nowhere else — no policy, trigger or query consults it to decide what
 * anybody may see. So this renders exactly what the column says and offers no
 * way to nest anything under anything.
 *
 * AN ADMIN CREATED BY ANOTHER ADMIN APPEARS TWICE, and that is correct rather
 * than a bug to be tidied: once as a child of whoever made their account, and
 * once as a root with the people they have made since. Collapsing the two into
 * a tree is precisely the reports-to chain above, arrived at by accident.
 *
 * WHAT THE PICKER IS FOR. Every account created from now on is stamped by
 * `createMember()`, so it arrives with a creator. The accounts that predate
 * 0034 have none — that migration backfills nothing rather than guessing, since
 * nothing in the database ever recorded the fact — and this is where an admin
 * who knows the answer fills one in. It is the only hand-written path to the
 * column, and it is why a view-only chart has one control on it.
 */
export function HierarchyChart({ members }: { members: TeamMember[] }) {
  /*
   * ONE ACTION HOOK FOR THE WHOLE SCREEN, not one per row.
   *
   * The same call team-panel.tsx makes for its delete dialog, for the same
   * reason: a successful write revalidates the page and the row moves out of
   * the unrecorded list, so a `useActionState` owned by that row would unmount
   * along with it and take the receipt with it. Held here, the message outlives
   * the row it came from — and it is one hook rather than one per member.
   */
  const [state, formAction, isPending] = useActionState(
    setMemberCreator,
    EMPTY_ADMIN_STATE,
  );
  /** What has been chosen in each unrecorded row's picker, keyed by member id. */
  const [choices, setChoices] = useState<Record<string, string>>({});

  const admins = members.filter((member) => member.role === "admin");
  const unrecorded = members.filter((member) => member.createdBy === null);

  /** Everyone an admin created, grouped under them. */
  const childrenOf = (adminId: string) =>
    members.filter((member) => member.createdBy === adminId);

  return (
    <div className="space-y-5">
      {admins.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No admins to chart"
          description="Accounts are created by admins, so the hierarchy starts with them. Add one in Settings."
        />
      ) : (
        <ul className="space-y-4">
          {admins.map((admin) => {
            const created = childrenOf(admin.id);
            return (
              <li key={admin.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <ShieldCheckIcon
                        className="text-primary size-4 shrink-0"
                        aria-hidden
                      />
                      {admin.name}
                      <Badge variant="neutral" className="capitalize">
                        admin
                      </Badge>
                      <span className="text-muted-foreground text-xs font-normal">
                        {created.length === 0
                          ? "no accounts created"
                          : `created ${created.length} ${
                              created.length === 1 ? "account" : "accounts"
                            }`}
                      </span>
                    </CardTitle>
                    {/* Where they sit in the chart themselves. An admin created
                        by another admin is a child there AND a root here — see
                        the note at the top of this file. */}
                    {admin.createdByName && (
                      <p className="text-muted-foreground text-xs">
                        Account created by {admin.createdByName}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {created.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        Nobody has been created by this admin yet. Accounts made
                        before this was recorded are listed below.
                      </p>
                    ) : (
                      <ul className="border-border space-y-2 border-l pl-4">
                        {created.map((member) => (
                          <li
                            key={member.id}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <UserIcon
                              className="text-muted-foreground size-4 shrink-0"
                              aria-hidden
                            />
                            <span className="text-sm font-medium">{member.name}</span>
                            <Badge
                              variant={
                                member.role === "admin" ? "neutral" : "success"
                              }
                              className="capitalize"
                            >
                              {member.role}
                            </Badge>
                            {member.campusName && (
                              <span className="text-muted-foreground text-xs">
                                {member.campusName}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        THE ROWS THAT PREDATE THE COLUMN.

        Not an error state and not styled as one: an account created before
        migration 0034 has no creator recorded anywhere in the database, so this
        is simply what is not yet known. It also catches a second, rarer case —
        `created_by` is `on delete set null`, so deleting a departed admin
        returns everyone they created to this list.
      */}
      {unrecorded.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Not yet recorded
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {unrecorded.length}{" "}
                {unrecorded.length === 1 ? "account" : "accounts"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              These accounts were created before the app started keeping track,
              or the admin who created them has since been deleted. Nothing is
              wrong with them. Choose who created each one and it moves into the
              chart above.
            </p>

            {admins.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                There are no admins to choose from.
              </p>
            ) : (
              <ul className="space-y-3">
                {unrecorded.map((member) => {
                  const choice = choices[member.id] ?? "";
                  /* Never offer somebody as their own creator: FO028 refuses it
                     in the database and memberCreatorSchema refuses it in the
                     browser, so offering it would be offering a choice that can
                     only be rejected. */
                  const candidates = admins.filter(
                    (candidate) => candidate.id !== member.id,
                  );

                  return (
                    <li
                      key={member.id}
                      className="border-border rounded-md border px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <UserIcon
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden
                        />
                        <span className="text-sm font-medium">{member.name}</span>
                        <Badge
                          variant={member.role === "admin" ? "neutral" : "success"}
                          className="capitalize"
                        >
                          {member.role}
                        </Badge>
                        {member.campusName && (
                          <span className="text-muted-foreground text-xs">
                            {member.campusName}
                          </span>
                        )}
                      </div>

                      {candidates.length === 0 ? (
                        <p className="text-muted-foreground mt-2 text-xs">
                          The only admin is this account itself, and nobody
                          creates their own. Add another admin first.
                        </p>
                      ) : (
                        /*
                          LEFT ON THE ACTION PROP DELIBERATELY, and the reasoning
                          is reassign-owner.tsx's and the two dashboard forms':
                          React resets a form it drives, a reset makes a Radix
                          Select revert to its MOUNT value, and this one mounts
                          EMPTY. So a revert lands on "", the button is disabled
                          at "", and the schema refuses "" with a sentence. There
                          is nothing here that a revert could turn into a
                          different-but-valid answer — which is the test the
                          forms in log-visit-form.test.ts had to be cured of.

                          Nothing is cleared on submit either, so there is no
                          controlled state being torn out from under React while
                          it dispatches — the second half of that same bug, the
                          one the Settings panels were fixed for.
                        */
                        <form action={formAction} className="mt-3 space-y-2">
                          <input type="hidden" name="member" value={member.id} />
                          <input type="hidden" name="created_by" value={choice} />

                          <Label
                            htmlFor={`creator-${member.id}`}
                            className="text-muted-foreground text-xs font-medium"
                          >
                            Created by
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            <Select
                              value={choice}
                              onValueChange={(next) =>
                                setChoices((all) => ({ ...all, [member.id]: next }))
                              }
                            >
                              <SelectTrigger
                                id={`creator-${member.id}`}
                                className="h-11 flex-1"
                                aria-label={`Who created ${member.name}`}
                              >
                                <SelectValue placeholder="Choose an admin" />
                              </SelectTrigger>
                              <SelectContent>
                                {candidates.map((candidate) => (
                                  <SelectItem key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="submit"
                              variant="outline"
                              className="h-11"
                              disabled={isPending || choice === ""}
                            >
                              {isPending ? "Saving…" : "Record"}
                            </Button>
                          </div>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {state.error && <FormNotice message={state.error} />}
            {state.ok && state.message && (
              <p
                role="status"
                className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
              >
                {state.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
