import { DatabaseBackupIcon, TerminalIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { ErrorState } from "@/components/states";
import { PhotoFlushPanel } from "@/components/settings/photo-flush-panel";
import { countStoredPhotos, getPhotoRetentionDays, requireAdmin } from "@/lib/admin";
import { todayISO } from "@/lib/dates";

export const metadata = { title: "Data" };

/**
 * The tools that touch stored data, kept off the navigation bar on purpose.
 *
 * One of them deletes photographs in bulk. A bar item is for what you reach for
 * daily; this is reached for a few times a year, and the extra tap is the point
 * rather than an oversight.
 */
export default async function DataPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <PageColumn>
        <PageHeader title="Data" />
        <ErrorState message={gate.error} />
      </PageColumn>
    );
  }

  const [storedPhotos, retentionDays] = await Promise.all([
    countStoredPhotos(),
    getPhotoRetentionDays(),
  ]);

  return (
    <PageColumn>
      <PageHeader
        eyebrow="Admin"
        title="Data"
        description="Storage and backups. Both of these affect everyone, so read before you press."
      />

      <SectionTitle>Photo storage</SectionTitle>
      <PhotoFlushPanel
        storedPhotos={storedPhotos}
        retentionDays={retentionDays}
        today={todayISO()}
      />

      <SectionTitle className="mt-8">Backups</SectionTitle>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackupIcon className="text-muted-foreground size-4" aria-hidden />
            Taking a backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground leading-relaxed">
            A backup covers four things that live in different places: the table
            rows, the auth users, the photo files, and the Vault secret and cron
            job that only exist inside Supabase. A database dump alone is not a
            backup of this system.
          </p>

          <div className="bg-secondary/60 rounded-md p-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium">
              <TerminalIcon className="size-3.5" aria-hidden />
              Run from the project, on a machine that has the keys
            </p>
            <code className="block font-mono text-xs">npm run backup</code>
            <code className="text-muted-foreground mt-1 block font-mono text-xs">
              npm run backup -- --no-photos
            </code>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            It is deliberately not a button here. Backing up reads every row and
            every photo in the project, which needs the service-role key — and
            that key must never be handed to a browser, not even an
            administrator&rsquo;s. The full procedure, including restoring into a
            new project, is in{" "}
            <span className="text-foreground font-medium">docs/BACKUP-RESTORE.md</span>.
          </p>
        </CardContent>
      </Card>
    </PageColumn>
  );
}
