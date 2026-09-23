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
import { createInstitute, updateInstitute } from "@/lib/institute-actions";
import {
  EMPTY_FORM_STATE,
  type InstituteFormState,
} from "@/lib/institute-form-state";
import type { Institute } from "@/lib/institutes";
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
  initial,
}: {
  tree: StateNode[];
  /**
   * Non-empty only for an admin. Its length is what decides whether a campus
   * is asked for and required, so the role is expressed once — by the page
   * that knows it — rather than being passed around as a second flag that
   * could disagree with this list.
   *
   * ALWAYS EMPTY WHEN EDITING, and that is a rule rather than a convenience —
   * see `initial` below.
   */
  campuses?: Campus[];
  /**
   * The institute being edited. Absent when registering a new one.
   *
   * ONE FORM, TWO JOBS, and deliberately not two forms. Everything this asks —
   * the name, the type, the address, the location, the boards, the two
   * contacts, the streams and their head counts — is the same question in both
   * modes, and a second copy would be free to drift field by field until the
   * editor quietly stopped asking for something the registry expects.
   *
   * WHAT THE EDITOR DOES NOT TOUCH, and each for its own reason:
   *
   *   STATUS  is a rep's decision, made per visit and recorded with the
   *           evidence for it (Rule 4). An admin overwriting it here would
   *           append a row to the institute's status history with no visit
   *           behind it, and Pending and the badge would both start reading
   *           from a change nobody can account for.
   *   CAMPUS  moves with the REP, not with the institute. Correcting a campus
   *           allocation is `correct_member_campus()` (0035) and it moves a
   *           whole pipeline in one transaction; letting a rename drag one
   *           institute across the boundary would make the two disagree.
   *           `campuses` is therefore always empty in edit mode, which is what
   *           takes the field off the form.
   *   OWNER   is `reassignInstitute()` — a permissions change guarded by FO010
   *           and FO025, with its own card on the institute's page.
   */
  initial?: Institute;
}) {
  const editing = initial !== undefined;
  const asksForCampus = campuses.length > 0;
  const [state, formAction, isPending] = useActionState(
    editing ? updateInstitute : createInstitute,
    EMPTY_FORM_STATE,
  );
  const [clientState, setClientState] = useState<InstituteFormState>(EMPTY_FORM_STATE);

  const [boards, setBoards] = useState<string[]>(initial?.boards ?? []);
  const [customBoard, setCustomBoard] = useState("");
  const [class11, setClass11] = useState<Stream[]>(
    (initial?.class11 ?? []).filter((s): s is Stream =>
      (STREAMS as readonly string[]).includes(s),
    ),
  );
  /*
   * Class 12 arrives as an object of stream -> count, and the form holds the
   * TICKS and the COUNTS separately: the ticks decide which number inputs
   * render, and each input carries its own count as a defaultValue. Keys that
   * are not one of the three streams are dropped rather than rendered, since
   * nothing could edit them.
   */
  const [class12, setClass12] = useState<Stream[]>(
    Object.keys(initial?.class12 ?? {}).filter((s): s is Stream =>
      (STREAMS as readonly string[]).includes(s),
    ),
  );
  const [type, setType] = useState<string>(initial?.type ?? "school");
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
      {/* Which institute is being edited. Absent when registering, and the
          action refuses a submission with no id rather than inventing one. */}
      {initial && <input type="hidden" name="institute_id" value={initial.id} />}

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
              defaultValue={initial?.name ?? ""}
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
              defaultValue={initial?.address ?? ""}
              placeholder="Street address"
            />
            {fieldError("address")}
          </div>
      </FormSection>

      <FormSection
        title="Location"
        description="A PIN code fills the rest in; the pickers are there when it cannot."
      >
          <LocationPicker
            tree={tree}
            fieldErrors={fieldErrors}
            initial={
              initial && {
                state: initial.state,
                city: initial.city,
                area: initial.area,
                pincode: initial.pincode,
              }
            }
          />
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
                defaultValue={initial?.principal_name ?? ""}
                placeholder="Name"
              />
              <MobileInput
                name="principal_mobile"
                placeholder="10-digit mobile"
                initial={initial?.principal_mobile ?? ""}
              />
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
                defaultValue={initial?.decision_maker_name ?? ""}
                placeholder="Name"
              />
              <Input
                name="decision_maker_designation"
                className="h-11"
                maxLength={120}
                defaultValue={initial?.decision_maker_designation ?? ""}
                placeholder="Designation"
              />
              <MobileInput
                name="decision_maker_mobile"
                placeholder="10-digit mobile"
                initial={initial?.decision_maker_mobile ?? ""}
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
                          defaultValue={
                            initial?.class12?.[stream]
                              ? String(initial.class12[stream])
                              : ""
                          }
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
        {editing
          ? isPending
            ? "Saving…"
            : "Save changes"
          : isPending
            ? "Registering…"
            : "Register institute"}
      </Button>
    </form>
  );
}

function MobileInput({
  name,
  placeholder,
  initial = "",
}: {
  name: string;
  placeholder: string;
  /** The number already recorded, when editing. Empty when registering. */
  initial?: string;
}) {
  // Controlled, so the digits-only filter applies to what is already there as
  // well as to what is typed — a legacy value that somehow held punctuation
  // would otherwise sit in the box and be refused on submit with no way to see
  // why.
  const [value, setValue] = useState(digits(initial, 10));
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
