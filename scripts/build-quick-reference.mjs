/**
 * Builds docs/KUbeats-Quick-Reference.docx — one page, for pinning up.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, BorderStyle, ShadingType, convertInchesToTwip,
} from "docx";
import { writeFileSync } from "node:fs";

const BRAND = "B02418";
const INK = "1F2937";
const MUTED = "6B7280";
const RULE = "E5E7EB";

const cell = (text, { bold, fill, size = 18, color = INK, width } = {}) => new TableCell({
  width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
  margins: { top: 70, bottom: 70, left: 110, right: 110 },
  children: [new Paragraph({ children: [new TextRun({ text, bold, size, color })] })],
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
      cell(h, { bold: true, fill: "F3F4F6", size: 17, width: widths?.[i] })) }),
    ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths?.[i] })) })),
  ],
});

const heading = (text) => new Paragraph({
  spacing: { before: 220, after: 100 },
  children: [new TextRun({ text, bold: true, size: 24, color: BRAND })],
});

const children = [
  new Paragraph({ spacing: { after: 40 },
    children: [new TextRun({ text: "KUbeats — Quick Reference", bold: true, size: 40, color: BRAND })] }),
  new Paragraph({ spacing: { after: 180 },
    children: [new TextRun({ text: "kubeats.pavanstudy2012.workers.dev   ·   sign in with the email and password your admin gave you", size: 17, color: MUTED })] }),

  heading("The ten things you do most"),
  table(
    ["#", "To do this…", "Go here"],
    [
      ["1", "Plan a visit for today", "Dashboard → Today's plan → pick institute + purpose → Add to today's plan"],
      ["2", "Record that you have ARRIVED", "Dashboard → Today's plan → Check in → Confirm check in"],
      ["3", "Log what happened", "Dashboard → Log  (or the Log Visit tab)"],
      ["4", "Record that you are LEAVING", "Dashboard → Today's plan → Check out → Confirm check out"],
      ["5", "Add a new school", "Institutes → Register → PIN code → Look up"],
      ["6", "Close a session you arranged", "Pending → log it again, choose Done"],
      ["7", "Set your targets", "Targets → Daily / Weekly / Monthly"],
      ["8", "See everything you have done", "Targets → My activity report"],
      ["9", "Download a poster or brochure", "Materials → Download"],
      ["10", "Check a rep's times and duration  (admin)", "Team → pick a rep → Their activity report → planned visits table"],
    ],
    [5, 33, 62],
  ),

  heading("The visit, in order"),
  new Paragraph({ spacing: { after: 150 }, children: [
    new TextRun({ text: "Add to plan", bold: true, size: 20, color: INK }),
    new TextRun({ text: "  →  ", size: 20, color: BRAND }),
    new TextRun({ text: "Check in", bold: true, size: 20, color: INK }),
    new TextRun({ text: "  →  ", size: 20, color: BRAND }),
    new TextRun({ text: "Log the visit + photo", bold: true, size: 20, color: INK }),
    new TextRun({ text: "  →  ", size: 20, color: BRAND }),
    new TextRun({ text: "Check out", bold: true, size: 20, color: INK }),
    new TextRun({ text: "  →  ", size: 20, color: BRAND }),
    new TextRun({ text: "time on site", bold: true, size: 20, color: BRAND }),
  ] }),

  heading("If something will not save"),
  table(
    ["It says…", "Because…", "Do this"],
    [
      ["Not on today's plan", "A meeting needs the school on today's plan", "Dashboard → add it → try again"],
      ["Check in first", "A meeting needs you to have arrived", "Press Check in on that row"],
      ["A photo is required", "Every visit needs one. No exceptions.", "Take photo, or Upload photo"],
      ["Follow-up date required", "Two statuses wait on somebody else", "Add the date you will chase it"],
      ["Already marked as held", "That visit is already logged", "Nothing — it worked the first time"],
    ],
    [24, 38, 38],
  ),

  heading("The location badge"),
  table(
    ["Badge", "Means", "Do"],
    [
      ["±12 m (good) — green", "A real GPS fix", "Carry on"],
      ["±400 m (approximate) — amber", "Roughly right", "Step outside, Try again"],
      ["±3 km (network location) — red", "Guessed from Wi-Fi, can be far out", "Step outside, Try again"],
      ["Area unavailable", "Position known, area not named", "Nothing — it still saves"],
    ],
    [30, 40, 30],
  ),
  new Paragraph({ spacing: { before: 90, after: 150 },
    children: [new TextRun({ text: "A poor location NEVER stops you saving. The time is always recorded.", bold: true, size: 18, color: BRAND })] }),

  heading("Worth knowing"),
  new Paragraph({ spacing: { after: 60 }, bullet: { level: 0 },
    children: [new TextRun({ text: "Use your phone in the field. A laptop has no GPS and will place you badly.", size: 18 })] }),
  new Paragraph({ spacing: { after: 60 }, bullet: { level: 0 },
    children: [new TextRun({ text: "A check-in time cannot be changed. Wrong school? Remove the row with × and add it again.", size: 18 })] }),
  new Paragraph({ spacing: { after: 60 }, bullet: { level: 0 },
    children: [new TextRun({ text: "A photo cannot be changed once saved. That is what makes it proof.", size: 18 })] }),
  new Paragraph({ spacing: { after: 60 }, bullet: { level: 0 },
    children: [new TextRun({ text: "Photos are deleted after 30 days. The visit, time, place and report are kept for ever.", size: 18 })] }),
  new Paragraph({ spacing: { after: 60 }, bullet: { level: 0 },
    children: [new TextRun({ text: "Forgot to check out? Next day, press Close without check-out.", size: 18 })] }),
  new Paragraph({ spacing: { after: 60 }, bullet: { level: 0 },
    children: [new TextRun({ text: "Submitted a week by mistake? Only an admin can reopen it.", size: 18 })] }),

  new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Full guide: KUbeats-User-Guide.docx   ·   KUbeats — For a smarter KU", size: 16, color: MUTED, italics: true })] }),
];

const doc = new Document({
  creator: "KUbeats",
  title: "KUbeats Quick Reference",
  styles: { default: { document: { run: { font: "Calibri", size: 18, color: INK } } } },
  sections: [{
    properties: { page: { margin: {
      top: convertInchesToTwip(0.5), bottom: convertInchesToTwip(0.45),
      left: convertInchesToTwip(0.55), right: convertInchesToTwip(0.55) } } },
    children,
  }],
});

const out = "D:/free lance/docs/KUbeats-Quick-Reference.docx";
writeFileSync(out, await Packer.toBuffer(doc));
console.log("written:", out);
