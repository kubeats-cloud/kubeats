"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FormNotice } from "@/components/form-notice";
import { deleteInstitute } from "@/lib/institute-delete-actions";

export function DeleteInstitute({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return <>
    <Button variant="outline" className="h-11" onClick={() => { setError(null); setOpen(true); }}>Delete</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>Hide this institute from active lists. Records, reports and visit history are kept.</DialogDescription>
        </DialogHeader>
        {error && <FormNotice message={error} />}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => start(async () => {
            const result = await deleteInstitute(id);
            if (result.error) setError(result.error);
            else { setOpen(false); router.push("/institutes"); router.refresh(); }
          })}>{pending ? "Deleting…" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
