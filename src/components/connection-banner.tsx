"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Avisa claramente quando a conexão cai, em vez de esconder o erro. */
export function ConnectionBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="bg-orange-600 px-4 py-1.5 text-center text-sm font-medium text-white">
      Sem conexão. O que você digitou fica na tela até o sinal voltar.
    </div>
  );
}
