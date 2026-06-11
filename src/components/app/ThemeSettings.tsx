"use client";

import { useTransition } from "react";
import { modalToast } from "@/lib/modalToast";
import { useAppTheme, type AppTheme } from "@/components/app/AppThemeProvider";

export function ThemeSettings() {
  const [isPending, startTransition] = useTransition();
  const { theme, saveTheme } = useAppTheme();

  const choose = (next: AppTheme) => {
    startTransition(async () => {
      const res = await saveTheme(next);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao salvar.");
        return;
      }
      modalToast.success("Tema atualizado.");
    });
  };

  return (
    <div className="mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
      <div className="text-sm font-semibold text-[var(--app-text-85)]">Tema</div>
      <div className="mt-1 text-xs text-[var(--app-text-55)]">
        Escolha entre Tema Claro e Tema Escuro.
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => choose("light")}
          disabled={isPending}
          className={[
            "inline-flex h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-semibold",
            theme === "light"
              ? "border-[var(--app-border)] bg-[var(--app-active)] text-[var(--app-text-85)]"
              : "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
          ].join(" ")}
        >
          Tema Claro
        </button>
        <button
          type="button"
          onClick={() => choose("dark")}
          disabled={isPending}
          className={[
            "inline-flex h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-semibold",
            theme === "dark"
              ? "border-[var(--app-border)] bg-[var(--app-active)] text-[var(--app-text-85)]"
              : "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
          ].join(" ")}
        >
          Tema Escuro
        </button>
      </div>
    </div>
  );
}

