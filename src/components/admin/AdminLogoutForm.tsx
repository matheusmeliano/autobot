"use client";

import { useCallback } from "react";
import { logoutAction } from "@/app/app/actions";

export function AdminLogoutForm({ className = "" }: { className?: string }) {
  const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    if (window.confirm("Deseja realmente sair?")) return;
    event.preventDefault();
  }, []);

  return (
    <form action={logoutAction} className={className} onSubmit={handleSubmit}>
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
      >
        Sair
      </button>
    </form>
  );
}
