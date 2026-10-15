"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandWordmark } from "./brand";
import { Icon, type IconName } from "./icons";
import { buildNav, type Item, type MenuGroup, type NavProps } from "./event-nav";
import { useEventShell } from "./shell-context";
import { cx } from "./ui";

/*
 * Moldura do computador no estilo Protheus (TOTVS), só em telas largas (lg) e
 * só dentro de um evento: menu em árvore fixo à esquerda (Atualizações,
 * Consultas, Relatórios, Miscelânea), troca de módulo no topo, abas das telas
 * abertas e barra de status embaixo. No celular nada disso aparece: fica o
 * layout de pastas, com ☰ e barra de baixo.
 */

/** Largura da árvore. O conteúdo do evento recua o mesmo tanto (lg:pl-menu no layout). */
export const MENU_WIDTH = "w-[264px]";

export type Module = { code: "CAM" | "PRE" | "CLI"; label: string; home: string; items: Item[] };

/** Módulo em que a pessoa está agora e os que ela pode abrir. */
export function modulesFor(nav: NavProps, path: string) {
  const { base, pre, inPre, preItems, items, clientItems } = buildNav(nav, path);
  const field: Module = { code: "CAM", label: "Gestão de campo", home: base, items };
  const preMod: Module = { code: "PRE", label: "Pré-produção", home: pre, items: preItems };
  if (clientItems) {
    const cli: Module = { code: "CLI", label: "Acompanhamento", home: base, items: clientItems };
    return { current: cli, all: [cli] };
  }
  const all = [...(nav.canUseField ? [field] : []), ...(nav.canUsePre ? [preMod] : [])];
  const current = (inPre && nav.canUsePre) || !nav.canUseField ? preMod : field;
  return { current, all };
}

const GROUP_LABEL: Record<MenuGroup, string> = { cad: "Cadastros", mov: "Movimentos", con: "Consultas", rel: "Relatórios" };

/** Caminho no menu da página aberta, como "Atualizações › Cadastros › Fornecedores". */
export function menuPath(item: Item) {
  return item.group === "cad" || item.group === "mov" ? ["Atualizações", GROUP_LABEL[item.group], item.label] : [GROUP_LABEL[item.group], item.label];
}

const FAV_KEY = "core360:favoritos";
const RECENT_KEY = "core360:recentes";

const STORE_EVENT = "core360:lista";

function storageOf(kind: "local" | "session") {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function writeList<T>(kind: "local" | "session", key: string, list: T[]) {
  try {
    storageOf(kind)?.setItem(key, JSON.stringify(list));
  } catch {
    // Navegador sem armazenamento: só perde a lembrança.
  }
  window.dispatchEvent(new Event(STORE_EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(STORE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(STORE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Lista lembrada no navegador (favoritos, recentes, abas). Só conforto: pode voltar vazia. */
function useStoredList<T>(kind: "local" | "session", key: string): T[] {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return storageOf(kind)?.getItem(key) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  return useMemo(() => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  }, [raw]);
}

function readNow<T>(kind: "local" | "session", key: string): T[] {
  try {
    const v = JSON.parse(storageOf(kind)?.getItem(key) ?? "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Árvore fixa à esquerda, com pesquisa, favoritos e recentes. */
export function DesktopMenu() {
  const shell = useEventShell();
  const path = usePathname();
  const [tab, setTab] = useState<"menu" | "fav" | "rec">("menu");
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const favs = useStoredList<string>("local", FAV_KEY);
  const recent = useStoredList<string>("local", RECENT_KEY);
  const search = useRef<HTMLInputElement>(null);

  // Recentes: as últimas telas do menu abertas (por endereço do item).
  useEffect(() => {
    if (!shell) return;
    const hit = modulesFor(shell.nav, path).current.items.find((it) => it.active);
    if (!hit) return;
    const list = readNow<string>("local", RECENT_KEY);
    if (list[0] === hit.href) return;
    writeList("local", RECENT_KEY, [hit.href, ...list.filter((h) => h !== hit.href)].slice(0, 8));
  }, [shell, path]);
  // Ctrl+M leva à pesquisa do menu, como no Protheus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setTab("menu");
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!shell) return null;
  const { nav } = shell;
  const { current } = modulesFor(nav, path);
  const all = current.items.filter((it) => !it.primary);
  const create = current.code === "CAM" ? current.items.find((it) => it.primary) : undefined;
  const q = query.trim().toLocaleLowerCase("pt-BR");
  const shown = q ? all.filter((it) => it.label.toLocaleLowerCase("pt-BR").includes(q)) : all;
  const toggleFav = (href: string) => {
    const next = favs.includes(href) ? favs.filter((h) => h !== href) : [...favs, href];
    writeList("local", FAV_KEY, next);
  };
  const toggle = (key: string) => setClosed((c) => ({ ...c, [key]: !c[key] }));
  const leaf = (it: Item, depth: number) => (
    <MenuLeaf key={it.href} item={it} depth={depth} fav={favs.includes(it.href)} onFav={() => toggleFav(it.href)} />
  );
  const by = (g: MenuGroup) => shown.filter((it) => it.group === g);

  return (
    <aside
      aria-label="Menu do módulo"
      className={cx(MENU_WIDTH, "fixed bottom-6 left-0 top-0 z-30 hidden flex-col border-r border-border bg-surface print:hidden lg:flex")}
    >
      <Link href={current.home} aria-label="Início do módulo" className="flex h-11 shrink-0 items-center bg-brand-navy px-4 shadow-[0_1px_0_rgba(255,255,255,0.06)]">
        <BrandWordmark className="h-[18px] w-auto" />
      </Link>
      <label className="mx-3 mt-3 flex h-8 items-center gap-2 rounded-sm border border-border bg-background px-2 text-xs text-muted focus-within:border-primary">
        <Icon name="search" className="h-3.5 w-3.5 shrink-0" />
        <input
          ref={search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setTab("menu");
          }}
          placeholder="Pesquisar no menu (Ctrl+M)"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted"
        />
      </label>
      <div role="tablist" className="mx-3 mt-2 flex border-b border-border text-xs">
        {([["menu", "Menu"], ["fav", "Favoritos"], ["rec", "Recentes"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("-mb-px border-b-2 px-2.5 py-1.5 transition", tab === k ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      {create && (
        <Link
          href={create.href}
          className="mx-3 mt-3 flex h-8 items-center justify-center gap-1.5 rounded-sm bg-accent text-[13px] font-bold text-accent-foreground transition hover:brightness-110"
        >
          <Icon name="plus" className="h-4 w-4" /> Novo chamado
        </Link>
      )}
      <nav className="mt-2 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 text-[13px]">
        {tab === "menu" && (
          <>
            {(by("cad").length > 0 || by("mov").length > 0) && (
              <Branch label="Atualizações" open={!closed.atu || !!q} onToggle={() => toggle("atu")}>
                {by("cad").length > 0 && (
                  <Branch label="Cadastros" depth={1} open={!closed.cad || !!q} onToggle={() => toggle("cad")}>
                    {by("cad").map((it) => leaf(it, 2))}
                  </Branch>
                )}
                {by("mov").length > 0 && (
                  <Branch label="Movimentos" depth={1} open={!closed.mov || !!q} onToggle={() => toggle("mov")}>
                    {by("mov").map((it) => leaf(it, 2))}
                  </Branch>
                )}
              </Branch>
            )}
            {(["con", "rel"] as const).map((g) =>
              by(g).length > 0 ? (
                <Branch key={g} label={GROUP_LABEL[g]} open={!closed[g] || !!q} onToggle={() => toggle(g)}>
                  {by(g).map((it) => leaf(it, 1))}
                </Branch>
              ) : null,
            )}
            {!q && (
              <Branch label="Miscelânea" open={!closed.misc} onToggle={() => toggle("misc")}>
                <MiscLeaf href="/avisos" icon="bell" label="Avisos e WhatsApp" />
                {nav.canSwitchEvent && <MiscLeaf href="/eventos?todos=1" icon="swap" label="Trocar de evento" />}
              </Branch>
            )}
            {q && shown.length === 0 && <p className="px-3 py-4 text-xs text-muted">Nada no menu com “{query}”.</p>}
          </>
        )}
        {tab === "fav" && (
          <FlatList items={all.filter((it) => favs.includes(it.href))} favs={favs} onFav={toggleFav} empty="Clique na estrela ao lado de uma tela do menu para ela ficar aqui." />
        )}
        {tab === "rec" && (
          <FlatList
            items={recent.map((h) => all.find((it) => it.href === h)).filter((it): it is Item => !!it)}
            favs={favs}
            onFav={toggleFav}
            empty="As telas que você abrir aparecem aqui."
          />
        )}
      </nav>
      <div className="border-t border-border px-4 py-2 text-[11px] text-muted">CORE 360 · {current.label}</div>
    </aside>
  );
}

function Branch({ label, depth = 0, open, onToggle, children }: { label: string; depth?: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ paddingLeft: 6 + depth * 16 }}
        className="flex w-full items-center gap-1.5 rounded-sm py-1.5 pr-2 text-left font-semibold text-foreground hover:bg-white/5"
      >
        <span className="w-3 text-[9px] text-muted">{open ? "▼" : "▶"}</span>
        <FolderGlyph />
        {label}
      </button>
      {open && children}
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function MenuLeaf({ item, depth, fav, onFav }: { item: Item; depth: number; fav: boolean; onFav: () => void }) {
  return (
    <div className="group relative">
      <Link
        href={item.href}
        aria-current={item.active ? "page" : undefined}
        style={{ paddingLeft: 10 + depth * 16 }}
        className={cx(
          "flex items-center gap-2 rounded-sm py-1 pr-7 transition",
          item.active ? "bg-primary/15 text-white shadow-[inset_3px_0_0_var(--primary)]" : "text-white/80 hover:bg-white/5 hover:text-white",
        )}
      >
        <Icon name={item.icon} className="h-[15px] w-[15px] shrink-0 text-primary/85" />
        <span className="truncate">{item.label}</span>
      </Link>
      <button
        type="button"
        onClick={onFav}
        aria-label={fav ? `Tirar ${item.label} dos favoritos` : `Pôr ${item.label} nos favoritos`}
        className={cx("absolute right-1 top-1/2 -translate-y-1/2 px-1 text-xs transition", fav ? "text-amber-300" : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100")}
      >
        {fav ? "★" : "☆"}
      </button>
    </div>
  );
}

function MiscLeaf({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link href={href} style={{ paddingLeft: 26 }} className="flex items-center gap-2 rounded-sm py-1 pr-2 text-white/80 transition hover:bg-white/5 hover:text-white">
      <Icon name={icon} className="h-[15px] w-[15px] shrink-0 text-primary/85" />
      {label}
    </Link>
  );
}

function FlatList({ items, favs, onFav, empty }: { items: Item[]; favs: string[]; onFav: (href: string) => void; empty: string }) {
  if (items.length === 0) return <p className="px-3 py-4 text-xs leading-relaxed text-muted">{empty}</p>;
  return <>{items.map((it) => <MenuLeaf key={it.href} item={it} depth={0} fav={favs.includes(it.href)} onFav={() => onFav(it.href)} />)}</>;
}

/** Nome do módulo no topo; clicando, troca de módulo sem sair do evento. */
export function ModuleSwitcher() {
  const shell = useEventShell();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!shell) return null;
  const { current, all } = modulesFor(shell.nav, path);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 items-center gap-2 rounded-sm px-2 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        {current.label}
        <span className="text-xs font-normal text-white/60">{current.code}</span>
        <span className="text-[10px] text-white/60">▼</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-64 border border-border bg-surface py-1 text-[13px] shadow-2xl">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Trocar módulo</p>
          {all.map((m) => (
            <Link
              key={m.code}
              role="menuitem"
              href={m.home}
              className={cx("flex items-center gap-2 px-3 py-2 transition hover:bg-white/5", m.code === current.code && "bg-primary/15 text-white")}
            >
              <span className="w-8 text-xs text-muted">{m.code}</span>
              {m.label}
            </Link>
          ))}
          {shell.nav.canSwitchEvent && (
            <>
              <div className="my-1 border-t border-border" />
              <Link role="menuitem" href="/eventos?todos=1" className="flex items-center gap-2 px-3 py-2 transition hover:bg-white/5">
                <Icon name="swap" className="h-4 w-4 text-muted" /> Trocar de evento
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Cliente, evento, data base e pessoa, à direita do topo. */
export function HeaderInfo() {
  const shell = useEventShell();
  const today = useToday();
  if (!shell) return null;
  return (
    <div className="hidden min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap text-xs text-white/60 xl:flex">
      <span className="truncate">
        Cliente <b className="font-semibold text-white">{shell.clientName}</b>
      </span>
      <span className="truncate">
        Evento <b className="font-semibold text-white">{shell.eventName}</b>
      </span>
      {today && (
        <span>
          Data base <b className="font-semibold text-white">{today}</b>
        </span>
      )}
      <b className="font-semibold text-white">{shell.userName}</b>
    </div>
  );
}

function useToday(withTime = false) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleString("pt-BR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }),
      );
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [withTime]);
  return now;
}

type OpenTab = { href: string; title: string };
const tabsKey = (eventId: string) => `core360:abas:${eventId}`;

/**
 * Abas das telas abertas, como as rotinas do Protheus: cada tela visitada vira
 * uma aba (até 8) e dá para voltar a ela com um clique ou fechá-la no ✕.
 * “Início” é a tela inicial do módulo e não fecha.
 */
export function OpenTabs({ title }: { title: string }) {
  const shell = useEventShell();
  const path = usePathname();
  const router = useRouter();
  const home = shell ? modulesFor(shell.nav, path).current.home : "";
  const eventId = shell?.nav.eventId ?? "";
  const tabs = useStoredList<OpenTab>("session", tabsKey(eventId));

  useEffect(() => {
    if (!eventId || path === home) return;
    const list = readNow<OpenTab>("session", tabsKey(eventId));
    const i = list.findIndex((t) => t.href === path);
    if (i >= 0 && list[i].title === title) return;
    const next = i >= 0 ? list.map((t) => (t.href === path ? { href: path, title } : t)) : [...list, { href: path, title }].slice(-8);
    writeList("session", tabsKey(eventId), next);
  }, [eventId, path, home, title]);

  if (!shell) return null;
  const close = (href: string) => {
    const next = tabs.filter((t) => t.href !== href);
    writeList("session", tabsKey(eventId), next);
    if (href === path) router.push(next.at(-1)?.href ?? home);
  };
  return (
    <div className="hidden h-8 items-end gap-0.5 border-b border-border bg-surface pl-2 print:hidden lg:flex">
      <TabLink href={home} active={path === home} label="Início" />
      {tabs.map((t) => (
        <TabLink key={t.href} href={t.href} active={t.href === path} label={t.title} onClose={() => close(t.href)} />
      ))}
    </div>
  );
}

function TabLink({ href, active, label, onClose }: { href: string; active: boolean; label: string; onClose?: () => void }) {
  return (
    <div
      className={cx(
        "flex h-7 max-w-56 items-center gap-2 rounded-t-sm border border-b-0 px-3 text-xs",
        active ? "relative top-px border-border bg-background font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground",
      )}
    >
      <Link href={href} aria-current={active ? "page" : undefined} className="truncate">
        {label}
      </Link>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={`Fechar ${label}`} className="text-[11px] text-muted hover:text-foreground">
          ✕
        </button>
      )}
    </div>
  );
}

/** Onde a tela fica no menu, ao lado do título. */
export function MenuCrumb() {
  const shell = useEventShell();
  const path = usePathname();
  if (!shell) return null;
  const hit = modulesFor(shell.nav, path).current.items.find((it) => it.active);
  if (!hit) return null;
  return <span className="hidden truncate text-xs text-muted lg:inline">{menuPath(hit).join(" › ")}</span>;
}

/** Barra de status do rodapé, como a do Protheus. */
export function StatusBar() {
  const shell = useEventShell();
  const path = usePathname();
  const now = useToday(true);
  if (!shell) return null;
  const { current } = modulesFor(shell.nav, path);
  const cell = "flex h-full items-center gap-1 border-r border-border px-3";
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 hidden h-6 items-center bg-[#011620] text-[11px] text-muted print:hidden lg:flex">
      <span className={cell}>CORE 360</span>
      <span className={cell}>
        Cliente <b className="font-semibold text-foreground/85">{shell.clientName}</b>
      </span>
      <span className={cell}>
        Evento <b className="font-semibold text-foreground/85">{shell.eventName}</b>
      </span>
      <span className={cell}>
        Usuário <b className="font-semibold text-foreground/85">{shell.userEmail}</b>
      </span>
      <span className={cell}>
        Módulo <b className="font-semibold text-foreground/85">{current.code}</b>
      </span>
      <span className={cell}>
        Perfil <b className="font-semibold text-foreground/85">{shell.roleLabel}</b>
      </span>
      {now && <span className="ml-auto flex h-full items-center border-l border-border px-3">{now}</span>}
    </footer>
  );
}
