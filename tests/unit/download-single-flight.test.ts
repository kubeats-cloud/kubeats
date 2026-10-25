import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("download controls accept one click at a time", () => {
  const control = read("src/components/report/export-excel.tsx");

  it("guards the anchor synchronously and while the state is busy", () => {
    expect(control).toContain("const busyRef = useRef(false)");
    expect(control).toContain("if (disabled || busyRef.current)");
    expect(control).toContain("event.preventDefault()");
    expect(control).toContain("setBusy(true)");
    expect(control).toContain("aria-disabled={disabled || busy}");
    expect(control).toContain('"pointer-events-none opacity-50"');
    expect(control).toContain("onClick={onClick}");
  });

  it("uses that guard for the Overview and rep downloads", () => {
    expect(control).toContain("<DownloadButton");
    const rep = read("src/components/report/download-activity.tsx");
    expect(rep).toContain(
      'import { DownloadButton } from "@/components/report/export-excel"',
    );
    expect(rep).toContain("<DownloadButton");
    expect(rep).not.toMatch(/<a[^>]*download/);
  });

  it("uses the same guarded control for the Institute Activity export", () => {
    const page = read("src/app/(app)/institutes/page.tsx");
    expect(page).toContain(
      'import { DownloadButton } from "@/components/report/export-excel"',
    );
    expect(page).toContain("<DownloadButton");
    expect(page).not.toMatch(/<a[^>]*download/);
  });

  it("still renders the Overview export", () => {
    const page = read("src/app/(app)/page.tsx");
    expect(page).toContain('import { ExportExcel } from "@/components/report/export-excel"');
    expect(page).toContain("<ExportExcel");
  });
});
