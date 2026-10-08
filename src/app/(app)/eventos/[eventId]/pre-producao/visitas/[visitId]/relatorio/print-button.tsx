"use client";

import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";

/** Abre a impressão do navegador; lá a pessoa escolhe "Salvar como PDF". */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Icon name="download" className="h-5 w-5" /> Salvar em PDF
    </Button>
  );
}
