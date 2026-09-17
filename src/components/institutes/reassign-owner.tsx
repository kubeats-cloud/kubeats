"use client";

import { useActionState, useState } from "react";
import { UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/form-section";
import { FormNotice } from "@/components/form-notice";
import { reassignInstitute } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";
import type { CampusRep } from "@/lib/admin";

/**
 * Who an institute belongs to, and how an admin moves it.
 *
 * ADMIN-ONLY, and rendered nowhere else. A rep sees only institutes they own,
 * so this card would tell them their own name and offer them a control they are
 * refused — `guard_institute_owner()` (FO010) has refused a rep since 0016.
 *
 * WHAT THIS ACTUALLY DOES is grant and revoke access, not update a field. Once
 * rep-owned institutes ship, `registered_by` is the column `institutes_select`
 * keys on: moving it hands one rep the institute's detail, its status journey
 * and its row in Pending, and takes all three from another. The confirmation
 * wording says so rather than reading like an edit.
 *
 * ONLY SAME-CAMPUS REPS ARE OFFERED. Campus is still the outer boundary, so a
 * rep on another campus could not see the institute even after being handed it
 * — the move would succeed and change nothing anyone could use. The picker is
 * the courtesy; FO025 in the database is the control, and refuses it outright.
 *
 * AND NOT THE CURRENT OWNER. Reassigning to whoever already holds it is a write
 * that changes nothing and then reports success, which is worse than being
 * refused. Taking them out of the list also surfaces the case this card used to
 * render as an empty dropdown: a one-rep campus whose rep already owns the
 * institute. That gets a sentence of its own below.
 */
export function ReassignOwner({
  instituteId,
  ownerId,
  ownerName,
  reps,
}: {
  instituteId: string;
  /**
   * The owner's id, so they can be taken out of the list of candidates.
   *
   * Separate from `ownerName` because a name cannot be matched safely: two reps
   * on one campus may share one, and `registered_by` is what the action writes.
   */
  ownerId: string | null;
  /** Null when nobody owns it — see the Unassigned note below. */
  ownerName: string | null;
  /** Reps on THIS institute's campus. Empty if the campus has none. */
  reps: CampusRep[];
}) {
  const [state, formAction, isPending] = useActionState(
    reassignInstitute,
    EMPTY_ADMIN_STATE,
  );
  const [member, setMember] = useState("");

  /*
   * WHO IT CAN ACTUALLY GO TO, which is not the same as who is on the campus.
   *
   * Handing an institute to the rep who already owns it writes the value that
   * is already there: no permission changes, nothing moves, and the card says
   * "Reassigned. It now belongs to that rep." — a success message for an event
   * that did not happen. So the owner comes out of the list.
   *
   * That in turn creates the state this exists to name. A campus with one rep
   * is the ordinary case for this client, and once that rep owns the institute
   * the picker is EMPTY: a dropdown with nothing in it, above a button that
   * cannot be pressed, with no explanation. `reps.length === 0` was already
   * handled — "no reps on this campus at all" — but this one looked identical
   * and meant something quite different.
   */
  const candidates = reps.filter((rep) => rep.id !== ownerId);

  return (
    <FormSection
      title="Who this belongs to"
      description="Only this rep sees it, plans visits to it, and has it in their Pending."
    >
      <div className="flex flex-wrap items-center gap-2">
        <UserIcon className="text-muted-foreground size-4" aria-hidden />
        {ownerName ? (
          <span className="text-sm font-medium">{ownerName}</span>
        ) : (
          /*
            NOT A BLANK, and not "—". `registered_by` is `on delete set null`, so
            removing a departed rep's profile orphans every institute they
            registered — and an orphan is invisible to EVERY rep at once, with
            nothing else on any screen to say so. This badge is the only place
            that state surfaces, which is why it is loud.
          */
          <Badge variant="danger">Unassigned: no rep can see this</Badge>
        )}
      </div>

      {reps.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          There are no reps on this institute&rsquo;s campus to hand it to. Add
          one in Settings, or move the institute to another campus first.
        </p>
      ) : candidates.length === 0 ? (
        /*
          THE SOLE REP ALREADY OWNS IT. Said as its own sentence rather than
          folded into the empty-campus one above, because the two have different
          answers: that one wants another rep created, this one is simply
          finished. Nothing is wrong and there is nothing to do.
        */
        <p className="text-muted-foreground text-xs">
          No other reps on this campus to reassign to.{" "}
          {ownerName ? `${ownerName} is` : "Its owner is"} the only one, so
          there is nowhere to move it. Add another rep in Settings first.
        </p>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="institute_id" value={instituteId} />
          <input type="hidden" name="member" value={member} />

          <div className="space-y-2">
            <Label>Hand it to</Label>
            {/* Mounts EMPTY, like every other admin picker in this app: a Radix
                Select reverts to its mount value when React resets the form,
                and a revert to nothing is refused with a sentence rather than
                quietly reassigning to whoever happened to be first. */}
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-11 w-full" aria-label="Hand it to">
                <SelectValue placeholder="Choose a rep on this campus" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((rep) => (
                  <SelectItem key={rep.id} value={rep.id}>
                    {rep.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full"
            disabled={isPending || member === ""}
          >
            {isPending ? "Reassigning…" : "Reassign"}
          </Button>

          <p className="text-muted-foreground text-xs">
            The visits already logged here stay with the rep who made them.
          </p>

          {state.error && <FormNotice message={state.error} />}
          {state.ok && state.message && (
            <p
              role="status"
              className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
            >
              {state.message}
            </p>
          )}
        </form>
      )}
    </FormSection>
  );
}
