"use client";

import { FormSection } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeedbackFields } from "@/components/visits/feedback-fields";
import {
  NextActionFields,
  type NextActionValue,
} from "@/components/visits/next-action-fields";
import { DynamicStatusFields } from "@/components/visits/dynamic-status-fields";
import type { StatusField } from "@/lib/status-fields";
import { RequiredMark } from "@/components/required-mark";
import {
  applyFeedbackPatch,
  type FeedbackState,
} from "@/lib/validation/feedback";
import {
  CATEGORY_LABELS,
  STATUS_CATEGORIES,
  statusRow,
  statusesInCategory,
  type StatusCatalogue,
} from "@/lib/validation/institute";
import {
  eventDateLabel,
  eventDateRequired,
  followUpRequired,
  notesRequired,
  nextActionShown,
  postedEventDate,
} from "@/lib/validation/visit";
import type { OpenLoop } from "@/lib/visits";

/**
 * The status-driven half of Log Visit, shared with Log Call.
 *
 * SAME FIELDS, SAME RULES, TWO FORMS. Log Visit still owns the photo, the
 * check-in/out GPS and "This completes an earlier plan" (via `openLoops`);
 * Log Call renders this block alone. One component so an admin-added status
 * cannot light up on one screen and stay dark on the other.
 *
 * Next Action is optional here (`showNextAction`) because Log Visit still
 * hides it behind PHASE_A_DAILY_PLAN. Log Call always passes true — a call
 * log is that form, minus photo, and Next Action is part of it.
 *
 * `askDate` stays at NextActionFields' default (false): one Follow-up Date
 * box, never a second due date.
 */
export type StatusOutcomeValue = {
  statusSetTo: string;
  expectedDate: string;
  followUpDate: string;
  nextAction: NextActionValue;
  feedback: FeedbackState;
  customFields?: Record<string, string>;
};

const EMPTY_NEXT: NextActionValue = { kind: "", due: "", note: "" };

export type StatusOutcomePatcher = (
  patch:
    | Partial<StatusOutcomeValue>
    | ((current: StatusOutcomeValue) => Partial<StatusOutcomeValue>),
) => void;

export function StatusOutcomeFields({
  catalogue,
  statusFields = [],
  value,
  onChange,
  fieldErrors,
  openLoops,
  showNextAction,
}: {
  catalogue: StatusCatalogue;
  statusFields?: StatusField[];
  value: StatusOutcomeValue;
  onChange: StatusOutcomePatcher;
  fieldErrors: Record<string, string>;
  openLoops: OpenLoop[];
  showNextAction: boolean;
}) {
  const status = value.statusSetTo === "" ? null : value.statusSetTo;
  const needsDate = eventDateRequired(catalogue, status);
  const needsFollowUp =
    followUpRequired(catalogue, status) || value.nextAction.kind !== "";
  const needsNotes = notesRequired(catalogue, status);
  const chosenStatus = statusRow(catalogue, status);

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-danger text-xs">{fieldErrors[key]}</p>
    ) : null;

  return (
    <FormSection>
      <input type="hidden" name="status_set_to" value={value.statusSetTo} />
      <input
        type="hidden"
        name="expected_date"
        value={postedEventDate(catalogue, status, value.expectedDate)}
      />

      <div className="space-y-2">
        <Label>
          Status <RequiredMark />
        </Label>
        <Select
          value={value.statusSetTo}
          onValueChange={(next) => onChange({ statusSetTo: next })}
        >
          <SelectTrigger
            className="h-11 w-full"
            aria-label="Institute status"
            aria-invalid={fieldErrors.status_set_to ? true : undefined}
          >
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_CATEGORIES.map((category) => (
              <SelectGroup key={category}>
                <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                {statusesInCategory(catalogue, category).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {fieldError("status_set_to")}
      </div>

      {status && (
        <>
          <DynamicStatusFields
            status={status}
            fields={statusFields}
            values={value.customFields ?? {}}
            onChange={(name, val) =>
              onChange((current) => ({
                customFields: {
                  ...(current.customFields ?? {}),
                  [name]: val,
                },
              }))
            }
            fieldErrors={fieldErrors}
          />
          {needsFollowUp && (
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="follow-up-date">
                Follow-up Date <RequiredMark />
              </Label>
              <Input
                id="follow-up-date"
                name="follow_up_date"
                type="date"
                className="h-11"
                value={value.followUpDate}
                onChange={(event) =>
                  onChange({ followUpDate: event.target.value })
                }
                aria-required
              />
              {fieldError("follow_up_date")}
            </div>
          )}

          {needsDate && (
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="expected-date">
                {eventDateLabel(catalogue, status)} <RequiredMark />
              </Label>
              <Input
                id="expected-date"
                type="date"
                className="h-11"
                value={value.expectedDate}
                onChange={(event) =>
                  onChange({ expectedDate: event.target.value })
                }
                aria-required
              />
              {fieldError("expected_date")}
            </div>
          )}

          {showNextAction && nextActionShown(catalogue, status) && (
            <NextActionFields
              value={value.nextAction}
              onChange={(patch) =>
                onChange((current) => ({
                  nextAction: {
                    ...(current.nextAction ?? EMPTY_NEXT),
                    ...patch,
                  },
                }))
              }
              fieldErrors={fieldErrors}
              defaultDue={value.followUpDate}
            />
          )}

          <FeedbackFields
            asks={{
              sessionDetail: chosenStatus?.asksSessionDetail ?? false,
              headCount: chosenStatus?.asksHeadCount ?? false,
            }}
            notesRequired={needsNotes}
            value={value.feedback}
            onChange={(patch) =>
              onChange((current) => ({
                feedback: applyFeedbackPatch(current.feedback, patch),
              }))
            }
            fieldErrors={fieldErrors}
            openLoops={openLoops}
          />
        </>
      )}
    </FormSection>
  );
}
