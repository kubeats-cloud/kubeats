"use client";

import { useActionState, useState } from "react";
import {
  CheckCircle2Icon,
  Trash2Icon,
  TriangleAlertIcon,
  UserPlusIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { createMember, deleteMember } from "@/lib/admin-actions";
import {
  EMPTY_DELETE_MEMBER_STATE,
  EMPTY_MEMBER_STATE,
  type MemberState,
} from "@/lib/admin-form-state";
import {
  MIN_PASSWORD,
  confirmationMatches,
  fieldErrorsFrom,
  newMemberSchema,
} from "@/lib/validation/admin";
import {
  suggestEmailCorrection,
  suggestedDomainOf,
} from "@/lib/validation/email-typos";
import type { TeamMember } from "@/lib/admin";
import { campusLabel, type Campus } from "@/lib/campus-display";
import { CHECK_FIELDS, FormNotice } from "@/components/form-notice";

/**
 * The team, and the only way an account gets created.
 *
 * There is no self-signup: an admin makes the account, hands over a temporary
 * password in person, and the rep changes it. The password field is left empty
 * on success and the password is never echoed back — the admin has just typed
 * it, so showing it again adds nothing and puts it on a screen in an office.
 */
export function TeamPanel({
  members,
  campuses,
}: {
  members: TeamMember[];
  /** The five. The demo campus is excluded — nobody is posted to it. */
  campuses: Campus[];
}) {
  const [serverState, formAction, isPending] = useActionState(
    createMember,
    EMPTY_MEMBER_STATE,
  );
  const [clientState, setClientState] = useState<MemberState>(EMPTY_MEMBER_STATE);
  const [role, setRole] = useState("rep");
  // A rep works from one campus; an admin sees every campus and has none. The
  // field clears itself when the role flips to admin so a stale choice cannot
  // be submitted — FO021 would refuse it, and a rejection the form could have
  // prevented is a rejection the form should have prevented.
  const [campusId, setCampusId] = useState("");
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [adding, setAdding] = useState(false);

  /*
   * Deleting a member — one dialog for the whole panel, not one per row.
   *
   * THE STATE HAS TO LIVE UP HERE, and that is not a tidiness preference. A
   * successful delete revalidates the page and the member's row disappears, so
   * a `useActionState` owned by the row would unmount along with it and take
   * the receipt with it — the admin would see the row vanish and never learn
   * what was actually removed. Held at panel level, the dialog outlives the row
   * it was opened from.
   *
   * It also means one action hook instead of one per member, which matters on a
   * team of twenty.
   */
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteMember,
    EMPTY_DELETE_MEMBER_STATE,
  );
  /** The member the dialog is currently about. Null when it is closed. */
  const [confirming, setConfirming] = useState<TeamMember | null>(null);
  /** What the admin has typed into the confirmation box. */
  const [typedName, setTypedName] = useState("");
  /*
   * Whether the dialog now open has actually been submitted.
   *
   * `useActionState` has no reset, so a finished delete's receipt stays in
   * `deleteState` for ever — and without this it would render the moment the
   * dialog was opened for the NEXT member, claiming a delete that had not
   * happened. Reading "did this dialog submit" rather than "is there a result
   * lying around" is what keeps the receipt attached to the right member.
   * Same problem, same shape of answer, as `dismissed` in sign-out-button.tsx.
   */
  const [submitted, setSubmitted] = useState(false);

  const receipt = submitted ? deleteState.deleted : undefined;

  function openDelete(member: TeamMember) {
    setConfirming(member);
    setTypedName("");
    setSubmitted(false);
  }

  function closeDelete() {
    setConfirming(null);
    setTypedName("");
    setSubmitted(false);
  }

  /*
   * The same rule the server will apply, asked here so the button is not
   * offered until it would succeed. `confirmationMatches` is exported from the
   * schema module precisely so this cannot be a second, slightly different
   * guess at what counts as a match.
   */
  const confirmed = confirming
    ? confirmationMatches(typedName, confirming.name)
    : false;

  /**
   * Dispatched by hand, like the create form above and for the same reason.
   *
   * React resets a form it is driving, and a reset event makes every Radix
   * Select in that form revert to its MOUNT value — the chain log-visit-form.tsx
   * documents. There is no Select in this dialog today, so nothing would revert;
   * it is written this way because the invariant is the file's, not this form's,
   * and log-visit-form.test.ts holds every form in these components to it. A
   * form that takes `action=` is one Select away from the bug whether or not it
   * has one now.
   *
   * `submitted` is flipped here rather than in an effect, so the receipt below
   * belongs to this dialog's own submission and cannot be a previous delete's
   * result still sitting in `deleteState`.
   */
  function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSubmitted(true);
    deleteAction(formData);
  }
  /*
   * The typo the admin has already been shown and chosen to keep.
   *
   * Holding the ADDRESS rather than a boolean is what makes "proceed anyway"
   * survive a correction: dismiss the warning on `…@gamil.con`, then edit the
   * address to `…@gmial.com`, and the second typo is a different string, so it
   * warns again instead of riding through on the first dismissal.
   */
  const [typoAccepted, setTypoAccepted] = useState<string | null>(null);

  const suggestion = suggestEmailCorrection(values.email);
  const normalisedEmail = values.email.trim().toLowerCase();
  /*
   * SHOWN and CONFIRMED are two questions, and collapsing them into one was a
   * bug worth naming: if the warning hid itself the moment it was accepted, the
   * admin's first press of Add would do nothing, say nothing, and leave them
   * pressing a button that looked broken. So the warning stays up for as long
   * as the address looks wrong, and acceptance only decides whether the NEXT
   * press submits.
   */
  const typoConfirmed = typoAccepted === normalisedEmail;

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  /**
   * Submitted by hand so React never resets the form.
   *
   * THE HARM HERE IS THE `role` SELECT, and it is the sharpest of the set. It
   * mounts as "rep", and a Radix Select restores its MOUNT value whenever a
   * `reset` event reaches the form - which React fires after any action
   * completes, failed ones included. See log-visit-form.tsx for the chain.
   *
   * The failure that triggers it is the ordinary one: create an ADMIN, get
   * "That already exists" back because the address is taken, correct the
   * address, submit again - and an account that was meant to administer the
   * team is created as a rep. Nothing says so, because "rep" is a valid role.
   * A silently wrong ROLE is a privilege decision, which is why this one was
   * worth fixing even though it is recoverable by an admin afterwards.
   *
   * `campusId` shares the mechanism but not the danger: it reverts to "", which
   * FO021 and the schema both refuse for a rep, so it fails loudly.
   *
   * FormData is captured before the state updates, so the credentials sent are
   * the ones typed rather than the cleared boxes.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const parsed = newMemberSchema.safeParse({
      ...values,
      role,
      campus_id: role === "rep" ? campusId : "",
    });
    if (!parsed.success) {
      setClientState({
        error: CHECK_FIELDS,
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }
    /*
     * THE WARNING'S ONE CHANCE TO BE READ, and deliberately not a refusal.
     *
     * The first submit on a suspicious address stops here and shows the
     * suggestion; pressing Add again goes through unchanged. That costs an
     * admin who meant it one extra tap, and catches the one who did not at the
     * only moment the mistake is still free to fix — before an auth user exists
     * on a dead address.
     *
     * It sits AFTER the schema parse so a genuinely malformed address is
     * reported as an error rather than as a suggestion, and BEFORE formAction
     * so nothing has been created yet.
     */
    if (suggestion && !typoConfirmed) {
      setTypoAccepted(normalisedEmail);
      setClientState(EMPTY_MEMBER_STATE);
      return;
    }

    setClientState(EMPTY_MEMBER_STATE);
    setValues({ name: "", email: "", password: "" });
    setTypoAccepted(null);
    formAction(formData);
  }

  const field = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Team
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Phone: cards. Desktop: a table, because an admin reading this is
            comparing a column of people, not scrolling one. */}
        <ul className="space-y-2 md:hidden">
          {members.map((member) => (
            <li
              key={member.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {member.email ?? "email unavailable"}
                </p>
              </div>
              <Badge
                variant={member.role === "admin" ? "neutral" : "success"}
                className="shrink-0 capitalize"
              >
                {member.role}
              </Badge>
              {member.campusName && (
                <span className="text-muted-foreground truncate text-xs">
                  {member.campusName}
                </span>
              )}
              <DeleteTrigger member={member} onOpen={openDelete} />
            </li>
          ))}
        </ul>

        <div className="border-border hidden overflow-hidden rounded-md border md:block">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Everyone with an account</caption>
            <thead>
              <tr className="border-border bg-secondary/50 text-muted-foreground border-b text-left">
                <th scope="col" className="px-4 py-2 text-xs font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 text-xs font-medium">
                  Email
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-medium">
                  Role
                </th>
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.id}
                  className="border-border hover:bg-accent/50 border-b transition-colors last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium">{member.name}</td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {member.email ?? "email unavailable"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge
                      variant={member.role === "admin" ? "neutral" : "success"}
                      className="capitalize"
                    >
                      {member.role}
                    </Badge>
                      {member.campusName && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {member.campusName}
                        </span>
                      )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <DeleteTrigger member={member} onOpen={openDelete} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {serverState.created && (
          <div
            role="status"
            className="bg-success-subtle text-success-subtle-foreground space-y-1 rounded-md px-3 py-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2Icon className="size-4" aria-hidden />
              {serverState.created.name} can sign in now
            </p>
            <p>
              Give them {serverState.created.email} and the password you just
              typed, and ask them to change it. The password is not shown again.
            </p>
          </div>
        )}

        {!adding ? (
          <Button
            type="button"
            className="h-11 w-full"
            onClick={() => setAdding(true)}
          >
            <UserPlusIcon className="size-4" aria-hidden />
            Add a team member
          </Button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="hidden" name="role" value={role} />

            <div className="space-y-2">
              <Label htmlFor="member-name">Name</Label>
              <Input
                id="member-name"
                name="name"
                className="h-11"
                maxLength={120}
                autoComplete="off"
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                aria-invalid={fieldErrors.name ? true : undefined}
              />
              {field("name")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                name="email"
                type="email"
                inputMode="email"
                className="h-11"
                autoComplete="off"
                value={values.email}
                onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={suggestion ? "member-email-typo" : undefined}
              />
              {field("email")}

              {/*
                A SUGGESTION, NOT AN ERROR — amber, not red, and it never
                disables Add. The correction is a button because retyping a
                domain by hand is how a second typo gets made.
              */}
              {suggestion && (
                <div
                  id="member-email-typo"
                  role="status"
                  className="bg-warning-subtle text-warning-subtle-foreground space-y-2 rounded-md px-3 py-2 text-xs"
                >
                  <p>
                    Did you mean{" "}
                    <span className="font-semibold">
                      {suggestedDomainOf(suggestion)}
                    </span>
                    ? Check the address before creating the account — a wrong one
                    cannot be used to reset a password.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => {
                        setValues((v) => ({ ...v, email: suggestion }));
                        setTypoAccepted(null);
                      }}
                    >
                      Use {suggestedDomainOf(suggestion)}
                    </Button>
                    <span className="self-center">
                      {typoConfirmed
                        ? "or press Add to create it as typed."
                        : "or press Add again to keep what you typed."}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-password">Temporary password</Label>
              <Input
                id="member-password"
                name="password"
                type="password"
                className="h-11"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) =>
                  setValues((v) => ({ ...v, password: e.target.value }))
                }
                aria-invalid={fieldErrors.password ? true : undefined}
              />
              <p className="text-muted-foreground text-xs">
                At least {MIN_PASSWORD} characters. Hand it over in person and
                ask them to change it.
              </p>
              {field("password")}
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rep">Rep (logs their own visits)</SelectItem>
                  <SelectItem value="admin">
                    Admin (sees the team and these settings)
                  </SelectItem>
                </SelectContent>
              </Select>
              {field("role")}
            </div>

            {/* Shown only for a rep. An admin is not posted to a campus, so
                offering them one would be offering a choice with no meaning. */}
            {role === "rep" && (
              <div className="space-y-2">
                <Label>Campus</Label>
                <Select value={campusId} onValueChange={setCampusId}>
                  <SelectTrigger className="h-11 w-full" aria-label="Campus">
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
                <input type="hidden" name="campus_id" value={campusId} />
                <p className="text-muted-foreground text-xs">
                  They will see only this campus&rsquo;s institutes, visits and
                  materials. It cannot be changed from here afterwards.
                </p>
                {field("campus_id")}
              </div>
            )}

            {error && (
              <FormNotice message={error} />
            )}

            <div className="flex gap-2">
              <Button type="submit" className="h-11 flex-1" disabled={isPending}>
                {isPending ? "Creating…" : "Create account"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => {
                  setAdding(false);
                  setValues({ name: "", email: "", password: "" });
                  setClientState(EMPTY_MEMBER_STATE);
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/*
          THE DELETE DIALOG — one for the panel, outside the list, so it
          survives the row it was opened from disappearing on success.

          Escape and the overlay close it while nothing has been submitted;
          once the delete has run they are the only way out, because the receipt
          is the admin's one chance to see what went.
        */}
        <Dialog
          open={confirming !== null}
          onOpenChange={(next) => {
            if (!next && !deletePending) closeDelete();
          }}
        >
          <DialogContent showCloseButton={false} className="max-w-md">
            {receipt ? (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2Icon
                      className="text-success size-5 shrink-0"
                      aria-hidden
                    />
                    {receipt.name} has been deleted
                  </DialogTitle>
                  <DialogDescription className="text-left">
                    Their account, their work and their photographs are gone.
                    This cannot be undone from here.
                  </DialogDescription>
                </DialogHeader>

                {/*
                  WHAT ACTUALLY WENT, counted by the database as it went rather
                  than promised beforehand. An admin who has just destroyed
                  somebody's history is owed a receipt, and a figure worked out
                  before the delete would be a guess wearing the clothes of one.
                */}
                <dl className="border-border divide-border divide-y rounded-md border text-sm">
                  {REMOVED_LABELS.filter(
                    ([key]) => (receipt.removed[key] ?? 0) > 0,
                  ).map(([key, label]) => (
                    <div key={key} className="flex justify-between px-3 py-2">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">
                        {receipt.removed[key]}
                      </dd>
                    </div>
                  ))}
                  <div className="flex justify-between px-3 py-2">
                    <dt className="text-muted-foreground">Photographs</dt>
                    <dd className="font-medium tabular-nums">{receipt.photos}</dd>
                  </div>
                </dl>

                <DialogFooter>
                  <Button
                    type="button"
                    className="h-11 w-full sm:w-auto"
                    onClick={closeDelete}
                  >
                    Done
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <form onSubmit={handleDelete}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <TriangleAlertIcon
                      className="text-danger size-5 shrink-0"
                      aria-hidden
                    />
                    Delete {confirming?.name}?
                  </DialogTitle>
                  <DialogDescription className="text-left">
                    This permanently removes their account and everything they
                    recorded. It cannot be undone.
                  </DialogDescription>
                </DialogHeader>

                <input type="hidden" name="member" value={confirming?.id ?? ""} />

                {/*
                  Said plainly, because "all their data" means nothing until it
                  is a list. The second half matters just as much: an admin
                  worrying about the shared library should not have to guess.
                */}
                <ul className="text-muted-foreground my-4 list-disc space-y-1 pl-5 text-xs">
                  <li>Every visit they logged, and the report on each</li>
                  <li>Their daily plans and their weekly targets</li>
                  <li>The institutes they own, and those institutes&rsquo; history</li>
                  <li>Every photograph they took</li>
                  <li>Their sign-in</li>
                </ul>
                <p className="text-muted-foreground mb-4 text-xs">
                  Shared materials stay. Visits logged by other reps stay, and
                  if any of their institutes carries a colleague&rsquo;s work
                  this will refuse rather than delete it.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="confirm-name">
                    Type{" "}
                    <span className="text-foreground font-medium">
                      {confirming?.name}
                    </span>{" "}
                    to confirm
                  </Label>
                  <Input
                    id="confirm-name"
                    name="confirm_name"
                    className="h-11"
                    autoComplete="off"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    aria-invalid={
                      deleteState.fieldErrors.confirm_name ? true : undefined
                    }
                  />
                  {deleteState.fieldErrors.confirm_name && (
                    <p className="text-danger text-xs">
                      {deleteState.fieldErrors.confirm_name}
                    </p>
                  )}
                </div>

                {deleteState.error && (
                  <div className="mt-4">
                    <FormNotice message={deleteState.error} />
                  </div>
                )}

                <DialogFooter className="mt-5 gap-2 sm:gap-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    className="h-11 w-full sm:w-auto"
                    // The same rule the server applies. Disabled rather than
                    // hidden, so the reason is visible: the box above is empty
                    // or does not match.
                    disabled={!confirmed || deletePending}
                  >
                    {deletePending ? "Deleting…" : "Delete permanently"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full sm:w-auto"
                    onClick={closeDelete}
                    disabled={deletePending}
                  >
                    Cancel
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/**
 * The per-row Delete, and the two people it is never offered for.
 *
 * SELF and the LAST ADMIN are both refused by `deleteMember()` and again by
 * `delete_member()` in the database, so this decides nothing — it is what stops
 * an admin walking into a refusal they could have been spared. Rendering a
 * disabled button with a title is better than rendering nothing: an absent
 * button looks like a bug, a disabled one with a reason looks like a rule.
 */
function DeleteTrigger({
  member,
  onOpen,
}: {
  member: TeamMember;
  onOpen: (member: TeamMember) => void;
}) {
  const blocked = member.isSelf
    ? "You cannot delete your own account"
    : member.isLastAdmin
      ? "The only admin account cannot be deleted"
      : member.isUnnamed
        ? "Give this member a name before deleting them"
        : null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-danger size-9 shrink-0"
      aria-label={
        blocked ? `${blocked}: ${member.name}` : `Delete ${member.name}`
      }
      title={blocked ?? `Delete ${member.name}`}
      disabled={blocked !== null}
      onClick={() => onOpen(member)}
    >
      <Trash2Icon className="size-4" aria-hidden />
    </Button>
  );
}

/**
 * What the RPC's row counts are called on screen, in the order they are
 * removed.
 *
 * A list rather than a lookup, so the receipt reads in teardown order and so a
 * key the database returns that nobody has named here is simply not shown —
 * better a short receipt than one with `weekly_targets_pre_0013` in it.
 */
const REMOVED_LABELS: [string, string][] = [
  ["visits", "Visits"],
  ["visit_people", "People met"],
  ["daily_plans", "Planned visits"],
  ["targets", "Weekly targets"],
  ["weekly_targets", "Weekly targets (archive)"],
  ["weekly_targets_pre_0013", "Weekly targets (archive)"],
  ["institutes", "Institutes they owned"],
  ["profiles", "Profile"],
];
