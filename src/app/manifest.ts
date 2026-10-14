import { type MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nap Tracker",
    short_name: "Naps",
    description: "Track your baby's naps — start, stop, and edit nap times.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0f23",
    theme_color: "#1e1b4b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
