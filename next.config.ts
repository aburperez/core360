import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lê e gera .xlsx (planilha de custos) com o require do Node, sem empacotar.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
