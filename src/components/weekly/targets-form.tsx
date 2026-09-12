"use client";

import { useActionState, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/dates";
import { LockIcon, TriangleAlertIcon, UnlockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { saveTargets, submitTargets } from "@/lib/target-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import {
  METRICS,
  STATUS_BADGE,
  STATUS_LABELS,
  TONE_BAR,
  type MetricCounts,
  type MetricKey,
  percentOf,
  progressStatus,
  remaining,
  targetsFormDataToInput,
  targetsSchema,
  toneFor,
  weeklyFieldErrors,
} from "@/lib/validation/weekly";

/**
 * The rep's commitment for one week.
 *
 * The eight numbers are the promise; the bars underneath are what has actually
 * happened, and they update as the rep types, so the size of a commitment is
 * felt against real progress rather than typed into a vacuum.
 *
 * Submitting is final for the rep — only an admin can reopen — so it asks once
 * before locking.
 */
export function TargetsForm({
  weekStart,
  targets,
  achieved,
  locked,
  submittedAt,
  reopenedAt,
}: {
  weekStart: string;
  targets: MetricCounts;
  achieved: MetricCounts;
  locked: boolean;
  submittedAt: string | null;
  reopenedAt: string | null;
}) {
  const [serverState, formAction, isPending] = useActionState(
    async (prev: FormState, formData: FormData) =>
      formData.get("intent") === "submit"
        ? submitTargets(prev, formData)
        : saveTargets(prev, formData),
    EMPTY_STATE,
  );
  const [clientState, setClientState] = useState<FormState>(EMPTY_STATE);
  const [values, setValues] = useState<Record<MetricKey, string>>(() =>
    Object.fromEntries(
      METRICS.map((m) => [m.key, String(targets[m.key])]),
    ) as Record<MetricKey, string>,
  );
  const [confirming, setConfirming] = useState(false);

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = targetsSchema.safeParse(
      targetsFormDataToInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: "Please check the highlighted numbers.",
        fieldErrors: weeklyFieldErrors(parsed.error),
      });
      setConfirming(false);
      return;
    }
    setClientState(EMPTY_STATE);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="week_start" value={weekStart} />

      {locked && (
        <p
          role="status"
          className="bg-warning-subtle text-warning-subtle-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm"
        >
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Submitted{submittedAt ? ` ${formatDateTime(submittedAt)}` : ""}.
            This commitment is locked and cannot be edited. Ask an admin if it
            needs to change.
          </span>
        </p>
      )}

      {!locked && reopenedAt && (
        <p
          role="status"
          className="bg-neutral-subtle text-neutral-subtle-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm"
        >
          <UnlockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            An admin reopened this week on {formatDate(reopenedAt)}. Revise the
            numbers and submit again.
          </span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {locked ? "Your commitment" : "Commit to this week"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {METRICS.map((metric) => {
            const target = Number(values[metric.key]) || 0;
            const done = achieved[metric.key];
            const tone = toneFor(done, target);
            const fieldError = fieldErrors[metric.key];

            return (
              <div key={metric.key} className="space-y-2">
                <Label htmlFor={metric.key}>{metric.label}</Label>
                <Input
                  id={metric.key}
                  name={metric.key}
                  inputMode="numeric"
                  className="h-11"
                  disabled={locked}
                  aria-invalid={fieldError ? true : undefined}
                  value={values[metric.key]}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [metric.key]: event.target.value.replace(/\D/g, "").slice(0, 3),
                    }))
                  }
                />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground text-xs">
                    Achieved: {done} · Remaining: {remaining(done, target)}
                  </span>
                  <span className="text-xs font-semibold tabular-nums">
                    {target > 0 ? `${percentOf(done, target)}%` : "—"}
                  </span>
                </div>
                <Progress
                  value={percentOf(done, target)}
                  indicatorClassName={TONE_BAR[tone]}
                  aria-label={`${metric.label}: ${done} of ${target}`}
                />
                <Badge variant={STATUS_BADGE[progressStatus(done, target)]}>
                  {STATUS_LABELS[progressStatus(done, target)]}
                </Badge>
                {fieldError && <p className="text-danger text-xs">{fieldError}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {error && (
        <p
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      {!locked && (
        <div className="space-y-3">
          {confirming ? (
            <div className="bg-warning-subtle text-warning-subtle-foreground space-y-3 rounded-md px-3 py-3">
              <p className="flex items-start gap-2 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Once submitted, this week locks. You will need an admin to
                  reopen it before you can change anything.
                </span>
              </p>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  name="intent"
                  value="submit"
                  className="h-11 flex-1"
                  disabled={isPending}
                >
                  {isPending ? "Submitting…" : "Yes, lock this week"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setConfirming(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              className="h-11 w-full"
              onClick={() => setConfirming(true)}
              disabled={isPending}
            >
              <LockIcon className="size-4" aria-hidden />
              Submit commitment (final)
            </Button>
          )}

          <Button
            type="submit"
            name="intent"
            value="save"
            variant="outline"
            className="h-11 w-full"
            disabled={isPending}
          >
            {isPending ? "Saving…" : "Save without submitting"}
          </Button>
        </div>
      )}
    </form>
  );
}
