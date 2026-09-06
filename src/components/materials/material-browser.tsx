"use client";

import { useState } from "react";
import { DownloadIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { formatDate } from "@/lib/dates";
import type { Material } from "@/lib/materials";
import {
  MATERIAL_CATEGORIES,
  asDownloadUrl,
  formatFileSize,
  isImage,
} from "@/lib/validation/material";
import { cn } from "@/lib/utils";

/**
 * Browsing the shared library.
 *
 * Filtering happens here rather than on the server: the whole list already
 * arrived, so switching category costs no round trip — which matters on a
 * phone at a school gate. Only the categories actually present get a chip, so
 * a rep is never offered a filter that leads to an empty list.
 *
 * No PDF renderer and no image library. An image shows itself through its
 * signed URL; everything else gets a lucide icon.
 */
export function MaterialBrowser({ materials }: { materials: Material[] }) {
  const [category, setCategory] = useState<string>("All");

  const present = MATERIAL_CATEGORIES.filter((c) =>
    materials.some((m) => m.category === c),
  );
  const shown =
    category === "All"
      ? materials
      : materials.filter((m) => m.category === category);

  if (materials.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No materials yet"
        description="Posters, brochures and announcements shared by your admin will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {present.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["All", ...present].map((option) => (
            <Button
              key={option}
              type="button"
              variant={category === option ? "default" : "outline"}
              className="h-9 shrink-0"
              onClick={() => setCategory(option)}
              aria-pressed={category === option}
            >
              {option}
            </Button>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {shown.map((material) => (
          <li
            key={material.id}
            className="bg-card border-border flex items-start gap-3 rounded-md border p-3"
          >
            <Thumbnail material={material} />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{material.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{material.category}</Badge>
                <span className="text-muted-foreground text-xs">
                  {formatFileSize(material.fileSize)} ·{" "}
                  {formatDate(material.createdAt)}
                </span>
              </div>
              {material.description && (
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                  {material.description}
                </p>
              )}

              {material.url ? (
                <Button asChild variant="outline" className="mt-2 h-9">
                  {/* A signed URL is cross-origin, so `download` alone would be
                      ignored — asDownloadUrl asks storage for an attachment. */}
                  <a
                    href={asDownloadUrl(material.url, material.fileName)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DownloadIcon className="size-4" aria-hidden />
                    Download
                  </a>
                </Button>
              ) : (
                <p className="text-muted-foreground mt-2 text-xs">
                  This file is currently unavailable.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * An image previews itself; a PDF gets an icon. Both sit in the same fixed box
 * so the rows line up regardless of what is in them.
 */
function Thumbnail({ material }: { material: Material }) {
  const box =
    "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md";

  if (isImage(material.fileType) && material.url) {
    return (
      // Plain <img>: no provider image loader, per the portability rule.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={material.url}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(box, "bg-muted object-cover")}
      />
    );
  }

  const Icon = isImage(material.fileType) ? ImageIcon : FileTextIcon;
  return (
    <span className={cn(box, "bg-muted text-muted-foreground")} aria-hidden>
      <Icon className="size-6" />
    </span>
  );
}
