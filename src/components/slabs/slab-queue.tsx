import Link from "next/link";
import { LayersIcon } from "lucide-react";
import { SectionTitle } from "@/components/section-title";
import { EmptyState } from "@/components/states";
import { SlabSetForm } from "@/components/institutes/slabs-panel";
import type { SlabQueueInstitute, SlabSet } from "@/lib/slabs";
import type { SlabStatus } from "@/lib/validation/slabs";

/**
 * The admin's Slab queue: pending sets to decide, approved sets to revoke.
 *
 * ⚠ NOT A SECOND APPROVAL FLOW. Each set is the institute page's own
 * `SlabSetForm`, so Approve, Send back and Revoke are the same buttons posting
 * to the same `decideSlabs()` and `decide_slabs()`. `canEdit` is false: the
 * queue decides, it does not resubmit a rep's ranges.
 */
export function SlabQueue({ institutes }: { institutes: SlabQueueInstitute[] }) {
  const pending = only(institutes, "pending");
  const approved = only(institutes, "approved");

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>
          Awaiting approval
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {countSets(pending)}
          </span>
        </SectionTitle>
        {pending.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            title="Nothing to approve"
            description="Slab sets a rep submits appear here until you decide them."
          />
        ) : (
          <QueueList institutes={pending} />
        )}
      </section>

      <section>
        <SectionTitle>
          Approved
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {countSets(approved)}
          </span>
        </SectionTitle>
        {approved.length === 0 ? (
          <p className="text-muted-foreground text-sm">No approved slabs yet.</p>
        ) : (
          <QueueList institutes={approved} />
        )}
      </section>
    </div>
  );
}

function QueueList({ institutes }: { institutes: SlabQueueInstitute[] }) {
  return (
    <ul className="space-y-4">
      {institutes.map((institute) => (
        <li key={institute.instituteId} className="bg-card rounded-xl border p-4 shadow-xs">
          <Link
            href={`/institutes/${institute.instituteId}`}
            className="focus-visible:ring-ring mb-3 inline-block rounded-sm text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {institute.instituteName}
          </Link>
          <div className="space-y-3">
            {institute.sets.map((set) => (
              <SlabSetForm
                key={set.key}
                instituteId={institute.instituteId}
                set={set}
                canEdit={false}
                canDecide
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function only(institutes: SlabQueueInstitute[], status: SlabStatus): SlabQueueInstitute[] {
  return institutes
    .map((institute) => ({
      ...institute,
      sets: institute.sets.filter((set: SlabSet) => set.status === status),
    }))
    .filter((institute) => institute.sets.length > 0);
}

function countSets(institutes: SlabQueueInstitute[]): string {
  const n = institutes.reduce((sum, institute) => sum + institute.sets.length, 0);
  return `${n} ${n === 1 ? "set" : "sets"}`;
}
