"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";

export type Pin = { id: string; x: number; y: number; n: number; color: string; square?: boolean; label?: string };
export type ViewerHandle = { focus: (x: number, y: number) => void };

type View = { s: number; tx: number; ty: number };

const MAX_ZOOM = 8;
/** Mais que isso de movimento e o toque vira arrastar. */
const TAP_SLOP = 8;

const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * A planta com zoom: pinça e arrasta no celular; roda do mouse e arrasta no
 * computador; botões + − e "ver tudo". Os pinos ficam do mesmo tamanho em
 * qualquer zoom. Um toque sem arrastar escolhe um pino ou, ao marcar, devolve
 * o lugar em % da imagem.
 */
export function PlanViewer({
  src, pins, selectedId, draft, placing, onTap, onSelect, ref,
}: {
  src: string; pins: Pin[]; selectedId: string | null; draft: { x: number; y: number } | null; placing: boolean;
  onTap: (x: number, y: number) => void; onSelect: (id: string) => void; ref?: Ref<ViewerHandle>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0, vh: 800, wide: false });
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });

  // Tamanho natural da imagem.
  useEffect(() => {
    const im = new Image();
    im.onload = () => setNat({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => setFailed(true);
    im.src = src;
    return () => { im.onload = null; im.onerror = null; };
  }, [src]);

  // Largura da caixa (a altura acompanha o formato da planta).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight, vh: window.innerHeight, wide: window.innerWidth >= 1024 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const height = nat && size.w
    ? Math.round(clampNum((size.w * nat.h) / nat.w, 260, size.vh * (size.wide ? 0.72 : 0.6)))
    : 320;
  const fit = nat && size.w ? Math.min(size.w / nat.w, height / nat.h) : 0;
  const baseW = nat ? nat.w * fit : 0;
  const baseH = nat ? nat.h * fit : 0;

  const clamp = useCallback(
    (v: View): View => {
      const s = clampNum(v.s, 1, MAX_ZOOM);
      const w = baseW * s;
      const h = baseH * s;
      return {
        s,
        tx: w <= size.w ? (size.w - w) / 2 : clampNum(v.tx, size.w - w, 0),
        ty: h <= height ? (height - h) / 2 : clampNum(v.ty, height - h, 0),
      };
    },
    [baseW, baseH, size.w, height],
  );

  // Recentraliza quando a caixa ou a imagem mudam.
  const [fitKey, setFitKey] = useState("");
  const key = `${src}|${baseW}|${baseH}|${size.w}|${height}`;
  if (fitKey !== key && baseW > 0) {
    setFitKey(key);
    setView((v) => clamp(fitKey.startsWith(`${src}|`) ? v : { s: 1, tx: 0, ty: 0 }));
  }

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setView((v) => {
        const s = clampNum(v.s * factor, 1, MAX_ZOOM);
        return clamp({ s, tx: px - ((px - v.tx) * s) / v.s, ty: py - ((py - v.ty) * s) / v.s });
      });
    },
    [clamp],
  );

  useImperativeHandle(ref, () => ({
    focus: (x, y) => {
      // No celular o detalhe abre por baixo: o pino fica no terço de cima, e a planta volta para a tela.
      const at = size.wide ? 0.5 : 0.3;
      setView((v) => {
        const s = Math.max(v.s, 2.5);
        return clamp({ s, tx: size.w / 2 - (x / 100) * baseW * s, ty: height * at - (y / 100) * baseH * s });
      });
      const top = box.current?.getBoundingClientRect().top ?? 0;
      if (!size.wide && (top < 60 || top > 160)) window.scrollBy({ top: top - 84, behavior: "smooth" });
    },
  }), [clamp, size.w, size.wide, height, baseW, baseH]);

  // Roda do mouse (precisa de ouvinte não passivo para não rolar a página).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  // Toques: um dedo arrasta, dois dedos fazem pinça (e arrastam juntos).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    moved: boolean; startX: number; startY: number; target: EventTarget | null;
    pinch?: { dist: number; s: number; ix: number; iy: number };
  } | null>(null);

  const local = (x: number, y: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    const v = viewRef.current;
    const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
    gesture.current!.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: v.s, ix: (mid.x - v.tx) / v.s, iy: (mid.y - v.ty) / v.s };
    gesture.current!.moved = true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-controls]")) return;
    box.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, startX: e.clientX, startY: e.clientY, target: e.target };
    } else if (pointers.current.size === 2 && gesture.current) {
      startPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = clampNum((g.pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinch.dist, 1, MAX_ZOOM);
      setView(clamp({ s, tx: mid.x - g.pinch.ix * s, ty: mid.y - g.pinch.iy * s }));
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_SLOP) g.moved = true;
    if (g.moved) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => clamp({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size === 1 && g?.pinch) {
      // Tirou um dedo da pinça: o outro continua arrastando.
      g.pinch = undefined;
      return;
    }
    if (pointers.current.size > 0 || !g) return;
    gesture.current = null;
    if (g.moved || e.type === "pointercancel") return;
    const pin = (g.target as Element | null)?.closest?.("[data-pin]");
    if (pin && !placing) {
      onSelect(pin.getAttribute("data-pin")!);
      return;
    }
    const v = viewRef.current;
    const p = local(e.clientX, e.clientY);
    const x = ((p.x - v.tx) / v.s / baseW) * 100;
    const y = ((p.y - v.ty) / v.s / baseH) * 100;
    if (x >= 0 && x <= 100 && y >= 0 && y <= 100) onTap(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  };

  const center = () => ({ x: size.w / 2, y: height / 2 });

  return (
    <div
      ref={box}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ height }}
      className={cx(
        "relative touch-none select-none overflow-hidden rounded-2xl border border-border bg-[#0b1d29]",
        placing ? "cursor-crosshair ring-2 ring-accent" : "cursor-grab active:cursor-grabbing",
      )}
      aria-label="Planta do evento"
    >
      {failed && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">Não foi possível abrir a planta. Confira a conexão e tente de novo.</p>}
      {!nat && !failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Abrindo a planta…</p>}
      {nat && (
        <div
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{ width: baseW, height: baseH, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full bg-white" />
          {pins.map((p) => (
            <PinMark key={p.id} pin={p} scale={view.s} selected={p.id === selectedId} />
          ))}
          {draft && <PinMark pin={{ id: "draft", x: draft.x, y: draft.y, n: 0, color: "#00E5ED" }} scale={view.s} selected draft />}
        </div>
      )}
      <div data-controls className="absolute bottom-2 right-2 flex flex-col gap-1.5">
        <ZoomButton label="Aproximar" icon="zoomIn" onClick={() => zoomAt(1.6, center().x, center().y)} />
        <ZoomButton label="Afastar" icon="zoomOut" onClick={() => zoomAt(1 / 1.6, center().x, center().y)} />
        <ZoomButton label="Ver a planta toda" icon="fit" onClick={() => setView(clamp({ s: 1, tx: 0, ty: 0 }))} />
      </div>
    </div>
  );
}

function ZoomButton({ label, icon, onClick }: { label: string; icon: "zoomIn" | "zoomOut" | "fit"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy/85 text-white shadow-lg ring-1 ring-white/15 transition hover:bg-brand-navy"
    >
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

/** Pino: cabeça redonda para montagem, quadrada para finalização; o número liga à lista. */
function PinMark({ pin, scale, selected, draft }: { pin: Pin; scale: number; selected: boolean; draft?: boolean }) {
  return (
    <span
      data-pin={draft ? undefined : pin.id}
      role={draft ? undefined : "button"}
      aria-label={pin.label}
      className={cx("absolute", draft ? "pointer-events-none" : "cursor-pointer", selected ? "z-20" : "z-10")}
      style={{
        left: `${pin.x}%`, top: `${pin.y}%`,
        transform: `translate(-50%, -100%) scale(${(selected ? 1.25 : 1) / scale})`,
        transformOrigin: "50% 100%",
      }}
    >
      <svg width="28" height="36" viewBox="0 0 34 44" className="drop-shadow-[0_2px_3px_rgba(0,0,0,0.6)]">
        {pin.square ? (
          <path d="M17 43 L10 31 H6 a4 4 0 0 1 -4 -4 V6 a4 4 0 0 1 4 -4 H28 a4 4 0 0 1 4 4 V27 a4 4 0 0 1 -4 4 H24 Z" fill={pin.color} stroke={selected ? "#00E5ED" : "#043246"} strokeWidth={selected ? 3 : 2} />
        ) : (
          <path d="M17 43 C17 43 2 27 2 16 A15 15 0 1 1 32 16 C32 27 17 43 17 43 Z" fill={pin.color} stroke={selected ? "#00E5ED" : "#043246"} strokeWidth={selected ? 3 : 2} />
        )}
        <text x="17" y={pin.square ? 21 : 21} textAnchor="middle" fontSize="13" fontWeight="700" fill={draft ? "#043246" : "#fff"} fontFamily="system-ui, sans-serif">
          {draft ? "+" : pin.n}
        </text>
      </svg>
    </span>
  );
}
