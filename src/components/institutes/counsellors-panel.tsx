"use client";

import { useActionState, useState, useTransition } from "react";
import { MailIcon, PhoneIcon, PlusIcon, UserRoundIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormNotice } from "@/components/form-notice";
import { addCounsellor, removeCounsellor } from "@/lib/institute-actions";
import { EMPTY_COUNSELLOR_STATE } from "@/lib/institute-form-state";
import {
  counsellorFormDataToInput,
  counsellorSchema,
  fieldErrorsFrom,
} from "@/lib/validation/institute";
import type { Counsellor } from "@/lib/institutes";

/**
 * The counsellors at one institute: a list, and a `+` that adds another.
 *
 * ALONGSIDE the two fixed contacts the institute already carries — the
 * principal/owner pair and the decision-maker trio — and replacing neither.
 * Those are the people a school has ONE of; this is the list it has several of,
 * and which changes as staff change.
 *
 * SHOWN TO THE OWNING REP AS WELL AS TO AN ADMIN, and uncapped for both. This
 * is deliberately NOT subject to B1's one-time edit allowance: a contact list
 * that could be corrected once would be useless within a term. Migration 0036's
 * trigger is scoped to a column list on `institutes`, so writing this table
 * cannot spend that allowance even by accident — the two features cannot
 * interact.
 *
 * THE BOUNDARY IS RLS, NOT THIS COMPONENT. `institute_counsellors_*` (0037)
 * reach through the parent institute, so a rep who somehow rendered this
 * against a colleague's institute would read nothing and write nothing. The
 * `canWrite` prop decides what to DRAW, not what is permitted.
 *
 * ADD IS A FORM, REMOVE IS A TRANSITION. The add path wants field-level
 * validation and error messages, which `useActionState` gives it; remove is one
 * id and one confirmation, so it does not need a form around it.
 */
export function CounsellorsPanel({
  instituteId,
  counsellors,
  canWrite,
}: {
  instituteId: string;
  counsellors: Counsellor[];
  /** Whether to offer the controls. An admin, or the rep who owns this row. */
  canWrite: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    addCounsellor,
    EMPTY_COUNSELLOR_STATE,
  );
  const [clientState, setClientState] = useState(EMPTY_COUNSELLOR_STATE);
  const [open, setOpen] = useState(false);
  const [removing, startRemoving] = useTransition();

  // One attempt is explained at a time: pairing a server summary with stale
  // client field errors is how a form starts contradicting itself. Same rule
  // `daily-plan.tsx` states for its own two states.
  const shown = state.error ? state : clientState;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = counsellorSchema.safeParse(
      counsellorFormDataToInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      // Stops the server action too: React skips a form action when the submit
      // event has been prevented. Nothing is sent, and the rep is told why.
      event.preventDefault();
      setClientState({
        error: "Check the highlighted fields.",
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_COUNSELLOR_STATE);
    // React resets the form after its action runs, which is what clears the
    // three inputs. The panel stays open so several can be added in a row.
  }

  return (
    <div className="space-y-3">
      {counsellors.length === 0 ? (
        <p className="text-muted-foreground text-sm">No counsellors recorded.</p>
      ) : (
        <ul className="space-y-2">
          {counsellors.map((person) => (
            <li key={person.id}>
              <Card className="gap-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <UserRoundIcon
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{person.name}</span>
                    </p>
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {/* Tappable, because a rep is holding a phone — the same
                          treatment the detail page's Phone component gives the
                          principal's number. */}
                      {person.phone && (
                        <a
                          href={`tel:${person.phone}`}
                          className="text-primary inline-flex items-center gap-1 underline-offset-2 hover:underline"
                        >
                          <PhoneIcon className="size-3" aria-hidden />
                          {person.phone}
                        </a>
                      )}
                      {person.email && (
                        <a
                          href={`mailto:${person.email}`}
                          className="text-primary inline-flex items-center gap-1 break-all underline-offset-2 hover:underline"
                        >
                          <MailIcon className="size-3 shrink-0" aria-hidden />
                          {person.email}
                        </a>
                      )}
                      {!person.phone && !person.email && (
                        <span>No contact details recorded</span>
                      )}
                    </div>
                  </div>

                  {canWrite && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-11 shrink-0"
                      aria-label={`Remove ${person.name}`}
                      disabled={removing}
                      onClick={() =>
                        startRemoving(async () => {
                          await removeCounsellor(instituteId, person.id);
                        })
                      }
                    >
                      <XIcon className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canWrite &&
        (open ? (
          <Card className="gap-0 p-4">
            <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
              <input type="hidden" name="institute_id" value={instituteId} />

              <div className="space-y-1.5">
                <Label htmlFor="counsellor-name">Name</Label>
                <Input
                  id="counsellor-name"
                  name="counsellor_name"
                  className="h-11"
                  maxLength={120}
                  placeholder="Who is the counsellor?"
                  aria-invalid={shown.fieldErrors.name ? true : undefined}
                />
                <FieldError message={shown.fieldErrors.name} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="counsellor-phone">Phone (optional)</Label>
                  <Input
                    id="counsellor-phone"
                    name="counsellor_phone"
                    inputMode="numeric"
                    className="h-11"
                    maxLength={10}
                    placeholder="10 digits"
                    aria-invalid={shown.fieldErrors.phone ? true : undefined}
                  />
                  <FieldError message={shown.fieldErrors.phone} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="counsellor-email">Email (optional)</Label>
                  <Input
                    id="counsellor-email"
                    name="counsellor_email"
                    type="email"
                    className="h-11"
                    maxLength={254}
                    placeholder="name@school.edu"
                    aria-invalid={shown.fieldErrors.email ? true : undefined}
                  />
                  <FieldError message={shown.fieldErrors.email} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="h-11 flex-1" disabled={isPending}>
                  {isPending ? "Adding…" : "Add counsellor"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    setOpen(false);
                    setClientState(EMPTY_COUNSELLOR_STATE);
                  }}
                >
                  Close
                </Button>
              </div>

              {shown.error && <FormNotice message={shown.error} />}
            </form>
          </Card>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setOpen(true)}
          >
            <PlusIcon className="size-4" aria-hidden />
            Add a counsellor
          </Button>
        ))}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-danger text-xs">{message}</p>;
}
