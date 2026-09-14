"use client";

import { useActionState, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocationPicker } from "@/components/institutes/location-picker";
import { createInstitute } from "@/lib/institute-actions";
import {
  EMPTY_FORM_STATE,
  type InstituteFormState,
} from "@/lib/institute-form-state";
import type { StateNode } from "@/lib/locations";
import {
  BOARD_OPTIONS,
  CAMPUS_REQUIRED,
  INSTITUTE_TYPES,
  STREAMS,
  TYPE_LABELS,
  fieldErrorsFrom,
  instituteFormDataToInput,
  instituteSchema,
  type Stream,
} from "@/lib/validation/institute";
import { campusLabel, type Campus } from "@/lib/campus-display";
import { cn } from "@/lib/utils";
import { CHECK_FIELDS, FormNotice } from "@/components/form-notice";

/** Digits only, capped — mirrors the *_mobile_valid CHECK in the database. */
function digits(value: string, max: number) {
  return value.replace(/\D/g, "").slice(0, max);
}

export function InstituteForm({
  tree,
  campuses = [],
}: {
  tree: StateNode[];
  /**
   * Non-empty only for an admin. Its length is what decides whether a campus
   * is asked for and required, so the role is expressed once — by the page
   * that knows it — rather than being passed around as a second flag that
   * could disagree with this list.
   */
  campuses?: Campus[];
}) {
  const asksForCampus = campuses.length > 0;
  const [state, formAction, isPending] = useActionState(
    createInstitute,
    EMPTY_FORM_STATE,
  );
  const [clientState, setClientState] = useState<InstituteFormState>(EMPTY_FORM_STATE);

  const [boards, setBoards] = useState<string[]>([]);
  const [customBoard, setCustomBoard] = useState("");
  const [class11, setClass11] = useState<Stream[]>([]);
  const [class12, setClass12] = useState<Stream[]>([]);
  const [type, setType] = useState<string>("school");
  const [campusId, setCampusId] = useState("");

  // Server errors win once a submission has come back.
  const error = state.error ?? clientState.error;
  const fieldErrors = state.error ? state.fieldErrors : clientState.fieldErrors;

  function toggle<T extends string>(
    list: T[],
    value: T,
    set: (next: T[]) => void,
  ) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function addCustomBoard() {
    const board = customBoard.trim();
    if (!board || boards.includes(board)) return;
    setBoards([...boards, board]);
    setCustomBoard("");
  }

  /** Same schema the action uses, so a typo is caught without a round trip. */
  /**
   * Submitted by hand so React never resets the form.
   *
   * THE HARM HERE IS THE `type` SELECT. It mounts as "school", and a Radix
   * Select restores its MOUNT value whenever a `reset` event reaches the form -
   * which React fires after any action completes, including a failed one. See
   * log-visit-form.tsx for the full chain and the Radix source.
   *
   * So: register a COACHING centre, pass the client checks, have the server
   * refuse it (a duplicate name is the likely one - 23505 comes back as "That
   * already exists"), rename it, submit again, and it is created as a SCHOOL.
   * The rep is never told, because "school" is a perfectly valid answer. That
   * is the same silent-wrong-data shape as the visit form's activity.
   *
   * Only `type` is at risk. `boards`, `class11` and `class12` look like the
   * same kind of choice but are plain toggle buttons writing hidden inputs, and
   * nothing resets those.
   *
   * The FormData is taken before the state updates below, so what is sent is
   * what the registrar typed rather than what the form holds a tick later.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const parsed = instituteSchema.safeParse(instituteFormDataToInput(formData));

    // Folded into the same pass as the schema so one notice lists everything
    // still outstanding, rather than an admin fixing the fields, submitting,
    // and only then being told about the campus.
    const campusMissing = asksForCampus && !campusId;

    if (!parsed.success || campusMissing) {
      const fieldErrors = parsed.success ? {} : fieldErrorsFrom(parsed.error);
      if (campusMissing) fieldErrors.campus_id = CAMPUS_REQUIRED;
      setClientState({ error: CHECK_FIELDS, fieldErrors });
      return;
    }
    setClientState(EMPTY_FORM_STATE);
    formAction(formData);
  }

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-danger text-xs">{fieldErrors[key]}</p>
    ) : null;

  // The form is noValidate so that handleSubmit above is what rejects a bad
  // field. Left to itself the browser stops the submit on `required` and shows
  // its own "Please fill out this field" bubble, which means the shared schema
  // never runs and Name is the one field that errors differently from all the
  // others. `required` stays on the input — it still tells assistive technology
  // the field is mandatory, and only the browser's error UI is being dropped.
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormSection
        title="The basics"
        description="What it is called and what kind of place it is."
      >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              className="h-11"
              maxLength={200}
              required
              aria-invalid={fieldErrors.name ? true : undefined}
              placeholder="e.g. Delhi Public School"
            />
            {fieldError("name")}
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <input type="hidden" name="type" value={type} />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSTITUTE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError("type")}
          </div>

          {/* Admin only. Unlike `type` above, this Select mounts EMPTY, so a
              React reset restores a placeholder the registrar can see rather
              than a plausible-looking wrong answer — the hazard that comment
              describes does not apply here, and the hidden input keeps the
              value where FormData can reach it either way. */}
          {asksForCampus && (
            <div className="space-y-2">
              <Label>Campus</Label>
              <input type="hidden" name="campus_id" value={campusId} />
              <Select value={campusId} onValueChange={setCampusId}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Campus"
                  aria-invalid={fieldErrors.campus_id ? true : undefined}
                >
                  <SelectValue placeholder="Which campus is this prospect for?" />
                </SelectTrigger>
                <SelectContent>
                  {campuses.map((campus) => (
                    <SelectItem key={campus.id} value={campus.id}>
                      {campusLabel(campus)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Only reps from this campus will see it. A rep registering an
                institute gets their own campus automatically.
              </p>
              {fieldError("campus_id")}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              name="address"
              className="h-11"
              maxLength={500}
              placeholder="Street address"
            />
            {fieldError("address")}
          </div>
      </FormSection>

      <FormSection
        title="Location"
        description="A PIN code fills the rest in; the pickers are there when it cannot."
      >
          <LocationPicker tree={tree} fieldErrors={fieldErrors} />
      </FormSection>

      <FormSection
        title="Boards"
        description="Which curricula they teach. Add one if it is missing."
      >
          {boards.map((b) => (
            <input key={b} type="hidden" name="boards" value={b} />
          ))}

          <div className="flex flex-wrap gap-2">
            {BOARD_OPTIONS.map((board) => {
              const on = boards.includes(board);
              return (
                <button
                  key={board}
                  type="button"
                  onClick={() => toggle(boards, board, setBoards)}
                  aria-pressed={on}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  {board}
                </button>
              );
            })}
          </div>

          {/* Rule 9: anything not on the list goes in as free text. */}
          <div className="flex gap-2">
            <Input
              className="h-11"
              placeholder="Other board (e.g. NIOS)"
              value={customBoard}
              maxLength={60}
              onChange={(e) => setCustomBoard(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomBoard();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0"
              onClick={addCustomBoard}
            >
              Add
            </Button>
          </div>

          {boards.filter((b) => !BOARD_OPTIONS.includes(b as never)).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {boards
                .filter((b) => !BOARD_OPTIONS.includes(b as never))
                .map((b) => (
                  <span
                    key={b}
                    className="bg-secondary text-secondary-foreground flex items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-sm"
                  >
                    {b}
                    <button
                      type="button"
                      onClick={() => toggle(boards, b, setBoards)}
                      aria-label={`Remove ${b}`}
                      className="hover:bg-background rounded-full p-1"
                    >
                      <XIcon className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
            </div>
          )}
          {fieldError("boards")}
      </FormSection>

      <FormSection
        title="Contacts"
        description="Who to ask for, and who can actually decide."
      >
          <div className="space-y-2">
            <Label htmlFor="principal_name">Principal / owner</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                id="principal_name"
                name="principal_name"
                className="h-11"
                maxLength={120}
                placeholder="Name"
              />
              <MobileInput name="principal_mobile" placeholder="10-digit mobile" />
            </div>
            {fieldError("principal_name")}
            {fieldError("principal_mobile")}
          </div>

          <div className="space-y-2">
            <Label htmlFor="decision_maker_name">Decision maker</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                id="decision_maker_name"
                name="decision_maker_name"
                className="h-11"
                maxLength={120}
                placeholder="Name"
              />
              <Input
                name="decision_maker_designation"
                className="h-11"
                maxLength={120}
                placeholder="Designation"
              />
              <MobileInput
                name="decision_maker_mobile"
                placeholder="10-digit mobile"
              />
            </div>
            {fieldError("decision_maker_name")}
            {fieldError("decision_maker_designation")}
            {fieldError("decision_maker_mobile")}
          </div>
      </FormSection>

      <FormSection
        title="Streams"
        description="Roughly how many students, so a session can be sized."
      >
          {/* Rule 10: class 11 is ticks only. */}
          <fieldset>
            <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              Class 11: which streams run
            </legend>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {STREAMS.map((stream) => (
                <label
                  key={stream}
                  className="flex min-h-11 cursor-pointer items-center gap-2 text-sm capitalize"
                >
                  <Checkbox
                    checked={class11.includes(stream)}
                    onCheckedChange={() => toggle(class11, stream, setClass11)}
                  />
                  {class11.includes(stream) && (
                    <input type="hidden" name="class11" value={stream} />
                  )}
                  {stream}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Rule 10: class 12 is ticks plus an approximate count. */}
          <fieldset>
            <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              Class 12: streams and approximate students
            </legend>
            <div className="space-y-3">
              {STREAMS.map((stream) => {
                const on = class12.includes(stream);
                return (
                  <div key={stream} className="flex items-center gap-3">
                    <label className="flex min-h-11 w-36 cursor-pointer items-center gap-2 text-sm capitalize">
                      <Checkbox
                        checked={on}
                        onCheckedChange={() => toggle(class12, stream, setClass12)}
                      />
                      {stream}
                    </label>
                    {on && (
                      <>
                        <input type="hidden" name="class12" value={stream} />
                        <Input
                          name={`class12_${stream}`}
                          className="h-11"
                          inputMode="numeric"
                          placeholder="Approx. students"
                          aria-label={`Approximate class 12 ${stream} students`}
                          onChange={(e) => {
                            e.target.value = digits(e.target.value, 6);
                          }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {fieldError("class12")}
          </fieldset>
      </FormSection>

      {/*
        Every field error is listed, not only the ones with an inline slot. A
        validation failure on a field the form does not render an error for is
        otherwise completely invisible: the submit button just stops working,
        which is exactly the bug this replaced.
      */}
      {error && <FormNotice message={error} fieldErrors={fieldErrors} />}

      <Button type="submit" className="h-11 w-full" disabled={isPending}>
        {isPending ? "Registering…" : "Register institute"}
      </Button>
    </form>
  );
}

function MobileInput({
  name,
  placeholder,
}: {
  name: string;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  return (
    <Input
      name={name}
      value={value}
      onChange={(e) => setValue(digits(e.target.value, 10))}
      className="h-11"
      type="tel"
      inputMode="numeric"
      maxLength={10}
      placeholder={placeholder}
    />
  );
}
