import { describe, expect, it } from "vitest";
import {
  ACCEPTED_TYPES,
  FILE_INPUT_ACCEPT,
  MATERIAL_CATEGORIES,
  MAX_FILE_BYTES,
  asDownloadUrl,
  fileRejectionReason,
  formatFileSize,
  isAcceptedType,
  isImage,
  isPdf,
  materialFormDataToInput,
  materialSchema,
} from "@/lib/validation/material";

/**
 * The materials library's shared rules — the ones the browser applies before an
 * upload and the server action applies again afterwards.
 *
 * The vocabularies are written out by hand rather than derived from the source,
 * for the same reason as the institute statuses: a test that maps over what it
 * is testing only proves self-consistency. Migration 0012's CHECK constraints
 * carry the same two lists.
 */
const EXPECTED_CATEGORIES = [
  "Poster",
  "Brochure",
  "Fee Structure",
  "Event Letter",
  "Announcement",
  "Other",
];

const EXPECTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const validInput = {
  title: "Spring open day poster",
  category: "Poster",
  description: "",
  file_path: "9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d/poster.png",
  file_name: "poster.png",
  file_type: "image/png",
  file_size: 240_000,
};

describe("the materials vocabulary", () => {
  it("offers exactly the categories migration 0012 accepts", () => {
    expect(MATERIAL_CATEGORIES).toEqual(EXPECTED_CATEGORIES);
  });

  it("accepts exactly the file types migration 0012 accepts", () => {
    expect(ACCEPTED_TYPES).toEqual(EXPECTED_TYPES);
  });

  it("caps files at 5 MiB, the same number as the bucket", () => {
    expect(MAX_FILE_BYTES).toBe(5_242_880);
  });

  it("derives the file input's accept list, so the two cannot drift", () => {
    expect(FILE_INPUT_ACCEPT).toBe(EXPECTED_TYPES.join(","));
  });

  it("splits images from PDFs across every accepted type", () => {
    for (const type of ACCEPTED_TYPES) {
      expect(isAcceptedType(type), type).toBe(true);
      expect(isImage(type) || isPdf(type), type).toBe(true);
      expect(isImage(type) && isPdf(type), type).toBe(false);
    }
  });

  it("calls an unknown type neither image nor PDF", () => {
    expect(isAcceptedType("application/msword")).toBe(false);
    expect(isImage("application/msword")).toBe(false);
    expect(isPdf("application/msword")).toBe(false);
  });
});

describe("fileRejectionReason", () => {
  it("accepts a normal file", () => {
    expect(fileRejectionReason({ type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("accepts a file exactly on the limit", () => {
    expect(
      fileRejectionReason({ type: "image/png", size: MAX_FILE_BYTES }),
    ).toBeNull();
  });

  it("refuses one byte over", () => {
    const reason = fileRejectionReason({
      type: "image/png",
      size: MAX_FILE_BYTES + 1,
    });
    expect(reason).toContain("The limit is 5.0 MB");
  });

  it("refuses an unsupported type before worrying about size", () => {
    expect(
      fileRejectionReason({ type: "application/msword", size: 10 }),
    ).toBe("That file type is not supported. Upload a JPG, PNG, WebP or PDF.");
  });

  it("refuses an empty file", () => {
    expect(fileRejectionReason({ type: "image/png", size: 0 })).toBe(
      "That file appears to be empty.",
    );
  });
});

describe("formatFileSize", () => {
  it("reads sensibly across the range", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(512)).toBe("512 bytes");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
    expect(formatFileSize(MAX_FILE_BYTES)).toBe("5.0 MB");
  });

  it("does not throw on nonsense", () => {
    expect(formatFileSize(Number.NaN)).toBe("0 bytes");
    expect(formatFileSize(-1)).toBe("0 bytes");
  });
});

describe("asDownloadUrl", () => {
  it("appends to a signed URL that already has a query", () => {
    expect(asDownloadUrl("https://x.co/o/a.pdf?token=abc", "Fee sheet.pdf")).toBe(
      "https://x.co/o/a.pdf?token=abc&download=Fee%20sheet.pdf",
    );
  });

  it("starts a query when there is none", () => {
    expect(asDownloadUrl("https://x.co/o/a.pdf", "a.pdf")).toBe(
      "https://x.co/o/a.pdf?download=a.pdf",
    );
  });

  it("escapes a filename that would otherwise break the URL", () => {
    expect(asDownloadUrl("https://x.co/a?t=1", "fees & terms.pdf")).toContain(
      "download=fees%20%26%20terms.pdf",
    );
  });
});

describe("materialSchema", () => {
  it("accepts a well-formed upload", () => {
    expect(materialSchema.safeParse(validInput).success).toBe(true);
  });

  it("turns a blank description into null rather than an empty string", () => {
    const result = materialSchema.safeParse(validInput);
    expect(result.success && result.data.description).toBeNull();
  });

  it("insists on a title", () => {
    const result = materialSchema.safeParse({ ...validInput, title: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Give this material a title.");
    }
  });

  it("refuses a category outside the six", () => {
    expect(
      materialSchema.safeParse({ ...validInput, category: "Newsletter" }).success,
    ).toBe(false);
  });

  it("refuses a file type outside the four", () => {
    expect(
      materialSchema.safeParse({ ...validInput, file_type: "application/zip" })
        .success,
    ).toBe(false);
  });

  it("refuses a size over the cap, even if the browser let it through", () => {
    expect(
      materialSchema.safeParse({ ...validInput, file_size: MAX_FILE_BYTES + 1 })
        .success,
    ).toBe(false);
  });

  it("refuses a row with no stored file behind it", () => {
    expect(
      materialSchema.safeParse({ ...validInput, file_path: "" }).success,
    ).toBe(false);
  });
});

describe("materialFormDataToInput", () => {
  const formData = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  it("reads a complete form", () => {
    const input = materialFormDataToInput(
      formData({
        title: "Fee structure 2026",
        category: "Fee Structure",
        description: "Class 11 and 12",
        file_path: "abc/def.pdf",
        file_name: "fees.pdf",
        file_type: "application/pdf",
        file_size: "51200",
      }),
    );
    expect(input.file_size).toBe(51200);
    expect(materialSchema.safeParse(input).success).toBe(true);
  });

  it("turns a missing or non-numeric size into 0, which the schema rejects", () => {
    const input = materialFormDataToInput(formData({ title: "x" }));
    expect(input.file_size).toBe(0);
    expect(materialSchema.safeParse(input).success).toBe(false);
  });
});
