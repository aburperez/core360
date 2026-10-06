import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CORE 360 — Gestão de Campo",
    short_name: "CORE 360",
    description: "Ocorrências, equipes e SLA de eventos.",
    start_url: "/eventos",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#1f3a8a",
    lang: "pt-BR",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
