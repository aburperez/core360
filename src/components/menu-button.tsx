"use client";

import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { OPEN_MENU_EVENT } from "./event-nav";

/** ☰ do topo no celular: abre o menu lateral do evento (só dentro de um evento). */
export function MenuButton() {
  const path = usePathname();
  if (!/^\/eventos\/[0-9a-f-]{36}/.test(path)) return null;
  return (
    <button
      type="button"
      aria-label="Abrir menu"
      onClick={() => window.dispatchEvent(new Event(OPEN_MENU_EVENT))}
      className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white transition hover:bg-white/10 lg:hidden"
    >
      <Icon name="menu" />
    </button>
  );
}
