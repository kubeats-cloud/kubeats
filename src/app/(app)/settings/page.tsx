import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DatabaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { LocationsPanel } from "@/components/settings/locations-panel";
import { PurposesPanel } from "@/components/settings/purposes-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listPurposeRows, listTeamMembers } from "@/lib/admin";
import { getLocationTree } from "@/lib/locations";
import { listCampuses } from "@/lib/campuses";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Not a hidden menu item: a rep who types the URL is sent back to their own
  // Dashboard, and every action behind this page checks the role again for
  // itself.
  //
  // A redirect rather than notFound(): this page renders dynamically, so the
  // response has already begun streaming by the time notFound() is reached and
  // Next answers 200 with a not-found body. The content was protected either
  // way, but a 200 on a refusal reads like a page that loaded. A redirect
  // gives an unambiguous status, and matches how a signed-out visitor is
  // turned away.
  if (!isAdmin(user)) redirect("/");

  // The photo counts moved to /data with the flush that needed them; querying
  // storage on every Settings load for a number nothing shows would be a
  // request nobody asked for.
  const [purposes, tree, members, campuses] = await Promise.all([
    listPurposeRows(),
    getLocationTree(),
    listTeamMembers(),
    listCampuses(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="The shared lists the whole team uses, the team itself, and the photo store."
      />

      <SectionTitle>Team</SectionTitle>
      <TeamPanel members={members} campuses={campuses} />

      <SectionTitle className="mt-8">Shared lists</SectionTitle>
      {/* Side by side once there is room: two independent lists an admin edits
          in either order, so stacking them on a monitor only adds scrolling. */}
      <div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-5 md:space-y-0">
        <PurposesPanel purposes={purposes} />
        <LocationsPanel tree={tree} />
      </div>

      <SectionTitle className="mt-8">Storage</SectionTitle>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-sm font-medium">Photo storage and backups</p>
            <p className="text-muted-foreground mt-1 max-w-prose text-sm">
              Flushing photos deletes files for everyone and cannot be undone, so
              it lives on its own screen rather than at the bottom of this one.
            </p>
          </div>
          <Button asChild variant="outline" className="h-10">
            <Link href="/data">
              <DatabaseIcon className="size-4" aria-hidden />
              Open Data
            </Link>
          </Button>
        </CardContent>
      </Card>

    </>
  );
}
