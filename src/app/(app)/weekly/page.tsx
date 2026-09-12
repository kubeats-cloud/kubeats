import { permanentRedirect } from "next/navigation";

/**
 * /weekly is now /targets, where a rep sets the week's eight numbers.
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
 * ?week= is carried through unchanged. It briefly became ?period=weekly&start=
 * while /targets had a daily/weekly/monthly switcher; only the week is offered
 * now, so the screen reads ?week= and translating it would drop the saved week.
 * This must stay in step with the same redirect in proxy.ts.
 */
export default async function WeeklyRedirectPage(props: PageProps<"/weekly">) {
  const searchParams = await props.searchParams;
  const first = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;

  const params = new URLSearchParams();
  const week = first(searchParams.week);
  if (week) params.set("week", week);
  const member = first(searchParams.member);
  if (member) params.set("member", member);

  permanentRedirect(`/targets?${params.toString()}`);
}
