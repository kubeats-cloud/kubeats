import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import type { MaterialCategory, MaterialFileType } from "@/lib/validation/material";

/**
 * Reading the shared library.
 *
 * `materials` is a private bucket, so nothing here hands out a permanent URL.
 * Each file is signed server-side on the caller's own session for a few
 * minutes; the storage policy lets any signed-in user read this bucket, so a
 * signature failing means the object is gone rather than that the caller was
 * refused. No service-role key is involved and none reaches the browser.
 *
 * A row whose object has vanished renders as unavailable rather than as an
 * error: migration 0012 deliberately does not cascade storage objects, so the
 * two can fall out of step and the list has to cope.
 */

/** Long enough to open or save a file, short enough that a leaked link is stale. */
export const MATERIAL_URL_TTL_SECONDS = 300;

export interface Material {
  id: string;
  title: string;
  description: string | null;
  category: MaterialCategory;
  fileName: string;
  fileType: MaterialFileType;
  fileSize: number;
  createdAt: string;
  uploadedBy: string | null;
  /** Null when the stored object could not be signed — treat as unavailable. */
  url: string | null;
}

const COLUMNS =
  "id, title, description, category, file_path, file_name, file_type, file_size, uploaded_by, created_at";

interface Row {
  id: string;
  title: string;
  description: string | null;
  category: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_by: string | null;
  created_at: string;
}

async function signAll(
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return urls;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("materials")
    .createSignedUrls(unique, MATERIAL_URL_TTL_SECONDS);

  if (error) {
    // One failure for the batch says nothing about individual files, so every
    // one reads as unavailable rather than rendering a broken link.
    logError("materials:sign", error);
    return urls;
  }

  for (const entry of data ?? []) {
    if (entry.path && !entry.error && entry.signedUrl) {
      urls.set(entry.path, entry.signedUrl);
    }
  }
  return urls;
}

function toMaterial(row: Row, urls: Map<string, string>): Material {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as MaterialCategory,
    fileName: row.file_name,
    fileType: row.file_type as MaterialFileType,
    fileSize: row.file_size,
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by,
    url: urls.get(row.file_path) ?? null,
  };
}

/**
 * Every material, newest first.
 *
 * Loaded whole and filtered in the browser, the same trade the institute
 * registry makes: a library of a few hundred files is a small payload, and
 * switching category then costs no round trip on a phone.
 */
export async function listMaterials(): Promise<
  { ok: true; materials: Material[] } | { ok: false }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    logError("materials:list", error);
    return { ok: false };
  }

  const rows = (data ?? []) as Row[];
  const urls = await signAll(rows.map((r) => r.file_path));
  return { ok: true, materials: rows.map((row) => toMaterial(row, urls)) };
}

/**
 * What the admin management screen needs: the same list, plus the storage path,
 * which the browse screen has no business knowing.
 */
export interface ManagedMaterial extends Material {
  filePath: string;
}

export async function listMaterialsForAdmin(): Promise<
  { ok: true; materials: ManagedMaterial[] } | { ok: false }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    logError("materials:list-admin", error);
    return { ok: false };
  }

  const rows = (data ?? []) as Row[];
  const urls = await signAll(rows.map((r) => r.file_path));
  return {
    ok: true,
    materials: rows.map((row) => ({
      ...toMaterial(row, urls),
      filePath: row.file_path,
    })),
  };
}
