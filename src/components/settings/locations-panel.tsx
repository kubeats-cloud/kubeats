"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RemoveButton } from "@/components/settings/remove-button";
import { addArea, addCity, addState } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE, type AdminState } from "@/lib/admin-form-state";
import { nameLooksValid } from "@/lib/validation/admin";
import type { StateNode } from "@/lib/locations";

/**
 * The State → City → Area tree, one level at a time.
 *
 * Adding goes through the same find-or-create helpers as the PIN lookup, so an
 * admin typing "Bangalore" is told it is Bengaluru here and no second city
 * appears. Removing a state or a city cascades in the database, so the count of
 * what goes with it is spelled out before the confirmation.
 */
export function LocationsPanel({ tree }: { tree: StateNode[] }) {
  const [stateId, setStateId] = useState("");
  const [cityId, setCityId] = useState("");

  const state = tree.find((s) => s.id === stateId);
  // Derived rather than reset in an effect: a city id left over from another
  // state simply stops matching, which is the bug Phase 4 spent an evening on.
  const city = state?.cities.find((c) => c.id === cityId);

  const areaCount = (node: StateNode) =>
    node.cities.reduce((sum, c) => sum + c.areas.length, 0);

  const count = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Locations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* States ------------------------------------------------------- */}
        <section className="space-y-2">
          <Label htmlFor="state-picker">State</Label>
          <div className="flex gap-2">
            <Select
              value={stateId}
              onValueChange={(value) => {
                setStateId(value);
                setCityId("");
              }}
            >
              <SelectTrigger id="state-picker" className="h-11 w-full">
                <SelectValue placeholder="Choose a state" />
              </SelectTrigger>
              <SelectContent>
                {tree.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state && (
              <RemoveButton
                kind="state"
                id={state.id}
                name={state.name}
                warning={
                  state.cities.length > 0
                    ? `${count(state.cities.length, "city", "cities")} and ${count(areaCount(state), "area", "areas")} go with it.`
                    : undefined
                }
              />
            )}
          </div>
          <AddRow
            action={addState}
            label="Add a state"
            placeholder="e.g. Ladakh"
            inputName="name"
          />
        </section>

        {/* Cities ------------------------------------------------------- */}
        {state && (
          <section className="border-border space-y-2 border-t pt-5">
            <Label htmlFor="city-picker">City in {state.name}</Label>
            <div className="flex gap-2">
              <Select value={cityId} onValueChange={setCityId}>
                <SelectTrigger id="city-picker" className="h-11 w-full">
                  <SelectValue
                    placeholder={
                      state.cities.length === 0
                        ? "No cities yet"
                        : "Choose a city"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {state.cities.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                      {node.areas.length > 0 ? ` · ${node.areas.length}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {city && (
                <RemoveButton
                  kind="city"
                  id={city.id}
                  name={city.name}
                  warning={
                    city.areas.length > 0
                      ? `${count(city.areas.length, "area", "areas")} go with it.`
                      : undefined
                  }
                />
              )}
            </div>
            <AddRow
              action={addCity}
              label={`Add a city to ${state.name}`}
              placeholder="e.g. Hubballi"
              inputName="name"
              hidden={{ state_id: state.id }}
            />
          </section>
        )}

        {/* Areas -------------------------------------------------------- */}
        {state && city && (
          <section className="border-border space-y-2 border-t pt-5">
            <Label>Areas in {city.name}</Label>
            {city.areas.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No areas yet. Reps can also add one while registering an
                institute.
              </p>
            ) : (
              <ul className="space-y-2">
                {city.areas.map((area) => (
                  <li
                    key={area.id}
                    className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {area.name}
                    </span>
                    <RemoveButton kind="area" id={area.id} name={area.name} />
                  </li>
                ))}
              </ul>
            )}
            <AddRow
              action={addArea}
              label={`Add an area to ${city.name}`}
              placeholder="e.g. Indiranagar"
              inputName="name"
              hidden={{ city_id: city.id }}
            />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

/** The longest a location name may be, matching the schemas. */
const MAX_NAME = 120;

/** One labelled text input and an Add button, wired to a server action. */
function AddRow({
  action,
  label,
  placeholder,
  inputName,
  hidden,
}: {
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  label: string;
  placeholder: string;
  inputName: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    EMPTY_ADMIN_STATE,
  );
  const [value, setValue] = useState("");
  const id = `${inputName}-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const [clientError, setClientError] = useState<string | null>(null);
  const error = state.error ?? clientError;

  // The same rule the schema applies on the server, checked here first so a
  // blank or punctuation-only name never becomes a round trip.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!nameLooksValid(value, MAX_NAME)) {
      event.preventDefault();
      setClientError("Enter a name using letters or numbers, up to 120 characters.");
      return;
    }
    setClientError(null);
    setValue("");
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-2 pt-1">
      {Object.entries(hidden ?? {}).map(([key, val]) => (
        <input key={key} type="hidden" name={key} value={val} />
      ))}
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          name={inputName}
          className="h-11"
          maxLength={120}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={state.fieldErrors[inputName] || clientError ? true : undefined}
        />
        <Button type="submit" variant="outline" className="h-11" disabled={isPending}>
          <PlusIcon className="size-4" aria-hidden />
          Add
        </Button>
      </div>
      {state.fieldErrors[inputName] && (
        <p className="text-danger text-xs">{state.fieldErrors[inputName]}</p>
      )}
      {error && (
        <p
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      {state.ok && state.message && (
        <p
          role="status"
          className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
