import type { MetadataRoute } from "next";

/**
 * The PWA manifest, so a rep who adds KUbeats to their home screen gets the
 * flame rather than a screenshot of the page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KUbeats — For a smarter KU",
    short_name: "KUbeats",
    description: "Field reporting for the education sales team.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#c0341c",
    icons: [
      { src: "/brand/kubeats-mark.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
    ],
  };
}
