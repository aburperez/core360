import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CORE 360 — Gestão de Campo",
    short_name: "CORE 360",
    description: "Ocorrências, equipes e SLA de eventos.",
    start_url: "/eventos",
    display: "standalone",
    background_color: "#043246",
    theme_color: "#043246",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
