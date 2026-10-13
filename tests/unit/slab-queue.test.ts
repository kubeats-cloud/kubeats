import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Admin 3: the admin's Slabs tab is a queue of pending and approved sets, and
 * it decides through the institute page's own form — not a second flow.
 */

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
const tsCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("admin Slab queue", () => {
  it("reads pending and approved sets from the same table, no new RPC", () => {
    const lib = tsCode("src/lib/slabs.ts");
    const fn = lib.slice(lib.indexOf("export async function listSlabQueue"));
    expect(fn).toContain('.from("institute_slabs")');
    expect(fn).toContain('.in("status", ["pending", "approved"])');
    expect(fn).not.toContain(".rpc(");
  });

  it("decides through SlabSetForm, read-only, with the admin's decide controls", () => {
    const queue = tsCode("src/components/slabs/slab-queue.tsx");
    expect(queue).toContain('import { SlabSetForm } from "@/components/institutes/slabs-panel"');
    expect(queue).toMatch(/<SlabSetForm[\s\S]*canEdit=\{false\}[\s\S]*canDecide/);
    expect(queue).not.toContain("decideSlabs");
    expect(queue).not.toContain("decide_slabs");
  });

  it("shows the queue to an admin only; everyone else keeps the picker", () => {
    const page = tsCode("src/app/(app)/slabs/page.tsx");
    expect(page).toMatch(/if \(admin\) \{[\s\S]*listSlabQueue\(\)[\s\S]*<SlabQueue/);
    expect(page).toContain("<SlabInstitutePicker");
  });

  it("still revalidates /slabs after a decision, so the queue refreshes", () => {
    const actions = tsCode("src/lib/slab-actions.ts");
    const fn = actions.slice(actions.indexOf("export async function decideSlabs"));
    expect(fn).toContain('revalidatePath("/slabs")');
  });
});
