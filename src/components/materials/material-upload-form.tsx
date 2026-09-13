"use client";

import { useActionState, useRef, useState } from "react";
import { UploadIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { createMaterial } from "@/lib/material-actions";
import { campusLabel, type Campus } from "@/lib/campus-display";

/** Not "" — that is indistinguishable from a control nobody has touched. */
const ALL_CAMPUSES = "__all__";
import { createClient } from "@/lib/supabase/client";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import {
  FILE_INPUT_ACCEPT,
  MATERIAL_CATEGORIES,
  MAX_FILE_BYTES,
  fileRejectionReason,
  formatFileSize,
} from "@/lib/validation/material";
import { FormNotice } from "@/components/form-notice";

/**
 * Uploading a material.
 *
 * The file goes straight from the browser to storage, exactly as a visit photo
 * does — it never passes through a server action, so a 5 MB poster is not
 * squeezed through a request body. The action that follows records a row
 * describing the object that now exists.
 *
 * Unlike a visit photo, nothing is compressed on the way: a poster or a fee
 * sheet has to stay print-quality. The size cap is therefore the only defence,
 * and it is checked here, again in the action, again by the CHECK constraint,
 * and again by the bucket itself.
 */

type Upload =
  | { status: "idle" }
  | { status: "working" }
  | { status: "ready"; path: string; name: string; type: string; size: number }
  | { status: "failed"; message: string };

export function MaterialUploadForm({
  userId,
  campuses,
}: {
  userId: string;
  campuses: Campus[];
}) {
  const [serverState, formAction, isPending] = useActionState(
    createMaterial,
    EMPTY_STATE,
  );
  const [upload, setUpload] = useState<Upload>({ status: "idle" });
  const [category, setCategory] = useState<string>("");
  // "" would be indistinguishable from "not chosen yet", so the shared case has
  // its own sentinel and is submitted as an empty campus_id. Null in the column
  // means every campus — the library the app had before scoping.
  const [campusId, setCampusId] = useState<string>(ALL_CAMPUSES);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const fieldErrors: FormState["fieldErrors"] = serverState.fieldErrors ?? {};

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Told immediately, in the same words the server would use.
    const rejection = fileRejectionReason({ type: file.type, size: file.size });
    if (rejection) {
      setUpload({ status: "failed", message: rejection });
      event.target.value = "";
      return;
    }

    setUpload({ status: "working" });
    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
      : "bin";
    // Under the uploader's own id, which is what the storage policy requires.
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;

    const supabase = createClient();
    const { error } = await supabase.storage
      .from("materials")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) {
      setUpload({
        status: "failed",
        message:
          "We could not upload that file. Check your connection and try again.",
      });
      event.target.value = "";
      return;
    }

    setUpload({
      status: "ready",
      path,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  }

  /**
   * Clearing is a button, not an effect.
   *
   * Wiping the form the instant the action succeeds would mean resetting state
   * from inside a render or an effect, which React now rightly complains
   * about. It would also be wrong on failure: the file is already in storage by
   * then, so a rejected title must not take the upload down with it — the admin
   * fixes the title and submits again against the same object.
   */
  function startAnother() {
    setUpload({ status: "idle" });
    setCategory("");
    if (fileInput.current) fileInput.current.value = "";
    formRef.current?.reset();
  }

  const saved = Boolean(serverState.ok) && !serverState.error;
  const ready = upload.status === "ready";

  return (
    /*
      Submitted by hand so React never resets the form.

      THE HARM HERE IS `campusId`, and it is a scoping one. It mounts as
      ALL_CAMPUSES, and a Radix Select restores its MOUNT value whenever a
      `reset` event reaches the form - which React fires after any action
      completes, including a failed one. See log-visit-form.tsx for the chain.

      So an admin uploading a file FOR ONE CAMPUS, refused on the title, would
      fix the title and publish it to EVERY campus instead. The file is already
      in storage by then, so there is no second chance to notice.

      startAnother()'s own formRef.current.reset() is untouched and still
      wanted: that one is a button the admin presses to clear a SUCCESSFUL
      upload, and resetting campusId to ALL_CAMPUSES is the right starting point
      for the next file. The comment on that function had already worked out
      that clearing on FAILURE would be wrong - "the file is already in storage
      by then, so a rejected title must not take the upload down with it" - it
      just could not know React was doing exactly that behind it.
    */
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        formAction(new FormData(event.currentTarget));
      }}
      className="space-y-4"
    >
      {ready && (
        <>
          <input type="hidden" name="file_path" value={upload.path} />
          <input type="hidden" name="file_name" value={upload.name} />
          <input type="hidden" name="file_type" value={upload.type} />
          <input type="hidden" name="file_size" value={String(upload.size)} />
        </>
      )}
      <input type="hidden" name="category" value={category} />
      <input
        type="hidden"
        name="campus_id"
        value={campusId === ALL_CAMPUSES ? "" : campusId}
      />

      <div className="space-y-2">
        <Label htmlFor="material-title">Title</Label>
        <Input
          id="material-title"
          name="title"
          className="h-11"
          maxLength={200}
          required
          aria-invalid={fieldErrors.title ? true : undefined}
        />
        {fieldErrors.title && (
          <p className="text-danger-subtle-foreground text-xs">{fieldErrors.title}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-11 w-full" aria-label="Category">
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent>
            {MATERIAL_CATEGORIES.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors.category && (
          <p className="text-danger-subtle-foreground text-xs">
            {fieldErrors.category}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Campus</Label>
        <Select value={campusId} onValueChange={setCampusId}>
          <SelectTrigger className="h-11 w-full" aria-label="Campus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CAMPUSES}>
              All campuses (everyone sees it)
            </SelectItem>
            {campuses.map((campus) => (
              <SelectItem key={campus.id} value={campus.id}>
                {campusLabel(campus)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          A campus-specific file is visible only to that campus&rsquo;s reps.
        </p>
        {fieldErrors.campus_id && (
          <p className="text-danger-subtle-foreground text-xs">
            {fieldErrors.campus_id}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="material-description">Description (optional)</Label>
        <Textarea
          id="material-description"
          name="description"
          rows={3}
          maxLength={2000}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="material-file">File</Label>
        <Input
          id="material-file"
          ref={fileInput}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          className="h-11 py-2"
          onChange={handleFile}
          aria-describedby="material-file-hint"
        />
        <p id="material-file-hint" className="text-muted-foreground text-xs">
          JPG, PNG, WebP or PDF, up to {formatFileSize(MAX_FILE_BYTES)}. Files are
          stored as uploaded, so print quality is preserved.
        </p>

        {upload.status === "working" && (
          <p className="text-muted-foreground text-xs">Uploading…</p>
        )}
        {upload.status === "ready" && (
          <p className="text-success-subtle-foreground bg-success-subtle rounded-md px-3 py-2 text-xs">
            {upload.name} · {formatFileSize(upload.size)} uploaded. Add a title and
            save it to the library.
          </p>
        )}
        {upload.status === "failed" && (
          <FormNotice message={upload.message} />
        )}
      </div>

      <Button
        type="submit"
        className="h-11 w-full"
        disabled={!ready || isPending || !category || saved}
      >
        <UploadIcon className="size-4" aria-hidden />
        {isPending ? "Saving…" : "Add to the library"}
      </Button>

      {serverState.error && <FormNotice message={serverState.error} />}
      {saved && (
        <div className="bg-success-subtle text-success-subtle-foreground space-y-2 rounded-md px-3 py-2 text-sm">
          <p>Added to the library. Every rep can see it now.</p>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={startAnother}
          >
            Add another
          </Button>
        </div>
      )}
    </form>
  );
}
