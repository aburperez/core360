"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { ringColor } from "@/components/panel";
import { buttonClass, cx } from "@/components/ui";

export type BrowserEvent = {
  id: string; name: string; client: string; place: string | null; dates: string; status: string; stage: "pre" | "campo" | "fim";
  role: string | null; type: string | null; audience: string | null; description: string | null;
  priorities: { text: string; href: string; tone: "red" | "amber" }[];
};

const STAGE_TAG = { pre: { label: "PRÉ", color: "#8b5cf6" }, campo: { label: "CAMPO", color: "#00a5ad" }, fim: { label: "FIM", color: "#64748b" } };

/** Número estável a partir do id, para a cor da capa não mudar entre visitas. */
function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Capa do evento: degradê na cor do evento com os anéis do 360 e as iniciais. */
function Cover({ e, big }: { e: BrowserEvent; big?: boolean }) {
  const c = ringColor(hash(e.id));
  const initials = e.name.split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span className="relative block h-full w-full overflow-hidden" style={{ background: `linear-gradient(135deg, ${c} 0%, #043246 78%)` }}>
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMaxYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
        {[22, 38, 54, 70].map((r, i) => (
          <circle key={r} cx="168" cy="96" r={r} fill="none" stroke="#fff" strokeOpacity={0.16 - i * 0.03} strokeWidth="5" strokeDasharray={i % 2 ? "2 7" : undefined} />
        ))}
      </svg>
      <span className={cx("absolute left-3 top-2 font-black tracking-tight text-white/90", big ? "text-5xl" : "text-3xl")}>{initials}</span>
    </span>
  );
}

/**
 * Meus eventos em grade, como pastas: capa, nome, cliente e data. No
 * computador um clique seleciona e mostra os detalhes à direita (dois cliques
 * ou "Abrir evento" entram); no celular o toque já abre o evento.
 */
export function EventBrowser({ events }: { events: BrowserEvent[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(events[0]?.id ?? null);
  const selected = events.find((e) => e.id === selectedId) ?? events[0];
  if (!selected) return null;

  return (
    <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <ul className="grid min-w-0 content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {events.map((e) => {
          const tag = STAGE_TAG[e.stage];
          const urgent = e.priorities.some((p) => p.tone === "red");
          return (
            <li key={e.id}>
              <Link
                href={`/eventos/${e.id}`}
                onClick={(ev) => {
                  if (window.matchMedia("(min-width: 1024px)").matches) {
                    ev.preventDefault();
                    setSelectedId(e.id);
                  }
                }}
                onDoubleClick={() => router.push(`/eventos/${e.id}`)}
                className={cx(
                  "flex flex-col overflow-hidden rounded-xl border bg-surface transition hover:border-primary/70",
                  selected.id === e.id ? "lg:border-primary lg:ring-1 lg:ring-primary" : "border-border",
                )}
              >
                <span className="relative block h-28">
                  <Cover e={e} />
                  <span className="absolute bottom-1.5 left-1.5 rounded px-1.5 text-[10px] font-bold text-white" style={{ background: tag.color }}>{tag.label}</span>
                </span>
                <span className="flex items-start gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{e.name}</span>
                    <span className="block truncate text-xs text-muted">{e.dates}</span>
                  </span>
                  {e.priorities.length > 0 && <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", urgent ? "bg-red-500" : "bg-amber-400")} title="Tem prioridade hoje" />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <aside className="hidden lg:block">
        <div className="sticky top-20 rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold"><Icon name="info" className="h-5 w-5 text-primary" /> Detalhes do evento</p>
          <div className="mt-3 h-36 overflow-hidden rounded-lg"><Cover e={selected} big /></div>
          <p className="mt-3 text-center font-bold">{selected.name}</p>
          <p className="text-center text-sm text-muted">{selected.status}{selected.role ? ` · você é ${selected.role}` : ""}</p>
          <dl className="mt-3 divide-y divide-border text-sm">
            <Row label="Cliente">{selected.client}</Row>
            <Row label="Datas e local">{selected.dates}{selected.place ? ` · ${selected.place}` : ""}</Row>
            {(selected.type || selected.audience) && <Row label="Tipo e público">{[selected.type, selected.audience].filter(Boolean).join(" · ")}</Row>}
            {selected.description && <Row label="Descrição"><span className="line-clamp-3">{selected.description}</span></Row>}
            {selected.priorities.length > 0 && (
              <div className="py-2.5">
                <dt className="text-xs font-bold">Prioridades de hoje</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {selected.priorities.map((p) => (
                    <Link
                      key={p.text}
                      href={p.href}
                      className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", p.tone === "red" ? "bg-red-500/15 text-red-300" : "bg-amber-400/15 text-amber-200")}
                    >
                      {p.text}
                    </Link>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <Link href={`/eventos/${selected.id}`} className={buttonClass("primary", "mt-2 w-full")}>
            Abrir evento <Icon name="chevron" className="h-5 w-5" />
          </Link>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs font-bold">{label}</dt>
      <dd className="mt-0.5 break-words text-muted">{children}</dd>
    </div>
  );
}
