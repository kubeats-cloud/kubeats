import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { LocationsPanel } from "@/components/settings/locations-panel";
import { PhotoFlushPanel } from "@/components/settings/photo-flush-panel";
import { PurposesPanel } from "@/components/settings/purposes-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  countStoredPhotos,
  getPhotoRetentionDays,
  listPurposeRows,
  listTeamMembers,
} from "@/lib/admin";
import { getLocationTree } from "@/lib/locations";

export const metadata = { title: "Settings · Field Ops" };

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

  const [purposes, tree, members, storedPhotos, retentionDays] = await Promise.all([
    listPurposeRows(),
    getLocationTree(),
    listTeamMembers(),
    countStoredPhotos(),
    getPhotoRetentionDays(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="The shared lists the whole team uses, the team itself, and the photo store."
      />

      <SectionTitle>Team</SectionTitle>
      <TeamPanel members={members} />

      <SectionTitle className="mt-8">Shared lists</SectionTitle>
      <div className="space-y-4">
        <PurposesPanel purposes={purposes} />
        <LocationsPanel tree={tree} />
      </div>

      <SectionTitle className="mt-8">Storage</SectionTitle>
      <PhotoFlushPanel
        storedPhotos={storedPhotos}
        retentionDays={retentionDays}
      />
    </>
  );
}
