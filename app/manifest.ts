import type { MetadataRoute } from "next";

/** Lets the app be added to a phone's home screen and open full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Masterfully",
    short_name: "Masterfully",
    description: "Research journal, notes and reading list",
    start_url: "/journal",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#fbfaf7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
