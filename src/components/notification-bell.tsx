"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Sino com o número de avisos não lidos. Atualiza a cada 30 s com a tela aberta. */
export function NotificationBell() {
  const [count, setCount] = useState(0);
  const path = usePathname();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications/unread", { credentials: "same-origin" });
        if (res.ok && alive) setCount((await res.json()).data.count);
      } catch {
        // Sem sinal: mantém o último número.
      }
    };
    load();
    const timer = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [path]);

  const label = count > 0 ? `Avisos: ${count} não lidos` : "Avisos";
  return (
    <Link href="/avisos" aria-label={label} className="relative flex h-11 w-11 items-center justify-center rounded-xl text-xl">
      <span aria-hidden>🔔</span>
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-xs font-bold leading-5 text-accent-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
