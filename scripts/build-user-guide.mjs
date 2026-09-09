/**
 * Builds docs/KUbeats-User-Guide.docx from real screenshots of the live app.
 * Run: node .shot/build-guide.mjs
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow,
  TableCell, WidthType, AlignmentType, BorderStyle, PageBreak, ShadingType,
  Header, Footer, PageNumber, convertInchesToTwip,
} from "docx";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const IMG = "D:/free lance/docs/user-guide-assets";
const BRAND = "B02418";      // the KUbeats red
const INK = "1F2937";
const MUTED = "6B7280";
const RULE = "E5E7EB";
const TINT = "FDF3F1";

const img = (name, width = 600) => {
  const path = join(IMG, `${name}.jpg`);
  if (!existsSync(path)) throw new Error(`missing screenshot: ${name}`);
  // Every capture is 1440 wide; keep the real aspect ratio.
  const raw = readFileSync(path);
  const height = Math.round(width * (name === "login" ? 765 / 1440 : 709 / 1440));
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 60 },
    children: [new ImageRun({ data: raw, transformation: { width, height },
      altText: { title: name, description: name, name } })],
  });
};

const caption = (text) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 240 },
  children: [new TextRun({ text, italics: true, size: 17, color: MUTED })],
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 },
  children: [new TextRun({ text, bold: true, size: 34, color: BRAND })],
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 },
  children: [new TextRun({ text, bold: true, size: 26, color: INK })],
});
const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3, spacing: { before: 220, after: 100 },
  children: [new TextRun({ text, bold: true, size: 22, color: INK })],
});
const p = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120 },
  children: [new TextRun({ text, size: 21, color: opts.color ?? INK, bold: opts.bold })],
});
const step = (n, text) => new Paragraph({
  spacing: { after: 100 }, indent: { left: 360, hanging: 360 },
  children: [
    new TextRun({ text: `${n}.  `, bold: true, size: 21, color: BRAND }),
    new TextRun({ text, size: 21, color: INK }),
  ],
});
const bullet = (text) => new Paragraph({
  spacing: { after: 80 }, bullet: { level: 0 },
  children: [new TextRun({ text, size: 21, color: INK })],
});

/** The on-screen path for a feature, e.g. Dashboard -> Today's plan -> Check in. */
const path_ = (label, where) => new Paragraph({
  spacing: { before: 80, after: 160 },
  shading: { type: ShadingType.CLEAR, fill: TINT },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRAND, space: 8 } },
  children: [
    new TextRun({ text: `${label}   `, bold: true, size: 19, color: BRAND }),
    new TextRun({ text: where, size: 19, color: INK }),
  ],
});

const note = (title, text) => new Paragraph({
  spacing: { before: 120, after: 180 },
  shading: { type: ShadingType.CLEAR, fill: "FEF6E7" },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: "B45309", space: 8 } },
  children: [
    new TextRun({ text: `${title}  `, bold: true, size: 19, color: "92400E" }),
    new TextRun({ text, size: 19, color: INK }),
  ],
});

const phone = (text) => new Paragraph({
  spacing: { before: 100, after: 140 },
  shading: { type: ShadingType.CLEAR, fill: "EEF6EE" },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: "166534", space: 8 } },
  children: [
    new TextRun({ text: "ON YOUR PHONE   ", bold: true, size: 18, color: "166534" }),
    new TextRun({ text, size: 19, color: INK }),
  ],
});

const cell = (text, { bold = false, fill, width } = {}) => new TableCell({
  width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text, bold, size: 19, color: INK })] })],
});

const table = (headers, rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: RULE },
  },
  rows: [
    new TableRow({ tableHeader: true, children: headers.map((h, i) =>
      cell(h, { bold: true, fill: "F3F4F6", width: widths?.[i] })) }),
    ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths?.[i] })) })),
  ],
});

const spacer = (after = 200) => new Paragraph({ spacing: { after }, children: [] });
const br = () => new Paragraph({ children: [new PageBreak()] });

// ============================================================================
const children = [];

// ---- COVER -----------------------------------------------------------------
children.push(
  new Paragraph({ spacing: { before: 2600, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "KUbeats", bold: true, size: 88, color: BRAND })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
    children: [new TextRun({ text: "For a smarter KU", size: 26, color: MUTED })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "User Guide", bold: true, size: 46, color: INK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 },
    children: [new TextRun({ text: "For field representatives and administrators", size: 24, color: MUTED })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: "kubeats.pavanstudy2012.workers.dev", size: 22, color: BRAND, bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "September 2026", size: 20, color: MUTED })] }),
  br(),
);

// ---- 1. WELCOME ------------------------------------------------------------
children.push(
  h1("1. Welcome to KUbeats"),
  p("KUbeats is how the education sales team keeps track of school visits. A rep plans their day, drives to a school, records what happened with a photograph, and moves on. An admin sees all of it from a desk, in one place, without ringing anyone to ask."),
  p("It is built for a phone in your hand at a school gate, and for a computer at a desk. Everything in this guide is written for people who use the app, not people who build it."),

  h2("The two roles"),
  table(
    ["Role", "Who it is for", "Usually on", "What they do"],
    [
      ["Field rep", "Anyone visiting schools and coaching centres", "A phone", "Plan the day, check in, log visits with a photo, check out, track targets"],
      ["Admin", "Anyone supervising the team", "A computer", "Assign visits, review what was logged, watch performance, manage the shared lists and files"],
    ],
    [14, 30, 14, 42],
  ),
  spacer(),
  p("You are one or the other, not both. The app hides what does not belong to your role, so a rep never sees the admin screens and an admin cannot log a field visit. That is deliberate: a visit record says a person was standing somewhere, and an admin at a desk was not."),

  h2("Signing in"),
  p("There is no sign-up page, and you cannot create your own account. An admin makes an account for you and gives you an email address and a password. If you cannot get in, that is who to ask."),
  step(1, "Open kubeats.pavanstudy2012.workers.dev in your browser."),
  step(2, "Type the email address and password your admin gave you."),
  step(3, "Press Sign in."),
  img("login", 420),
  caption("The sign-in screen. Accounts are created by an administrator."),
  note("Tip for reps:", "add the site to your phone's home screen the first time you sign in. It then opens like an app, and you stay signed in."),
  br(),
);

// ---- 2. FOR REPS -----------------------------------------------------------
children.push(
  h1("2. For field representatives"),
  p("This section is for the people doing the visiting. Most of it happens on a phone, standing outside a school. Where a step is easier on a computer, it says so."),

  h2("2.1  Your Dashboard"),
  path_("WHERE", "Dashboard (the first tab)"),
  p("The Dashboard is your day. Three counters across the top tell you where you stand:"),
  bullet("Planned — how many visits you intend to make today."),
  bullet("Held — how many of those you have actually logged."),
  bullet("Open loops — sessions or campus visits you have arranged but not yet closed off."),
  p("Below that is Today's plan: the list of schools you are going to, each with a button for the next thing to do."),
  img("rep-dashboard"),
  caption("The rep Dashboard. Zenith Public School is on today's plan, with a Check in button ready."),

  h2("2.2  Planning your day"),
  path_("WHERE", "Dashboard → Today's plan → Add to today's plan"),
  p("Before you can log a meeting at a school, that school has to be on today's plan. This takes about five seconds."),
  step(1, "On the Dashboard, choose the school from the Institute list."),
  step(2, "Choose why you are going from the Purpose of the visit list."),
  step(3, "Press Add to today's plan."),
  p("It appears in the list underneath, ready to check in to. If you added one by mistake, press the small × on the right to remove it — you can only do that for visits you added yourself, not ones an admin assigned to you."),
  note("Why this matters:", "a meeting can only be logged for a school that is on today's plan. This is the single most common reason a rep cannot save a meeting. Add it here first."),

  h2("2.3  Registering a new institute"),
  path_("WHERE", "Institutes → Register"),
  p("A school has to exist in KUbeats before anything can be recorded against it. Registering one takes a minute and only needs to be done once — the whole team shares the same list."),
  img("rep-institutes"),
  caption("The Institutes tab. Search, filter by state, city, type or board, and press Register to add a new one."),
  h3("Filling in the form"),
  step(1, "Name and Type — what the place is called, and whether it is a school, a coaching centre or a consultant."),
  step(2, "PIN code — type the six digits and press Look up. The state, city and area fill in by themselves. If the PIN code is not recognised, pick the state, city and area by hand from the lists beside it."),
  step(3, "Boards — tick every board the school runs. At least one is required."),
  step(4, "Contacts — the principal or owner, and the person who can actually make a decision. Mobile numbers are ten digits, no spaces and no +91."),
  step(5, "Class 11 and Class 12 — tick which streams run, and for class 12 add roughly how many students. This is what lets a session be sized later."),
  step(6, "Press Register institute."),
  img("rep-register-1"),
  caption("Registering an institute: the basics and the PIN code look-up."),
  img("rep-register-2"),
  caption("Further down the same form: contacts, and the class 11 and class 12 streams."),
  note("If a school is already listed", "do not add it again. Search for it on the Institutes tab first — duplicates make the reports harder to read for everyone."),
  br(),

  h2("2.4  Check In and Check Out — the visit timer"),
  p("This is how KUbeats records that you were actually at a school, and for how long. It is three taps spread across your visit: one when you arrive, one when you finish, and the logging in between."),
  path_("WHERE", "Dashboard → Today's plan → Check in  …then… Log  …then… Check out"),

  h3("Step 1 — Check in when you arrive"),
  phone("Do this standing at the school, not in the car on the way and not back at the office. The time and place are recorded exactly as they are when you press it."),
  step(1, "Find the school in Today's plan and press Check in."),
  step(2, "The button says Finding you… for a few seconds while your phone works out where it is. Let it finish."),
  step(3, "It then shows your position, the area name, and how accurate the reading is. Press Confirm check in."),
  p("The row now shows an In progress badge and a Log button. You are checked in; the clock is running."),
  note("You cannot undo a check-in.", "The arrival time is fixed once recorded. If you check in at the wrong school by mistake, remove that row from today's plan with the × and add it again."),

  h3("Step 2 — Log the visit while you are there"),
  step(1, "Press Log on the row. This opens the Log Visit screen with the school already chosen."),
  step(2, "Fill it in and save it — section 2.5 walks through the whole form."),
  p("Once saved, the row moves down the Dashboard with a green Held badge, and a Check out button appears."),

  h3("Step 3 — Check out when you leave"),
  step(1, "Press Check out on the row."),
  step(2, "It finds your position again, then press Confirm check out."),
  p("Underneath the row you will now see how long you were there, written plainly: 1h 25m on site."),
  note("Forgot to check out?", "If you left a visit open from an earlier day, a Close without check-out button appears. Use it to tidy up. The visit is then marked Closed, time not recorded — honest, rather than inventing a duration."),

  h3("What the accuracy badge means"),
  p("Under your position you will see a coloured badge. It is telling you how much to trust the reading:"),
  table(
    ["Badge", "What it means", "What to do"],
    [
      ["±12 m (good) — green", "A proper satellite fix. This is where you are.", "Nothing. Carry on."],
      ["±400 m (approximate) — amber", "Roughly right, but not precise.", "Step outside and press Try again if you can."],
      ["±3.0 km (network location) — red", "Worked out from Wi-Fi or the mobile network, not GPS. It can be a long way out.", "Step outside and press Try again. If it will not improve, save anyway."],
      ["Area unavailable", "Your position is known but the free map service could not name the area.", "Nothing. The coordinates are still recorded."],
    ],
    [26, 44, 30],
  ),
  spacer(),
  note("A poor location never stops you.", "You can always save. The time is recorded on the server either way, and a rep with no signal must still be able to finish their work."),
  br(),

  h2("2.5  Logging a visit"),
  path_("WHERE", "Log Visit tab, or the Log button on Today's plan"),
  img("rep-log-1"),
  caption("Logging a visit: what happened, where you are, and the photograph."),
  h3("What happened"),
  p("Choose the Activity — what you actually did:"),
  table(
    ["Activity", "When to use it", "Needs to be on today's plan?"],
    [
      ["Meeting", "A meeting at the school", "Yes — and you must be checked in"],
      ["Session", "A session you arranged (Set) or ran (Done)", "No"],
      ["Campus Visit", "A campus visit arranged (Set) or completed (Done)", "No"],
      ["Olympiad Registration", "Registrations collected", "No"],
      ["Application Form", "Application forms collected", "No"],
      ["Admission", "An admission confirmed", "No"],
    ],
    [26, 46, 28],
  ),
  spacer(),
  p("For Session and Campus Visit you also choose Set or Done. Set means you have arranged it for a future date — it stays on your Pending list until you come back and log it as Done."),

  h3("The photograph — always required"),
  p("Every visit needs a photo. There is no way to save without one; this is the record the whole system rests on."),
  phone("Take photo opens your camera, facing outwards. Point it at the school gate, the signage, or the room you are in, and take the picture."),
  p("On a computer, Take photo may not work — use Upload photo and pick a file instead."),
  p("Whichever you use, KUbeats writes your position, the area name and the exact time onto the picture before it is sent. That stamp is part of the image and cannot be changed afterwards."),
  img("rep-log-2"),
  caption("The rest of the form: notes, the institute status, and an optional follow-up date."),

  h3("Notes and status"),
  bullet("Notes — anything worth saying. Free text, optional."),
  bullet("Update institute status — where this school now stands. Leave it on No change if nothing moved."),
  bullet("Follow-up date and time — when you will come back. Optional for most statuses."),
  p("Then press Save visit."),
  note("Two statuses need a follow-up date.", "Pending for management approval and Invited principal for event both mean you are waiting on somebody else, so KUbeats asks when you will chase it. It will not save without one."),

  h3("The nine institute statuses"),
  table(
    ["Status", "Meaning", "Still open?"],
    [
      ["First meeting done", "You have met them once", "Open"],
      ["Session scheduled", "A session is booked", "Open"],
      ["Campus visit scheduled", "A campus visit is booked", "Open"],
      ["Pending for management approval", "Waiting on their management", "Open — needs a follow-up date"],
      ["Invited principal for event", "Invitation sent, no answer yet", "Open — needs a follow-up date"],
      ["Session done", "The session happened", "Closed"],
      ["Campus visit done", "The campus visit happened", "Closed"],
      ["RSVP received", "They have replied and confirmed", "Closed"],
      ["Will not come", "They have declined", "Closed"],
    ],
    [30, 42, 28],
  ),
  spacer(),
  p("Closed does not mean finished forever. You can put a closed school back on your plan any time — its status stays as it is until you deliberately change it."),
  br(),

  h2("2.6  Pending — closing your open loops"),
  path_("WHERE", "Pending tab"),
  p("When you log a Session or Campus Visit as Set, it is a promise: something is arranged for later. It waits on the Pending tab until you close it."),
  step(1, "Open the Pending tab. Each item shows the school and the date you expected."),
  step(2, "When the session actually happens, log it again with the same activity and choose Done."),
  step(3, "It disappears from Pending and your Sessions Done figure goes up."),
  img("rep-pending"),
  caption("The Pending tab, with nothing outstanding. Anything you set but have not closed appears here."),

  h2("2.7  Targets"),
  path_("WHERE", "Targets tab"),
  p("Targets are what you are aiming for, and what you have actually done, side by side. You can set them for a day, a week or a month using the three buttons at the top."),
  step(1, "Choose Daily, Weekly or Monthly."),
  step(2, "Use the arrows to move to the period you want."),
  step(3, "Type your numbers into each box, then save."),
  step(4, "As you work, the Achieved figure fills in by itself. You never type it."),
  img("rep-targets"),
  caption("Weekly targets. Each metric shows what you committed to, what you have achieved, and what remains."),
  p("There are nine things counted. Eight are counts of what you logged; the ninth, Institutes Covered, counts different schools — visiting one school four times counts once."),
  note("Once you submit a week, it locks.", "You cannot change what you promised after the fact. If you genuinely need to, ask an admin to reopen it. The achieved numbers keep updating either way."),

  h2("2.8  Your activity report"),
  path_("WHERE", "Targets → My activity report"),
  p("A plain summary of everywhere you have been, by day, month or year: total visits, how many different schools, what is complete, what is still open, and a breakdown by activity. Useful before a review conversation."),

  h2("2.9  Materials"),
  path_("WHERE", "Materials tab"),
  p("Posters, brochures, fee sheets and announcements your admin has shared. Press Download on anything you need — it saves to your phone so you can show it or print it."),
  img("rep-materials"),
  caption("The Materials library. Everything here is put there by an admin; reps download only."),
  br(),
);

// ---- 3. FOR ADMINS ---------------------------------------------------------
children.push(
  h1("3. For administrators"),
  p("This section is for whoever supervises the team. It is written for a computer, because that is where this work is comfortable. Your tabs are different from a rep's: Overview, Review, Assign, Team, Institutes and Settings, with two more tools one tap deeper."),

  h2("3.1  Overview — the daily picture"),
  path_("WHERE", "Overview (the first tab)"),
  p("Where to start each morning. Four counters across the top — visits today, visits this week, reports filed, photos in — then the latest visits the team has logged, who is out today, and how many open loops are outstanding."),
  img("admin-overview"),
  caption("The admin Overview. Latest activity on the left; who is out and what is open on the right."),

  h2("3.2  Assign — putting a visit on a rep's plan"),
  path_("WHERE", "Assign tab"),
  step(1, "Choose the rep under Who."),
  step(2, "Choose the school and the purpose."),
  step(3, "Set the date under When."),
  step(4, "Press Assign."),
  p("It appears on that rep's Dashboard immediately, badged Assigned by you. A rep cannot delete an assignment — it came from you, and quietly dismissing it would lose the ask."),
  img("admin-assign"),
  caption("Assigning a visit. Outstanding assignments stay listed on the right until the rep logs them."),

  h2("3.3  Review — every visit, with its photo"),
  path_("WHERE", "Review tab"),
  p("Everything the team has logged, newest first, with the photograph and the closing report. Filter by rep, institute, activity, date range, or whether a report has been filed."),
  img("admin-review"),
  caption("The Review list. The Photo column shows each visit's photograph; the arrow opens the full record."),
  p("Click any row to open the full visit. There you will find:"),
  bullet("The photograph, with the location and time stamped into it."),
  bullet("GPS location — the exact coordinates and the area name."),
  bullet("Institute address — the school's registered address. This is deliberately separate from the GPS reading, so you can tell what was measured from what was typed in."),
  bullet("The closing report: who was met, what was discussed, the outcome, and any remarks."),
  note("Photographs cannot be edited.", "Once a photo is attached to a visit it can never be changed or removed by anyone, including you. That is what makes it evidence."),

  h2("3.4  Team — performance at a glance"),
  path_("WHERE", "Team tab"),
  p("Each rep's commitment for the week and what they have achieved against it, with open loops and a progress bar. Use the arrows to look at other weeks. Click any row to drill into that person."),
  img("admin-team"),
  caption("The Team screen: one row per person, for the week you are looking at."),
  h3("Reopening a locked week"),
  p("When a rep submits a week it locks, and they cannot change what they promised. If a target was entered wrongly, open that rep from the Team screen and reopen the week. Only an admin can do this."),

  h2("3.5  The activity report, per rep"),
  path_("WHERE", "Team → pick a rep → Their activity report"),
  p("The fullest view of one person's work, by day, month or year. Use the name buttons along the top to switch between reps without going back."),
  img("admin-report"),
  caption("A rep's activity report. Switch reps with the buttons at the top; switch period with Daily, Monthly, Yearly."),
  p("Two things here are worth understanding, because they are the questions that come up most:"),
  bullet("Meetings held, counted from the daily plan — meetings are counted from what was planned and held, never from the visit list. The two figures are different on purpose."),
  bullet("Institutes covered — different schools reached, not visits made."),
  h3("Check-in and check-out times"),
  p("Scroll down to the planned-visits table. For every visit it shows when the rep arrived, when they left, how long they were on site, and the status:"),
  table(
    ["Column", "What it tells you"],
    [
      ["Scheduled", "The date the visit was planned for"],
      ["Checked in", "Arrival time, with the position and how accurate it was"],
      ["Checked out", "Departure time, the same way"],
      ["On site", "The duration, worked out from the two"],
      ["Status", "Scheduled, In Progress, or Completed"],
      ["Report", "Whether a closing report has been filed"],
    ],
    [24, 76],
  ),
  spacer(),
  note("Read the accuracy badge, not just the time.", "A green ±12 m means the rep's phone had a proper satellite fix. A red ±3 km means the position came from Wi-Fi and could be a long way out — common indoors and on laptops. It is a measure of confidence, not of honesty."),
  br(),

  h2("3.6  Settings — the shared lists and the team"),
  path_("WHERE", "Settings tab"),
  img("admin-settings-1"),
  caption("Settings: everyone on the team, their email address and their role."),
  h3("Adding a rep account"),
  step(1, "Go to Settings and press Add a team member."),
  step(2, "Enter their name and email address, and choose Rep or Admin."),
  step(3, "Give them the password the app sets, and tell them to sign in at the address on the cover of this guide."),
  p("There is no self sign-up. Every account is created here."),
  h3("Meeting purposes"),
  p("The list reps choose from when planning a visit. Add one with the box at the bottom; remove one with the bin icon. Changing this list changes what every rep sees."),
  img("admin-settings-2"),
  caption("Meeting purposes on the left, locations on the right."),
  h3("Locations"),
  p("States, cities and areas. Most of the time these fill in by themselves from a PIN code and you never touch this. Add one by hand when a rep needs an area the PIN code service does not know."),

  h2("3.7  Materials — sharing files with the team"),
  path_("WHERE", "Overview → Manage materials, or Materials → Manage"),
  step(1, "Give the file a Title and choose a Category — Poster, Brochure, Fee Structure, Event Letter, Announcement or Other."),
  step(2, "Add a Description if it helps a rep know when to use it."),
  step(3, "Choose the file: JPG, PNG, WebP or PDF, up to 5 MB."),
  step(4, "Press Add to the library."),
  p("It is immediately visible to every rep on their Materials tab. Files are stored exactly as uploaded and never compressed, so a poster stays print-quality."),
  img("admin-materials"),
  caption("Uploading a material. Only admins can add or delete; every rep can download."),
  note("Deleting is permanent.", "Removing a material deletes the file itself. There is no undo, so download a copy first if you might want it back."),

  h2("3.8  Data — storage and backups"),
  path_("WHERE", "Overview → Data, or Settings → Data"),
  img("admin-data"),
  caption("The Data screen: clearing old photos, and taking backups."),
  h3("Photo storage"),
  p("Visit photographs are deleted automatically after 30 days to keep storage under control. The visits themselves — the time, the place, the notes, the report — are kept for ever. Only the picture goes."),
  p("If you need space sooner, choose a cutoff, press Check how many to see what would go, and only then clear them."),
  h3("Backups"),
  p("A backup covers four things that live in different places: the table rows, the user accounts, the photo and material files, and two settings that only exist inside the hosting service."),
  note("This part is technical.", "Taking and restoring a backup is a job for whoever looks after the system, not a day-to-day task. The full runbook is docs/BACKUP-RESTORE.md in the project repository. Ask your developer."),
  br(),
);

// ---- 4. FAQ ----------------------------------------------------------------
children.push(
  h1("4. Common questions"),

  h3("Why can't I log a meeting?"),
  p("Almost always one of two reasons, in this order:"),
  bullet("The school is not on today's plan. Go to the Dashboard, add it under Today's plan, then try again."),
  bullet("You have not checked in yet. Press Check in on that row first. A meeting cannot be recorded for a school you have not arrived at."),
  p("Sessions, campus visits, olympiad registrations, application forms and admissions do not need either — they can be logged at any time."),

  h3("Why does it say my location is approximate?"),
  p("You are probably indoors, or on a computer. A laptop has no GPS, so the browser guesses from Wi-Fi, and that guess can be kilometres out even when it claims to be precise. Step outside and press Try again. If it will not improve, save anyway — the time is recorded regardless."),

  h3("It won't let me save without a photo."),
  p("That is correct and cannot be bypassed. A visit without a photograph is not a record of anything. Use Upload photo if the camera will not open."),

  h3("I checked in at the wrong school."),
  p("The arrival time cannot be changed once recorded. Remove that row from today's plan using the × beside it, then add the school again — you will get a fresh row and an honest new arrival time."),

  h3("I forgot to check out."),
  p("The next day, that visit shows a Close without check-out button. Press it. The visit is marked complete with the time on site left blank, which is more honest than a made-up number."),

  h3("Why is the Meetings figure different from the number of visits?"),
  p("Meetings are counted from the daily plan — from visits that were planned and then held — while everything else is counted from what was logged. This is deliberate, so that a meeting always corresponds to a planned, checked-in visit."),

  h3("Where did my photo go?"),
  p("Photographs are deleted automatically after 30 days. The visit, its time, its place and its report are all still there; only the picture is removed, to keep storage manageable."),

  h3("I can't change my week's targets."),
  p("You submitted the week, which locks it. Ask an admin to reopen it from the Team screen."),

  h3("I've forgotten my password."),
  p("Ask an admin. They can set you a new one from Settings. There is no self-service reset."),
  br(),
);

// ---- 5. WHERE EVERYTHING LIVES --------------------------------------------
children.push(
  h1("5. Where everything lives"),
  h2("Rep screens"),
  table(
    ["I want to…", "Go to"],
    [
      ["See my day", "Dashboard"],
      ["Add a school to today's plan", "Dashboard → Today's plan → Add to today's plan"],
      ["Record that I have arrived", "Dashboard → Today's plan → Check in"],
      ["Log what happened", "Dashboard → Log, or the Log Visit tab"],
      ["Record that I am leaving", "Dashboard → Today's plan → Check out"],
      ["Add a new school", "Institutes → Register"],
      ["Find a school", "Institutes → search box"],
      ["Close a session I arranged", "Pending → log it again as Done"],
      ["Set or check my targets", "Targets"],
      ["See everything I have done", "Targets → My activity report"],
      ["Download a brochure", "Materials → Download"],
    ],
    [40, 60],
  ),
  spacer(),
  h2("Admin screens"),
  table(
    ["I want to…", "Go to"],
    [
      ["See what the team did today", "Overview"],
      ["Put a visit on a rep's plan", "Assign"],
      ["Check a visit and its photo", "Review → click the row"],
      ["See check-in and check-out times", "Team → pick a rep → Their activity report → planned visits table"],
      ["Compare the team this week", "Team"],
      ["Reopen a locked week", "Team → pick a rep → reopen"],
      ["Add a rep account", "Settings → Add a team member"],
      ["Change the purposes list", "Settings → Meeting purposes"],
      ["Add a state, city or area", "Settings → Locations"],
      ["Share a poster or brochure", "Overview → Manage materials"],
      ["Clear old photos or take a backup", "Overview → Data"],
    ],
    [40, 60],
  ),
  spacer(300),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 },
    children: [new TextRun({ text: "KUbeats — For a smarter KU", size: 20, color: MUTED, italics: true })] }),
);

const doc = new Document({
  creator: "KUbeats",
  title: "KUbeats User Guide",
  description: "User guide for field representatives and administrators",
  styles: { default: { document: { run: { font: "Calibri", size: 21, color: INK } } } },
  sections: [{
    properties: { page: { margin: {
      top: convertInchesToTwip(0.85), bottom: convertInchesToTwip(0.85),
      left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) } } },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "KUbeats User Guide", size: 16, color: MUTED })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 16, color: MUTED })] })] }) },
    children,
  }],
});

const out = "D:/free lance/docs/KUbeats-User-Guide.docx";
writeFileSync(out, await Packer.toBuffer(doc));
console.log("written:", out);
