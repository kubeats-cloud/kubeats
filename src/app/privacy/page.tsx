import Link from "next/link";
import { PageColumn } from "@/components/layout/page-column";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Privacy" };

/**
 * What the app records about the people who use it.
 *
 * PUBLIC ON PURPOSE, AND IN BOTH DIRECTIONS. `proxy.ts` lists this path as
 * reachable without a session — a privacy notice a person has to sign in to
 * read is not a notice — and it is deliberately NOT in the list that bounces a
 * signed-in user to the dashboard, which /login is. A rep who wants to know
 * what is being recorded about them must be able to read this while logged in.
 *
 * No session lookup, no database call: it renders identically for a rep, an
 * admin and a stranger, so there is nothing to get wrong.
 *
 * THIS COPY IS A FIRST DRAFT FOR THE CLIENT TO EDIT. It is written from what
 * the code actually does rather than from a template, and every claim below is
 * traceable: the 30 days is `public.visit_photo_retention_days()` (migration
 * 0003), the access rules are the RLS policies, the campus boundary is 0020b,
 * and the three outbound services are the only `fetch()` calls in the app that
 * leave our own origin. It is not legal advice and it has no contact address
 * yet — see HANDOVER.md, which has been waiting on the custom domain for a
 * role mailbox.
 *
 * IF THE APP CHANGES, THIS PAGE IS NOT AUTOMATICALLY WRONG-PROOF. Nothing
 * enforces that it keeps describing reality. The things most likely to date it
 * are the retention window, the third-party list, and the field set of the
 * closing report.
 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="text-muted-foreground mt-2 space-y-3 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="flex-1 px-5 py-10">
      <PageColumn>
        <h1 className="text-2xl font-semibold">Privacy</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          KUbeats is a private tool used by one education sales team to record
          field visits. It is not a public website and there is no way to sign
          up for it. This page says plainly what it records, why, who can see
          it, and how long it is kept.
        </p>

        <Section title="Who this is about">
          <p>
            Two groups of people appear in this app. The first is the team
            itself — the sales representatives and administrators who use it.
            The second is the staff at the schools, coaching centres and
            consultancies the team visits, whose names and contact numbers reps
            record so that a conversation can be picked up again later.
          </p>
        </Section>

        <Section title="What is recorded about the team">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Your account</strong> — your name, your work email
              address, your role, and which campus you work from. Accounts are
              created by an administrator; you cannot register yourself, and you
              cannot change your own role or campus.
            </li>
            <li>
              <strong>Where you were</strong> — when you check in at an
              institute and when you check out, the app records the
              coordinates your phone reports and how accurate that reading was.
              If your phone cannot get a location, you type a short reason
              instead and that reason is recorded and shown to administrators.
            </li>
            <li>
              <strong>A photograph of each visit</strong> — taken at the time,
              not chosen from your gallery afterwards. The coordinates and the
              time are read at the moment you attach it and written into the
              image itself, along with an approximate area name.
            </li>
            <li>
              <strong>What you did</strong> — the institute, the activity, the
              status you set, your notes, any head counts, the follow-up date
              and time you set, and the name and optional mobile number of the
              person you met. Plus the weekly targets you set for yourself and
              what you achieved against them.
            </li>
            <li>
              <strong>Times</strong> — when each of the above was recorded.
            </li>
          </ul>
        </Section>

        <Section title="What is recorded about institute staff">
          <p>
            For each registered institute: its name, address and area, the
            boards it follows, and the names and mobile numbers of the
            principal and the decision-maker. For each visit: the name of the
            person met, and their mobile number if the rep was given one. The
            mobile number is optional — a visit can be recorded without it.
          </p>
          <p>
            This is business contact information, collected so that a rep can
            follow up on a conversation. It is not used for marketing and it is
            not shared outside the team.
          </p>
        </Section>

        <Section title="Why the location and the photograph">
          <p>
            Because the app&rsquo;s whole purpose is to record that a visit
            actually happened. A visit log with no evidence behind it is a note,
            not a record, and the team&rsquo;s reporting rests on it. The
            location is attached to a visit, not tracked continuously: the app
            reads your position when you check in, when you attach the photo,
            and when you check out. It does not follow you between visits and it
            does not run in the background.
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            A representative sees their own visits, their own plan and their own
            targets, and the institutes belonging to their campus. An
            administrator sees the whole team&rsquo;s work across every campus.
          </p>
          <p>
            These limits are enforced by the database itself, not only by what
            the screens choose to show, so they hold even for a request made
            outside the app. Nobody outside the organisation has access.
          </p>
        </Section>

        <Section title="How long it is kept">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Photographs are deleted automatically after 30 days.</strong>{" "}
              A scheduled job removes the image files. Once that has run the
              photo cannot be recovered.
            </li>
            <li>
              <strong>Everything else is kept indefinitely</strong> — the visit
              records, the coordinates, the timestamps, the notes and the
              contact details. The visit row survives its photograph, so an
              older visit will show that a photo existed but is no longer
              available.
            </li>
            <li>
              <strong>Accounts</strong> are removed by an administrator. There
              is no automatic deletion.
            </li>
          </ul>
        </Section>

        <Section title="Other services involved">
          <p>
            The app is hosted on Cloudflare and its database, authentication and
            file storage are provided by Supabase. Both hold data on our behalf.
          </p>
          <p>
            Two outside services are queried while the app is in use.
            OpenStreetMap&rsquo;s Nominatim is sent approximate coordinates to
            turn them into an area name for the photo stamp; India Post&rsquo;s
            public PIN code service is sent a PIN code when a rep is filling in
            an institute&rsquo;s address. Neither is sent a name, an email
            address or anything else identifying a person, and the area name is
            decoration — if the lookup fails, the visit still saves.
          </p>
        </Section>

        <Section title="Asking about your own data">
          <p>
            Ask your administrator. They can show you everything recorded
            against your account, correct anything that is wrong, and remove
            your account. Because this is an internal tool used under your
            employment, requests go through them rather than through this page.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If what the app records changes, this page will be updated. It
            carries no version or date yet; the client should add one when they
            settle the wording.
          </p>
        </Section>

        <div className="mt-10">
          {/*
            Worded for both readers. This page is public AND readable while
            signed in, so "Back to sign in" was wrong half the time. "/" sends a
            signed-in person to their dashboard and a stranger to the login
            screen through the usual gate, so one link serves both.
          */}
          <Button asChild variant="outline" className="h-11">
            <Link href="/">Back to KUbeats</Link>
          </Button>
        </div>
      </PageColumn>
    </main>
  );
}
