"use client";

import { useActionState, useState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateMember } from "@/lib/admin-actions";
import { EMPTY_MEMBER_UPDATE_STATE } from "@/lib/admin-form-state";
import {
  fieldErrorsFrom,
  memberUpdateSchema,
} from "@/lib/validation/admin";
import type { TeamMember } from "@/lib/admin";
import { campusLabel, type Campus } from "@/lib/campus-display";
import { FormNotice } from "@/components/form-notice";

/**
 * THE member editor — name, campus and role — moved out of `TeamPanel` so the
 * Team tab can open the same form rather than a second one that would drift.
 *
 * MOUNTED ONCE PER LIST, outside its rows, for the reason the original dialog
 * documented: a successful edit revalidates the page and rebuilds every row, so
 * a form owned by a row would unmount mid-flight and take the receipt with it.
 * The parent keeps only WHICH member is being edited; this component keeps the
 * fields and the action state, and `key={member.id}` remounts it when the
 * parent switches members.
 *
 * WHAT IT DOES NOT OFFER: email, password, the id, and an admin's role. See
 * `memberUpdateSchema` for why each is its own decision rather than a field
 * beside a name.
 */
export function MemberEditDialog({
  member,
  campuses,
  onClose,
}: {
  /** The member being edited. The dialog is not rendered without one. */
  member: TeamMember;
  /** The five. The demo campus is excluded — nobody is posted to it. */
  campuses: Campus[];
  onClose: () => void;
}) {
  const [editState, formAction, editPending] = useActionState(
    updateMember,
    EMPTY_MEMBER_UPDATE_STATE,
  );
  const [editName, setEditName] = useState(member.name);
  const [editCampus, setEditCampus] = useState(member.campusId ?? "");
  const [editRole, setEditRole] = useState(member.role);
  /*
   * THE RETAG, AND IT DEFAULTS ON.
   *
   * This editor exists to correct a WRONG CAMPUS ALLOCATION, which is by far
   * the commoner of the two things a campus change can mean — and in that case
   * the institutes the rep owns were never on the old campus either, so they
   * have to move too. Leaving it off by default would make the ordinary
   * correction silently produce the broken state `correct_member_campus()`
   * (0035) exists to prevent: a rep on one campus whose whole pipeline is on
   * another, and therefore invisible to them.
   *
   * Unticking it is the genuine-transfer case, where those institutes really do
   * belong to the campus they were worked from. The dialog says what each
   * choice will do, with the count, before anything is submitted.
   */
  const [editRetag, setEditRetag] = useState(true);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  /** Same question, same answer, as the delete dialog: is this receipt ours? */
  const [editSubmitted, setEditSubmitted] = useState(false);

  const editReceipt = editSubmitted ? editState.updated : undefined;

  /**
   * Dispatched by hand, like every form in these components.
   *
   * There IS a Radix Select here — the campus — and it mounts holding the
   * member's CURRENT campus. A React reset would restore that, which is a
   * plausible value rather than an obviously empty one, so the admin could
   * correct a campus, hit a refusal, and resubmit against the value they were
   * trying to change. `log-visit-form.test.ts` holds this whole family of forms
   * to the onSubmit form for this class of bug.
   *
   * The FormData is captured before any state moves, so what is sent is what is
   * on screen.
   */
  function handleEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const parsed = memberUpdateSchema.safeParse({
      member: member.id,
      name: editName,
      // `!== "admin"` rather than `=== "rep"` since 0041: a team lead is
      // campus-scoped exactly as a rep is, and sending "" for one would have
      // the editor refuse (FO021) a row that is perfectly valid. The admin
      // branch is the one that must send nothing.
      campus_id: member.role !== "admin" ? editCampus : "",
      role: editRole,
      retag: editRetag,
    });
    if (!parsed.success) {
      setEditErrors(fieldErrorsFrom(parsed.error));
      return;
    }

    setEditErrors({});
    setEditSubmitted(true);
    formAction(formData);
  }

  /** Whether this edit would move the rep, which is what the warning is about. */
  const campusMoving =
    member.role !== "admin" &&
    editCampus !== "" &&
    editCampus !== (member.campusId ?? "");

  const movingTo = campuses.find((campus) => campus.id === editCampus);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !editPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {editReceipt ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CheckCircle2Icon
                  className="text-success size-5 shrink-0"
                  aria-hidden
                />
                Saved
              </DialogTitle>
              <DialogDescription className="text-left">
                {editReceipt.campus ? (
                  <>
                    {editReceipt.name} is now on {editReceipt.campus}.{" "}
                    {editReceipt.institutesMoved > 0
                      ? `${editReceipt.institutesMoved} institute${
                          editReceipt.institutesMoved === 1 ? "" : "s"
                        } moved with them.`
                      : "No institutes moved."}
                  </>
                ) : (
                  <>The team member was updated.</>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" className="h-11" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form key={member.id} onSubmit={handleEdit} noValidate>
            <DialogHeader>
              <DialogTitle className="text-base">
                Edit {member.name}
              </DialogTitle>
              <DialogDescription className="text-left">
                Edit their name, campus and role.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <input type="hidden" name="member" value={member.id} />
              <input type="hidden" name="role" value={editRole} />

              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  name="name"
                  className="h-11"
                  maxLength={120}
                  autoComplete="off"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-invalid={editErrors.name ? true : undefined}
                />
                {editErrors.name && (
                  <p className="text-danger text-xs">{editErrors.name}</p>
                )}
              </div>

              {member.role !== "admin" && (
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select value={editRole} onValueChange={setEditRole}>
                    <SelectTrigger id="edit-role" aria-label="Role" className="h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rep">Rep</SelectItem>
                      <SelectItem value="team_lead">Team Lead</SelectItem>
                    </SelectContent>
                  </Select>
                  {editErrors.role && <p className="text-danger text-xs">{editErrors.role}</p>}
                </div>
              )}

              {/* An admin has no campus and must not be given one — FO021
                  refuses it, so offering the field would be offering a choice
                  that can only be rejected. A team lead DOES have one (0041),
                  so the test is "not an admin" rather than "is a rep". */}
              {member.role !== "admin" ? (
                <div className="space-y-2">
                  <Label>Campus</Label>
                  <input
                    type="hidden"
                    name="campus_id"
                    value={editCampus}
                  />
                  <Select value={editCampus} onValueChange={setEditCampus}>
                    <SelectTrigger
                      className="h-11 w-full"
                      aria-label="Campus"
                      aria-invalid={editErrors.campus_id ? true : undefined}
                    >
                      <SelectValue placeholder="Which campus do they work from?" />
                    </SelectTrigger>
                    <SelectContent>
                      {campuses.map((campus) => (
                        <SelectItem key={campus.id} value={campus.id}>
                          {campusLabel(campus)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editErrors.campus_id && (
                    <p className="text-danger text-xs">
                      {editErrors.campus_id}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  An admin sees every campus and is not posted to one.
                </p>
              )}

              {/*
                THE COUNT FIRST, THE DECISION SECOND.

                Shown only once the campus has actually been changed, and only
                when there is a pipeline to move. An admin is about to decide
                what happens to every institute this rep owns, and the number is
                the whole of what they are deciding about — reporting it
                afterwards would be a receipt for a choice they were never
                offered.
              */}
              {campusMoving && member.ownedInstitutes > 0 && (
                <div className="bg-warning-subtle text-warning-subtle-foreground space-y-2 rounded-md px-3 py-3 text-xs">
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                      checked={editRetag}
                      onCheckedChange={(next) => setEditRetag(next === true)}
                      aria-label="Move their institutes to the new campus"
                    />
                    {editRetag && (
                      <input type="hidden" name="retag" value="on" />
                    )}
                    <span>
                      Move their {member.ownedInstitutes} institute
                      {member.ownedInstitutes === 1 ? "" : "s"} to{" "}
                      {movingTo ? campusLabel(movingTo) : "the new campus"}{" "}
                      as well.
                    </span>
                  </label>
                  <p>
                    {editRetag
                      ? "Correcting a campus that was recorded wrongly — the institutes they registered move with them and stay visible to them."
                      : "They really did work the old campus, so its institutes stay there. They will no longer be able to see them, and an admin will need to reassign each one to a rep on that campus."}
                  </p>
                </div>
              )}

              {/* No pipeline to worry about, so no choice to offer. */}
              {campusMoving && member.ownedInstitutes === 0 && (
                <p className="text-muted-foreground text-xs">
                  They own no institutes, so nothing moves with them.
                </p>
              )}

              {editState.error && <FormNotice message={editState.error} />}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={onClose}
                disabled={editPending}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11" disabled={editPending}>
                {editPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
