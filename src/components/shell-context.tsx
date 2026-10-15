"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { NavProps } from "./event-nav";

/**
 * O que a moldura do computador (estilo Protheus) mostra em toda tela do
 * evento: cliente, evento, pessoa e perfil no topo e na barra de status, e as
 * permissões para montar o menu em árvore. Fora de um evento não há moldura.
 */
export type EventShell = {
  eventName: string;
  clientName: string;
  userName: string;
  userEmail: string;
  roleLabel: string;
  nav: NavProps;
};

const ShellContext = createContext<EventShell | null>(null);

export function EventShellProvider({ value, children }: { value: EventShell; children: ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useEventShell() {
  return useContext(ShellContext);
}
