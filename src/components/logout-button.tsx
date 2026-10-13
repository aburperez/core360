"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./icons";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Sair"
      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      <Icon name="logout" className="h-5 w-5" />
      <span className="hidden sm:inline">Sair</span>
    </button>
  );
}
