import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

/**
 * Turning a stored photo path into something a browser can display.
 *
 * `visit-photos` is a private bucket — the pictures are taken inside schools and
 * may show identifiable students, so there is no public URL to hand out. Each
 * one is signed server-side, for a few minutes, on the caller's own session:
 * the storage policy lets a member read their own photos and an admin read
 * anyone's, so signing simply fails for a photo that is not yours. No
 * service-role key is involved, and none reaches the browser.
 *
 * A path may also point at a file that is no longer there. The nightly purge
 * clears photos past the retention window and an admin can flush them sooner,
 * while the visit row keeps its photo_url forever — the row is the record, the
 * picture was only the evidence. That is not an error to report; it is a photo
 * that has expired, and it is the normal end state of every photo in this app.
 */

/** Long enough to open the picture, short enough that a leaked link is stale. */
export const PHOTO_URL_TTL_SECONDS = 300;

export type VisitPhoto =
  | { status: "ready"; url: string }
  | { status: "expired" };

export async function signVisitPhotos(
  paths: (string | null)[],
): Promise<Map<string, VisitPhoto>> {
  const signed = new Map<string, VisitPhoto>();
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return signed;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("visit-photos")
    .createSignedUrls(unique, PHOTO_URL_TTL_SECONDS);

  if (error) {
    // One failure for the whole batch tells us nothing about individual files,
    // so every one reads as expired rather than rendering a broken image.
    logError("photos:sign", error);
    for (const path of unique) signed.set(path, { status: "expired" });
    return signed;
  }

  for (const entry of data ?? []) {
    if (!entry.path) continue;
    signed.set(
      entry.path,
      entry.error || !entry.signedUrl
        ? { status: "expired" }
        : { status: "ready", url: entry.signedUrl },
    );
  }

  // Anything storage did not answer for at all.
  for (const path of unique) {
    if (!signed.has(path)) signed.set(path, { status: "expired" });
  }

  return signed;
}
