import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { MaterialBrowser } from "@/components/materials/material-browser";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listMaterials } from "@/lib/materials";

export const metadata = { title: "Materials" };

/**
 * The shared library, as everyone sees it.
 *
 * One screen for both roles: an admin browses the same list a rep does, and
 * only gets an extra link across to the management screen. Managing lives on
 * its own route so its upload form is a separate chunk that a rep never
 * downloads.
 */
export default async function MaterialsPage() {
  const user = await getCurrentUser();
  const materials = await listMaterials();

  return (
    <PageColumn>
      <PageHeader
        title="Materials"
        description="Posters, brochures and announcements shared by your admin. Tap Download to save one."
        action={
          user && isAdmin(user) ? (
            <Button asChild variant="outline" className="h-11">
              <Link href="/materials/manage">
                <SettingsIcon className="size-4" aria-hidden />
                Manage
              </Link>
            </Button>
          ) : undefined
        }
      />

      {!materials.ok ? (
        <ErrorState message="We could not load the materials library just now." />
      ) : (
        <MaterialBrowser materials={materials.materials} />
      )}
    </PageColumn>
  );
}
