/**
 * A minimal .xlsx writer — enough for a grid with a grouped header, and no more.
 *
 * WHY THIS EXISTS RATHER THAN SheetJS. The export was specified as "use the
 * xlsx lib already in the stack", and there is no such dependency — the stack
 * has `docx` (a devDependency, used by two doc-generating scripts) and nothing
 * for spreadsheets. So something had to be chosen, and the npm `xlsx` package
 * is a poor thing to add to a live client app: SheetJS stopped publishing to
 * npm after 0.18.5 (2022) and moved to their own CDN, so the registry copy is
 * frozen on a version carrying CVE-2023-30533 (prototype pollution) and
 * CVE-2024-22363 (ReDoS). Pulling their CDN build in instead means a
 * non-registry install step in every environment that builds this app, which
 * the portability rule in CLAUDE.md exists to prevent.
 *
 * What the export actually needs is small enough to own: a sheet of strings and
 * numbers, bold header rows, merged cells for the two group bands, and column
 * widths. That is a few hundred lines with no dependency, no advisory to track,
 * and no bundle cost worth measuring.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: formulas, multiple sheets, dates as
 * serial numbers, number formats, colours, charts, reading. Every one of those
 * is a reason to reach for a real library instead, and if a second export ever
 * needs one, replacing this module is the right move — `buildWorkbook` is the
 * only exported surface, so the swap is contained to this file and its tests.
 *
 * STORED, NOT DEFLATED. A .xlsx is a ZIP, and this writes every entry with
 * method 0 (store). Compression would need zlib or CompressionStream — one is
 * Node-only and the other is async — and neither is worth it here: an export of
 * a dozen reps is tens of kilobytes either way, and Excel does not care. It
 * also keeps this module synchronous and dependency-free, which is what makes
 * it testable without a database or a runtime.
 */

export type CellValue = string | number | null;

export interface SheetMerge {
  /** Zero-based, inclusive on both ends. */
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface SheetSpec {
  name: string;
  /** Row-major grid. Short rows are padded; nothing is trimmed. */
  rows: CellValue[][];
  merges?: SheetMerge[];
  /** Zero-based row indexes to render bold. */
  boldRows?: number[];
  /** Column widths in Excel's character units, by column index. */
  widths?: number[];
  /** Rows above this index stay visible when scrolling. Zero-based count. */
  freezeRows?: number;
}

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

/**
 * XML-escape, including the control characters Excel refuses to open.
 *
 * The last replace is not decoration. A stray 0x00–0x08 or 0x0B–0x1F byte — the
 * kind that arrives in a name pasted out of another system — produces a file
 * Excel rejects wholesale with "unreadable content", and the user has no way to
 * tell which cell did it. Stripping them costs a character and saves the export.
 */
const CONTROL_BYTES = new RegExp(
  "[\u0000-\u0008\u000B\u000C\u000E-\u001F]",
  "g",
);

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Control bytes Excel refuses to open. Built from a string so no literal
    // control byte ever lands in this source file.
    .replace(CONTROL_BYTES, "");
}

/** 0 -> A, 25 -> Z, 26 -> AA. Needed the moment a status vocabulary grows. */
export function columnName(index: number): string {
  let name = "";
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

export function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

/**
 * Sheet name rules, enforced rather than trusted.
 *
 * Excel refuses : \ / ? * [ ] and anything over 31 characters, and it refuses
 * the whole FILE rather than the sheet — the same all-or-nothing failure as the
 * control characters above.
 */
function sheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

function sheetXml(spec: SheetSpec): string {
  const bold = new Set(spec.boldRows ?? []);
  const width = spec.rows.reduce((max, row) => Math.max(max, row.length), 0);

  const cols =
    spec.widths && spec.widths.length > 0
      ? `<cols>${spec.widths
          .map(
            (w, i) =>
              `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";

  const rows = spec.rows
    .map((row, r) => {
      const style = bold.has(r) ? ' s="1"' : "";
      const cells = [];
      for (let c = 0; c < width; c += 1) {
        const value = row[c];
        if (value === null || value === undefined || value === "") {
          // Still emitted when styled, so a merged header band is filled edge
          // to edge rather than showing the fill breaking at the second cell.
          if (style) cells.push(`<c r="${cellRef(r, c)}"${style}/>`);
          continue;
        }
        if (typeof value === "number") {
          cells.push(
            `<c r="${cellRef(r, c)}"${style}><v>${Number.isFinite(value) ? value : 0}</v></c>`,
          );
        } else {
          cells.push(
            `<c r="${cellRef(r, c)}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
          );
        }
      }
      return `<row r="${r + 1}">${cells.join("")}</row>`;
    })
    .join("");

  const merges = (spec.merges ?? []).filter(
    (m) => m.rowSpan > 1 || m.colSpan > 1,
  );
  const mergeXml =
    merges.length > 0
      ? `<mergeCells count="${merges.length}">${merges
          .map(
            (m) =>
              `<mergeCell ref="${cellRef(m.row, m.col)}:${cellRef(
                m.row + m.rowSpan - 1,
                m.col + m.colSpan - 1,
              )}"/>`,
          )
          .join("")}</mergeCells>`
      : "";

  const freeze =
    spec.freezeRows && spec.freezeRows > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${spec.freezeRows}" topLeftCell="A${spec.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rows}</sheetData>${mergeXml}</worksheet>`;
}

/**
 * Two styles: plain, and bold-centred-with-a-fill for the header bands.
 *
 * Index 0 is the default Excel expects to exist; index 1 is what `boldRows`
 * selects. Anything more belongs in a real library.
 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF1F5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * A ZIP container, store-only.
 *
 * DOS timestamps are pinned to a constant rather than taken from the clock, so
 * the same data exports byte-identical every time. That is what lets a test
 * assert on the bytes at all, and it means two exports of the same range can be
 * compared with a checksum instead of by opening both.
 */
function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = 0x2821; // 2020-01-01

  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [
    v & 0xff,
    (v >>> 8) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 24) & 0xff,
  ];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = Uint8Array.from([
      ...u32(0x04034b50),
      ...u16(20), // version needed
      ...u16(0x0800), // UTF-8 filenames
      ...u16(0), // stored
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ]);

    chunks.push(local, entry.bytes);

    central.push(
      Uint8Array.from([
        ...u32(0x02014b50),
        ...u16(20), // version made by
        ...u16(20), // version needed
        ...u16(0x0800),
        ...u16(0),
        ...u16(DOS_TIME),
        ...u16(DOS_DATE),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(nameBytes.length),
        ...u16(0), // extra
        ...u16(0), // comment
        ...u16(0), // disk
        ...u16(0), // internal attrs
        ...u32(0), // external attrs
        ...u32(offset),
        ...nameBytes,
      ]),
    );

    offset += local.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);

  const total =
    chunks.reduce((n, c) => n + c.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The workbook                                                        */
/* ------------------------------------------------------------------ */

/** One sheet, as .xlsx bytes. The only export of this module. */
export function buildWorkbook(spec: SheetSpec): Uint8Array {
  const encoder = new TextEncoder();
  const name = sheetName(spec.name);

  const parts: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: "xl/styles.xml", bytes: encoder.encode(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", bytes: encoder.encode(sheetXml(spec)) },
  ];

  return zip(parts);
}
