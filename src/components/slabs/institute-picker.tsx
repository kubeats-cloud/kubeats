"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";

/**
 * The institute the slab screen is about.
 *
 * A native select, because the list is the rep's own schools and a phone
 * already knows how to present one. Choosing a row is a navigation: the page
 * is a server component, and the id in the query is what it loads.
 */
export function SlabInstitutePicker({
  institutes,
  selectedId,
}: {
  institutes: { id: string; name: string }[];
  selectedId: string | null;
}) {
  const router = useRouter();

  return (
    <div className="mb-6 space-y-1.5">
      <Label htmlFor="slab-institute">Institute name</Label>
      <select
        id="slab-institute"
        className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm"
        value={selectedId ?? ""}
        onChange={(event) => {
          const id = event.target.value;
          router.push(id ? `/slabs?institute=${encodeURIComponent(id)}` : "/slabs");
        }}
      >
        <option value="">Select an institute</option>
        {institutes.map((institute) => (
          <option key={institute.id} value={institute.id}>
            {institute.name}
          </option>
        ))}
      </select>
    </div>
  );
}
