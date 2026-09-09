import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { ErrorState } from "@/components/states";
import { MaterialManageList } from "@/components/materials/material-manage-list";
import { MaterialUploadForm } from "@/components/materials/material-upload-form";
import { requireAdmin } from "@/lib/admin";
import { listMaterialsForAdmin } from "@/lib/materials";
import { listCampuses } from "@/lib/campuses";

export const metadata = { title: "Manage materials" };

/**
 * Adding to and pruning the library.
 *
 * Its own route rather than a branch inside /materials, so the upload form and
 * the delete controls compile into a chunk only an admin ever loads. That is
 * the whole reason for the split — a rep's Materials screen carries none of it.
 *
 * Admin-only three times over: proxy.ts redirects a rep away from
 * /materials/manage, requireAdmin() refuses here, and every RLS and storage
 * policy behind the actions is keyed on is_admin().
 */
export default async function ManageMaterialsPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <PageColumn>
        <PageHeader eyebrow="Admin" title="Manage materials" />
        <ErrorState message={gate.error} />
      </PageColumn>
    );
  }

  const [materials, campuses] = await Promise.all([
    listMaterialsForAdmin(),
    listCampuses(),
  ]);

  return (
    <PageColumn>
      <PageHeader
        eyebrow="Admin"
        title="Manage materials"
        description="What you add here is visible to every rep, and downloadable by all of them."
        action={
          <Button asChild variant="ghost" className="h-11">
            <Link href="/materials">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Library
            </Link>
          </Button>
        }
      />

      <FormSection
        title="Upload a material"
        description="The file is stored as uploaded. Nothing is compressed, so print quality is kept."
        className="mb-6"
      >
        <MaterialUploadForm userId={gate.user.id} campuses={campuses} />
      </FormSection>

      <SectionTitle>In the library</SectionTitle>
      {!materials.ok ? (
        <ErrorState message="We could not load the library just now." />
      ) : (
        <MaterialManageList materials={materials.materials} />
      )}
    </PageColumn>
  );
}
