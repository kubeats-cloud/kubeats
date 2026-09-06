import { permanentRedirect } from "next/navigation";

/**
 * /weekly is now /targets, which does daily and monthly as well.
 *
 * NOTE: proxy.ts answers /weekly before this page is ever reached, so that the
 * redirect is a real HTTP 307 rather than a 200 with the redirect buried in the
 * streamed payload. This file is kept as a fallback: if the proxy matcher ever
 * stops covering /weekly, a bookmarked link should still land on the right
 * screen rather than 404. Both send people to the same place.
 *
 * Kept as a redirect rather than deleted: the route has been in the navigation
 * bar since Phase 1, so it is in bookmarks and in at least one handover
 * document, and a 404 for a screen that still exists under a better name is a
 * poor answer.
 *
 * ?week= becomes ?start= and the period is pinned to weekly, so an old link
 * lands on exactly the week it used to.
 */
export default async function WeeklyRedirectPage(props: PageProps<"/weekly">) {
  const searchParams = await props.searchParams;
  const first = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;

  const params = new URLSearchParams({ period: "weekly" });
  const week = first(searchParams.week);
  if (week) params.set("start", week);
  const member = first(searchParams.member);
  if (member) params.set("member", member);

  permanentRedirect(`/targets?${params.toString()}`);
}
