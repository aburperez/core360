"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-xl px-3 py-2 text-sm text-white/80"
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      Sair
    </button>
  );
}
