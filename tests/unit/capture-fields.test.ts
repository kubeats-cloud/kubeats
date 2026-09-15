import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Live camera only — and the fallback that must survive it.
 *
 * Phase 2 stage 1 removed the "Upload photo" button and its file picker. A
 * photograph is the evidence a visit happened (Rule 12), and an image chosen
 * from a gallery is evidence of nothing in particular: any picture, anywhere,
 * any day. The camera path cannot be — the frame goes from the live stream
 * straight into the stamping canvas.
 *
 * THE TRAP THIS FILE EXISTS FOR. `capture-fields.tsx` mounts a SECOND hidden
 * file input, `capture="environment"`, which opens the device's own camera app
 * when `getUserMedia` cannot open one in the page. It looks exactly like the
 * gallery picker that was just deleted, and the obvious "finish the job" edit
 * is to delete it too. That would mean: on any device where getUserMedia fails,
 * the rep cannot attach a photo at all → Rule 12 blocks the save → they cannot
 * log the visit. A whole class of phone, bricked, to tidy up one input.
 *
 * WHY A SOURCE-LEVEL TEST. Proving this properly needs a DOM: render, click,
 * assert which input was activated. This project has no DOM test environment on
 * purpose — vitest.config.mts documents the split as pure-logic unit tests plus
 * Postgres integration tests. So this asserts the two things that are checkable
 * from Node and that actually prevent the regression, the same bargain
 * `log-visit-form.test.ts` strikes.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const CAPTURE = "src/components/visits/capture-fields.tsx";

describe("the visit photo comes from a camera, not a gallery", () => {
  const source = read(CAPTURE);

  it("offers no gallery picker", () => {
    // The deleted control and its ref. A bare `accept="image/*"` input with no
    // `capture` attribute IS the gallery picker, whatever it is called.
    expect(source).not.toContain("Upload photo");
    expect(source).not.toContain("uploadRef");
    expect(source).not.toContain('id="visit-photo-upload"');
  });

  it("keeps exactly one file input, and it is the native CAMERA", () => {
    const inputs = source.match(/<input\b[^>]*?type="file"/g) ?? [];
    expect(inputs.length, "one file input, not two").toBe(1);
    // capture="environment" is what makes it a camera rather than a picker.
    expect(source).toContain('capture="environment"');
    expect(source).toContain("nativeCameraRef");
  });

  it("still hands over to that camera when the in-page one cannot open", () => {
    // Both routes: the device that has already told us it cannot
    // (cameraUnavailable), and the one that fails when asked (onUnavailable).
    expect(source).toContain("nativeCameraRef.current?.click()");
    expect(source).toContain("onUnavailable");
  });

  it("still opens the in-page camera as the normal path", () => {
    expect(source).toContain("<CameraCapture");
    expect(source).toContain("setCameraOpen(true)");
  });

  it("explains to the next reader why the fallback is not the gallery", () => {
    // The fix is one deletion and the temptation is a second one. A reader who
    // does not know the difference will make it.
    expect(source).toMatch(/NOT be removed|not a gallery|NOT a gallery/i);
    expect(source).toMatch(/Rule 12/);
  });
});
