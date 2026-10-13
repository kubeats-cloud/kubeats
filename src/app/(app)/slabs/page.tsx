import { redirect } from "next/navigation";
import { Building2Icon } from "lucide-react";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { SlabInstitutePicker } from "@/components/slabs/institute-picker";
import { SlabsPanel } from "@/components/institutes/slabs-panel";
import { SlabQueue } from "@/components/slabs/slab-queue";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listSlabQueue, listSlabSets } from "@/lib/slabs";
import { listInstitutesForPicker } from "@/lib/visits";

export const metadata = { title: "Slabs" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * Slab, as its own screen.
 *
 * The institute page still mounts the same `SlabsPanel`. This route is the
 * direct way in: a rep picks one school from the list RLS already narrowed,
 * and the panel underneath is not a second copy.
 *
 * ⚠ THE QUERY IS NOT A PERMISSION. `?institute=` is only honoured when that
 * id is in `listInstitutesForPicker()`, which is `institutes_select` —
 * `supervises(registered_by)`. A rep therefore cannot open a colleague's
 * slabs by editing the URL: the id is not in their list, so the panel is
 * not mounted. RLS would refuse the read anyway; this is the screen saying
 * so instead of showing an empty set that looks like "no slabs yet".
 */
export default async function SlabsPage(props: PageProps<"/slabs">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);

  /*
   * An admin's Slabs tab is the approval queue, across every institute. The
   * institute page keeps its own panel, which decides through the same form
   * and the same action — one flow, two doors.
   */
  if (admin) {
    const queue = await listSlabQueue();
    return (
      <PageColumn>
        <PageHeader
          eyebrow="Admin"
          title="Slabs"
          description="Slab sets reps have submitted. Approve them here, or revoke one that is already approved."
        />
        {queue.ok ? (
          <SlabQueue institutes={queue.institutes} />
        ) : (
          <ErrorState message="We could not load the slabs just now." />
        )}
      </PageColumn>
    );
  }

  const requested = first((await props.searchParams).institute);
  const institutes = await listInstitutesForPicker();
  const chosen = requested
    ? institutes.find((institute) => institute.id === requested)
    : undefined;

  const slabList = chosen ? await listSlabSets(chosen.id) : null;

  return (
    <PageColumn>
      <PageHeader
        title="Slabs"
        description="Admission ranges for one of your institutes. Submit a set, and edit it again if it is sent back."
      />

      {institutes.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="No institutes yet"
          description="Register an institute first. Its slabs are set from here."
        />
      ) : (
        <SlabInstitutePicker
          institutes={institutes.map((institute) => ({
            id: institute.id,
            name: institute.name,
          }))}
          selectedId={chosen?.id ?? null}
        />
      )}

      {requested && !chosen && (
        <p className="text-muted-foreground text-sm" role="status">
          That institute is not in your list.
        </p>
      )}

      {chosen && slabList && !slabList.ok && (
        <ErrorState message="We could not load the slabs just now." />
      )}

      {chosen && slabList?.ok && (
        <SlabsPanel
          instituteId={chosen.id}
          sets={slabList.sets}
          canEdit={admin || chosen.registered_by === user.id}
          canDecide={admin}
        />
      )}
    </PageColumn>
  );
}
