"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2Icon, MapPinIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addArea } from "@/lib/institute-actions";
import type { AreaNode, CityNode, StateNode } from "@/lib/locations";

/**
 * Rules 11 and 13, together.
 *
 * A 6-digit PIN fills State and City and offers the post office's localities as
 * areas. Every failure — bad PIN, timeout, offline, no records — leaves the
 * manual State -> City -> Area picker exactly as it was, with a plain message
 * above it. The lookup can never block registration.
 *
 * Values are submitted as hidden inputs because the institutes table stores
 * location as text, and because it keeps submission independent of how the
 * dropdowns happen to be implemented.
 */

const PIN_PATTERN = /^[0-9]{6}$/;

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "filled"; message: string }
  | { status: "failed"; message: string };

interface PincodeSuccess {
  ok: true;
  state: { id: string; name: string };
  city: { id: string; name: string };
  areas: AreaNode[];
}
interface PincodeFailure {
  ok: false;
  message: string;
}

/** What an institute already holds, when this picker is editing one. */
export interface InitialLocation {
  state: string | null;
  city: string | null;
  area: string | null;
  pincode: string | null;
}

export function LocationPicker({
  tree,
  fieldErrors,
  initial,
}: {
  tree: StateNode[];
  fieldErrors: Record<string, string>;
  /**
   * Absent when registering, present when editing.
   *
   * RESOLVED BY NAME, because that is what the institute stores. `institutes`
   * keeps location as TEXT — `state`, `city`, `area` — while this picker is
   * keyed on the location tree's ids, so preselecting means walking the tree to
   * find the rows those names came from. Done once at mount, in the useState
   * initialisers below, so the lookup cannot re-run and fight the PIN auto-fill.
   *
   * A name that is no longer in the tree resolves to nothing and the field
   * comes up empty — visible, and refused by the schema until it is answered,
   * rather than silently submitting a location the pickers never showed.
   */
  initial?: InitialLocation;
}) {
  const initialState = initial?.state
    ? tree.find((s) => s.name === initial.state)
    : undefined;
  const initialCity = initial?.city
    ? initialState?.cities.find((c) => c.name === initial.city)
    : undefined;

  const [states, setStates] = useState<StateNode[]>(tree);
  const [stateId, setStateId] = useState(initialState?.id ?? "");
  const [cityId, setCityId] = useState(initialCity?.id ?? "");
  const [area, setArea] = useState(initial?.area ?? "");

  const [pincode, setPincode] = useState(initial?.pincode ?? "");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });

  const [addingArea, setAddingArea] = useState(false);
  const [newArea, setNewArea] = useState("");
  const [areaError, setAreaError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedState = useMemo(
    () => states.find((s) => s.id === stateId),
    [states, stateId],
  );
  const cities: CityNode[] = selectedState?.cities ?? [];
  const selectedCity = cities.find((c) => c.id === cityId);
  const areas = selectedCity?.areas ?? [];

  /*
   * Selection is derived, not reset.
   *
   * The obvious version cleared the city from the state select's
   * onValueChange — "you picked a new state, so the old city is meaningless".
   * That is wrong here: Radix re-emits onValueChange when a controlled value
   * changes programmatically, so a PIN auto-fill arrived looking like a user
   * action and wiped the city the lookup had just filled in. Guarding on the
   * previous value does not help either, since the callback closes over the
   * render before the update.
   *
   * So nothing is cleared. A city that does not belong to the selected state
   * simply stops counting as selected, and the same for an area.
   */
  const effectiveCityId = selectedCity ? cityId : "";
  const effectiveArea = areas.some((a) => a.name === area) ? area : "";

  /** Fold a PIN result into the tree we already hold, without a page reload. */
  function mergeLookup(result: PincodeSuccess) {
    setStates((current) => {
      const next = current.map((s) => ({ ...s, cities: [...s.cities] }));

      let stateNode = next.find((s) => s.id === result.state.id);
      if (!stateNode) {
        stateNode = { id: result.state.id, name: result.state.name, cities: [] };
        next.push(stateNode);
        next.sort((a, b) => a.name.localeCompare(b.name));
      }

      const cityIndex = stateNode.cities.findIndex((c) => c.id === result.city.id);
      const cityNode: CityNode = {
        id: result.city.id,
        name: result.city.name,
        areas: result.areas,
      };
      if (cityIndex >= 0) stateNode.cities[cityIndex] = cityNode;
      else {
        stateNode.cities.push(cityNode);
        stateNode.cities.sort((a, b) => a.name.localeCompare(b.name));
      }

      return next;
    });

    setStateId(result.state.id);
    setCityId(result.city.id);
    setArea("");
    setAddingArea(false);
  }

  async function runLookup() {
    const code = pincode.trim();
    if (!PIN_PATTERN.test(code)) {
      setLookup({ status: "failed", message: "A PIN code is 6 digits." });
      return;
    }

    setLookup({ status: "loading" });
    try {
      const response = await fetch(`/api/pincode/${code}`);
      const body = (await response.json()) as PincodeSuccess | PincodeFailure;

      if (!body.ok) {
        setLookup({ status: "failed", message: body.message });
        return;
      }

      mergeLookup(body);
      setLookup({
        status: "filled",
        message: `Filled ${body.city.name}, ${body.state.name}. Pick your area below.`,
      });
    } catch {
      // Never surface the underlying network error — the fallback is the point.
      setLookup({
        status: "failed",
        message:
          "We could not reach the PIN code service. Please choose the location manually.",
      });
    }
  }

  function confirmNewArea() {
    const name = newArea.trim();
    if (!name || !effectiveCityId) return;

    setAreaError(null);
    startTransition(async () => {
      const result = await addArea(effectiveCityId, name);
      if (!result.ok) {
        setAreaError(result.message);
        return;
      }

      // Add it to the shared list so it is there for everyone next time.
      setStates((current) =>
        current.map((s) =>
          s.id !== stateId
            ? s
            : {
                ...s,
                cities: s.cities.map((c) =>
                  c.id !== cityId
                    ? c
                    : c.areas.some((a) => a.id === result.area.id)
                      ? c
                      : {
                          ...c,
                          areas: [...c.areas, result.area].sort((a, b) =>
                            a.name.localeCompare(b.name),
                          ),
                        },
                ),
              },
        ),
      );
      setArea(result.area.name);
      setNewArea("");
      setAddingArea(false);
    });
  }

  return (
    <section className="space-y-4">
      <input type="hidden" name="state" value={selectedState?.name ?? ""} />
      <input type="hidden" name="city" value={selectedCity?.name ?? ""} />
      <input type="hidden" name="area" value={effectiveArea} />
      <input type="hidden" name="pincode" value={pincode.trim()} />

      {/* PIN code — a shortcut, never a requirement. */}
      <div className="space-y-2">
        <Label htmlFor="pincode-input">PIN code (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="pincode-input"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="6 digits"
            maxLength={6}
            className="h-11"
            value={pincode}
            onChange={(e) => {
              setPincode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setLookup({ status: "idle" });
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={runLookup}
            disabled={lookup.status === "loading"}
          >
            {lookup.status === "loading" ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
            ) : (
              <MapPinIcon className="size-4" aria-hidden />
            )}
            Look up
          </Button>
        </div>

        {lookup.status === "filled" && (
          <p className="text-success-subtle-foreground bg-success-subtle rounded-md px-3 py-2 text-xs">
            {lookup.message}
          </p>
        )}
        {lookup.status === "failed" && (
          <p
            role="status"
            className="text-warning-subtle-foreground bg-warning-subtle rounded-md px-3 py-2 text-xs"
          >
            {lookup.message} You can still choose it below.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>State</Label>
          <Select
            value={stateId}
            onValueChange={(v) => {
              if (!v) return;
              setStateId(v);
              setAddingArea(false);
            }}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {states.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.state && (
            <p className="text-danger text-xs">{fieldErrors.state}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>City</Label>
          <Select
            value={effectiveCityId}
            disabled={!stateId}
            onValueChange={(v) => {
              if (!v) return;
              setCityId(v);
              setAddingArea(false);
            }}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder={stateId ? "Select" : "Pick state first"} />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.city && (
            <p className="text-danger text-xs">{fieldErrors.city}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Area</Label>
          {addingArea ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                className="h-11"
                placeholder="Area name"
                value={newArea}
                maxLength={120}
                onChange={(e) => setNewArea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmNewArea();
                  }
                }}
              />
              <Button
                type="button"
                className="h-11 shrink-0"
                onClick={confirmNewArea}
                disabled={pending || !newArea.trim()}
              >
                {pending ? "Adding…" : "Add"}
              </Button>
            </div>
          ) : (
            <Select
              value={effectiveArea}
              disabled={!effectiveCityId}
              onValueChange={(v) => {
                if (v === ADD_NEW) {
                  setAddingArea(true);
                  return;
                }
                setArea(v);
              }}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder={effectiveCityId ? "Select" : "Pick city first"} />
              </SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.name}>
                    {a.name}
                  </SelectItem>
                ))}
                <SelectItem value={ADD_NEW}>+ Add an area</SelectItem>
              </SelectContent>
            </Select>
          )}
          {areaError && <p className="text-danger text-xs">{areaError}</p>}
          {fieldErrors.area && !areaError && (
            <p className="text-danger text-xs">{fieldErrors.area}</p>
          )}
        </div>
      </div>

      {addingArea && (
        <p className="text-muted-foreground text-xs">
          This adds the area to {selectedCity?.name}&rsquo;s shared list, so the
          rest of the team gets it too.
        </p>
      )}
    </section>
  );
}

const ADD_NEW = "__add_new_area__";
