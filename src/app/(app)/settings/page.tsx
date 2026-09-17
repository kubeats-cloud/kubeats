import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DatabaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { LocationsPanel } from "@/components/settings/locations-panel";
import { PurposesPanel } from "@/components/settings/purposes-panel";
import { StatusesPanel } from "@/components/settings/statuses-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { SignInSecurityPanel } from "@/components/settings/sign-in-security-panel";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listPurposeRows, listStatusRows, listTeamMembers } from "@/lib/admin";
import { listAdminFactorStates, viewerHasFactor } from "@/lib/mfa-admin";
import { getLocationTree } from "@/lib/locations";
import { settled } from "@/lib/errors";
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
  /*
   * Each wrapped, for the reason the Dashboard gives at length: every helper
   * here already degrades on a database error, but `Promise.all` rejects as a
   * whole if any one of them rejects, and this screen carries six independent
   * panels. One unreachable list should empty its own card, not replace the
   * team, the shared lists, the locations and the security panel with an error.
   */
  const [purposes, statuses, tree, members, campuses, enrolled] = await Promise.all([
    settled(listPurposeRows(), [], "settings:purposes"),
    settled(listStatusRows(), [], "settings:statuses"),
    settled(getLocationTree(), [], "settings:locations"),
    settled(listTeamMembers(), [], "settings:team"),
    settled(listCampuses(), [], "settings:campuses"),
    settled(viewerHasFactor(), false, "settings:viewer-factor"),
  ]);

  // Sequenced after `members` because it needs the admin rows. Only admins are
  // listed: a rep cannot enrol, so a reset row for one could only ever read
  // "nothing set up".
  // Wrapped like the six above even though it now guards itself internally —
  // one bare call among six settled ones reads as an oversight, and the next
  // await added inside it would silently stop being covered.
  const adminFactors = await settled(
    listAdminFactorStates(
      members
        .filter((member) => member.role === "admin")
        .map((member) => ({ id: member.id, name: member.name })),
    ),
    [],
    "settings:admin-factors",
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="The shared lists the whole team uses, the team itself, and the photo store."
      />

      <SectionTitle>Team</SectionTitle>
      <TeamPanel members={members} campuses={campuses} />

      <SectionTitle className="mt-8">Sign-in security</SectionTitle>
      <SignInSecurityPanel
        enrolled={enrolled}
        viewerId={user.id}
        admins={adminFactors}
      />

      <SectionTitle className="mt-8">Shared lists</SectionTitle>
      {/* Side by side once there is room: two independent lists an admin edits
          in either order, so stacking them on a monitor only adds scrolling. */}
      <div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-5 md:space-y-0">
        <PurposesPanel purposes={purposes} />
        <LocationsPanel tree={tree} />
      </div>

      <SectionTitle className="mt-8">Institute statuses</SectionTitle>
      <StatusesPanel statuses={statuses} />

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
