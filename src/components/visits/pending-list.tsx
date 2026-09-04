"use client";

import { useActionState, useState } from "react";
import { ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { EmptyState } from "@/components/states";
import { completeVisit } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { PendingVisit } from "@/lib/visits";
import { activityLabelFor } from "@/lib/validation/visit";

/**
 * Rule 3's other half — everything still at "Set", oldest first.
 *
 * Admins see the whole team's open loops but can only close their own: the RLS
 * update policy is `member = auth.uid()`. Rather than let an admin tap a button
 * that will always fail, the action is simply not offered on someone else's row.
 */
export function PendingList({
  visits,
  currentUserId,
}: {
  visits: PendingVisit[];
  currentUserId: string;
}) {
  const [closing, setClosing] = useState<PendingVisit | null>(null);

  if (visits.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="No open loops"
        description="Sessions and campus visits you schedule will wait here until you close them off."
      />
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      <ul className="space-y-3">
        {visits.map((visit) => {
          const due = new Date(visit.expected_date ?? visit.date);
          const overdue = due < today;
          const mine = visit.member === currentUserId;

          return (
            <li key={visit.id}>
              <Card className="gap-0 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{visit.instituteName}</p>
                    <p className="text-muted-foreground text-xs">
                      {activityLabelFor(visit.activity)}
                      {!mine && visit.memberName ? ` · ${visit.memberName}` : ""}
                    </p>
                  </div>
                  <Badge variant={overdue ? "danger" : "warning"} className="shrink-0">
                    {overdue ? "Overdue" : "Scheduled"}
                  </Badge>
                </div>

                <p className="text-muted-foreground mt-2 text-xs">
                  Expected {due.toLocaleDateString()}
                </p>

                {visit.notes && (
                  <p className="mt-2 line-clamp-2 text-sm">{visit.notes}</p>
                )}

                <div className="mt-3">
                  {mine ? (
                    <Button
                      type="button"
                      className="h-11 w-full"
                      onClick={() => setClosing(visit)}
                    >
                      Mark done and add summary
                    </Button>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Only {visit.memberName ?? "the owner"} can close this off.
                    </p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <CompletionDialog visit={closing} onClose={() => setClosing(null)} />
    </>
  );
}

function CompletionDialog({
  visit,
  onClose,
}: {
  visit: PendingVisit | null;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await completeVisit(prev, formData);
      if (result.ok) onClose();
      return result;
    },
    EMPTY_STATE,
  );

  return (
    <Dialog open={visit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Completion summary</DialogTitle>
          <DialogDescription>{visit?.instituteName}</DialogDescription>
        </DialogHeader>

        {visit && (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="visit_id" value={visit.id} />

            <div className="space-y-2">
              <Label htmlFor="students_attended">Students attended</Label>
              <Input
                id="students_attended"
                name="students_attended"
                inputMode="numeric"
                className="h-11"
                onChange={(event) => {
                  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="session_topic">Session / topic covered</Label>
              <Input
                id="session_topic"
                name="session_topic"
                className="h-11"
                maxLength={300}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="other_faculty_present">Other faculty present</Label>
              <Input
                id="other_faculty_present"
                name="other_faculty_present"
                className="h-11"
                maxLength={300}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="other_faculty_count">Number of other faculty</Label>
              <Input
                id="other_faculty_count"
                name="other_faculty_count"
                inputMode="numeric"
                className="h-11"
                onChange={(event) => {
                  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
                }}
              />
            </div>

            {state.error && (
              <p
                role="alert"
                className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
              >
                {state.error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" className="h-11 w-full" disabled={isPending}>
                {isPending ? "Closing…" : "Close this loop"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
