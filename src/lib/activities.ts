/**
 * The six activity keys from the visits table, and how they read to a person.
 * Lives here because the institute history renders them now and the Phase 5
 * visit workflow will need exactly the same mapping.
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  meeting: "Meeting",
  session: "Session",
  campus_visit: "Campus Visit",
  olympiad: "Olympiad Registration",
  application: "Application Form",
  admission: "Admission",
};

export function activityLabel(activity: string): string {
  return ACTIVITY_LABELS[activity] ?? activity;
}
