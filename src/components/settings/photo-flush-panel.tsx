"use client";

import { useActionState, useState } from "react";
import { formatDate } from "@/lib/dates";
import { ImageOffIcon, TriangleAlertIcon } from "lucide-react";
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
import { flushPhotos } from "@/lib/admin-actions";
import { EMPTY_FLUSH_STATE } from "@/lib/admin-form-state";
import { FLUSH_PRESETS } from "@/lib/validation/admin";

/**
 * Clearing photos early.
 *
 * The nightly job already removes anything past thirty days; this is for
 * clearing sooner, which is what the client actually wants — the pictures stop
 * being useful after about a week. It deletes the image FILES only: every visit
 * keeps its coordinates, its timestamp and its photo_url, so the record of the
 * visit is untouched and the photo simply reads as expired.
 *
 * Nothing is deleted until the count has been shown and confirmed.
 */
export function PhotoFlushPanel({
  storedPhotos,
  retentionDays,
  today,
}: {
  storedPhotos: number | null;
  retentionDays: number;
  /** Today in Asia/Kolkata, resolved on the server. See cutoffFor below. */
  today: string;
}) {
  const [state, formAction, isPending] = useActionState(
    flushPhotos,
    EMPTY_FLUSH_STATE,
  );
  const [preset, setPreset] = useState<string>(FLUSH_PRESETS[0].key);
  const [customDate, setCustomDate] = useState("");

  const cutoff = cutoffFor(preset, customDate, today);
  // A confirmation is only good for the cutoff it was counted against.
  const confirmed =
    state.count !== undefined && state.cutoff === cutoff && state.count > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visit photos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          {storedPhotos === null
            ? "Photos are attached to visits as proof of attendance."
            : `${storedPhotos} ${storedPhotos === 1 ? "visit carries" : "visits carry"} a photo right now.`}{" "}
          Photos are deleted automatically after {retentionDays} days. Use this to
          clear them sooner. The visits themselves, with their location and
          time, are never touched.
        </p>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="cutoff" value={cutoff} />

          <div className="space-y-2">
            <Label>Delete photos from visits</Label>
            <Select
              value={preset}
              onValueChange={(value) => setPreset(value)}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLUSH_PRESETS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {preset === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="flush-date">On or before</Label>
              <Input
                id="flush-date"
                type="date"
                className="h-11"
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
              />
            </div>
          )}

          {cutoff && (
            <p className="text-muted-foreground text-xs">
              Cutoff: visits dated {formatDate(cutoff)}{" "}
              or earlier.
            </p>
          )}

          {state.error && (
            <p
              role="alert"
              className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
            >
              {state.error}
            </p>
          )}

          {state.deleted !== undefined && !state.error && (
            <p
              role="status"
              className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
            >
              {state.deleted === 0
                ? "There was nothing to delete."
                : `Deleted ${state.deleted} photo${state.deleted === 1 ? "" : "s"}. The visits are all still there.`}
            </p>
          )}

          {state.count !== undefined && state.deleted === undefined && (
            <div
              className={
                state.count > 0
                  ? "bg-warning-subtle text-warning-subtle-foreground space-y-3 rounded-md px-3 py-3 text-sm"
                  : "bg-neutral-subtle text-neutral-subtle-foreground rounded-md px-3 py-2 text-sm"
              }
            >
              {state.count > 0 ? (
                <>
                  <p className="flex items-start gap-2">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {state.count} photo{state.count === 1 ? "" : "s"} will be
                      deleted for good. The visits, their locations and their
                      times all stay.
                    </span>
                  </p>
                  {!confirmed && (
                    <p className="text-xs">
                      The cutoff changed. Check again before deleting.
                    </p>
                  )}
                </>
              ) : (
                <p>No photos match that cutoff.</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              name="intent"
              value="count"
              variant="outline"
              className="h-11 flex-1"
              disabled={isPending || !cutoff}
            >
              {isPending ? "Checking…" : "Check how many"}
            </Button>
            {confirmed && (
              <Button
                type="submit"
                name="intent"
                value="delete"
                variant="destructive"
                className="h-11 flex-1"
                disabled={isPending}
              >
                <ImageOffIcon className="size-4" aria-hidden />
                Delete {state.count}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Presets are relative to today; "custom" is whatever the admin picked.
 *
 * `today` is handed down from the server instead of being read from the
 * browser's clock, because this value is rendered — into the hidden field and
 * into the confirmation line. A server that thinks it is the 4th and a browser
 * that thinks it is the 5th would disagree about the text and hydration would
 * fail. See dates.ts for the whole story.
 */
function cutoffFor(preset: string, customDate: string, today: string): string {
  if (preset === "custom") return customDate;
  const days = Number(preset);
  if (!Number.isFinite(days)) return "";
  const day = new Date(`${today}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return "";
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}
