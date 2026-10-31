"use client";

import { useState } from "react";
import { ActivityCard } from "@/components/activity/activity-card";
import {
  ACTIVITY_TABS,
  DEFAULT_ACTIVITY_TAB,
  type ActivityTabKey,
} from "@/components/activity/activity-tabs-meta";

/**
 * The container the four reports share.
 *
 * ⚠ CARD SWITCHING IS LOCAL STATE, NOT NAVIGATION. The four report panels
 * (`rep`/`call`/`pipeline`/`institute`) are fetched and rendered server-side
 * once, on the Activity page's own load — this component only decides which
 * ONE is visible, via a plain `useState` and the `hidden` attribute on its
 * siblings. Clicking a card never calls `router.push` and never re-renders
 * the page, which is what "swaps the report in place" means here.
 *
 * `initialTab` seeds the state from `?tab=`, so a report's own Apply/Clear/
 * sort/page link — which DOES navigate, because it needs fresh server data —
 * can carry `tab=<itself>` and land back on the card the reader was using.
 * Between navigations, though, this state can drift from the URL (switching
 * cards never writes one), which is why every outgoing link a report box
 * builds states its own tab explicitly rather than trusting `?tab=`.
 */
export function ActivityTabs({
  initialTab = DEFAULT_ACTIVITY_TAB,
  rep,
  call,
  pipeline,
  institute,
}: {
  initialTab?: ActivityTabKey;
  rep: React.ReactNode;
  call: React.ReactNode;
  pipeline: React.ReactNode;
  institute: React.ReactNode;
}) {
  const [tab, setTab] = useState<ActivityTabKey>(initialTab);
  const panels: Record<ActivityTabKey, React.ReactNode> = {
    rep,
    call,
    pipeline,
    institute,
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Activity report"
        className="mb-4 flex flex-wrap gap-2"
      >
        {ACTIVITY_TABS.map((card) => (
          <ActivityCard
            key={card.key}
            label={card.label}
            description={card.description}
            active={tab === card.key}
            onClick={() => setTab(card.key)}
          />
        ))}
      </div>

      {ACTIVITY_TABS.map((card) => (
        <div key={card.key} hidden={tab !== card.key}>
          {panels[card.key]}
        </div>
      ))}
    </>
  );
}
