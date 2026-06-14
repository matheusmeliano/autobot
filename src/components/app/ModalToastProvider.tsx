"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { resolveModalConfirm, type ModalToastVariant } from "@/lib/modalToast";

type QueueItem = {
  id: string;
  variant: ModalToastVariant;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
};

const STANDARD_BUTTON_CLASS =
  "border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100";

function variantMeta(variant: ModalToastVariant) {
  if (variant === "success") {
    return {
      icon: CheckCircle2,
      accent: "border-emerald-500/35 bg-emerald-500/15 text-emerald-800",
      iconColor: "text-emerald-600",
      button: STANDARD_BUTTON_CLASS,
    };
  }
  if (variant === "error") {
    return {
      icon: XCircle,
      accent: "border-rose-500/35 bg-rose-500/15 text-rose-800",
      iconColor: "text-rose-600",
      button: STANDARD_BUTTON_CLASS,
    };
  }
  if (variant === "warning") {
    return {
      icon: AlertTriangle,
      accent: "border-amber-500/35 bg-amber-500/15 text-amber-800",
      iconColor: "text-amber-600",
      button: STANDARD_BUTTON_CLASS,
    };
  }
  if (variant === "confirm") {
    return {
      icon: AlertTriangle,
      accent: "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)]",
      iconColor: "text-[var(--app-text-70)]",
      button: STANDARD_BUTTON_CLASS,
    };
  }
  return {
    icon: Info,
    accent: "border-indigo-500/35 bg-indigo-500/15 text-indigo-800",
    iconColor: "text-indigo-600",
    button: STANDARD_BUTTON_CLASS,
  };
}

export function ModalToastProvider() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const active = queue[0] ?? null;
  const meta = useMemo(() => (active ? variantMeta(active.variant) : null), [active]);

  useEffect(() => {
    const onMessage = (e: Event) => {
      const ce = e as CustomEvent<QueueItem>;
      const item = ce.detail;
      if (!item?.id) return;
      setQueue((prev) => [...prev, item]);
    };
    window.addEventListener("autobot:modal-toast", onMessage as EventListener);
    return () => window.removeEventListener("autobot:modal-toast", onMessage as EventListener);
  }, []);

  const close = (result?: boolean) => {
    if (!active) return;
    if (active.variant === "confirm") resolveModalConfirm(active.id, Boolean(result));
    setQueue((prev) => prev.slice(1));
  };

  return (
    <AppModal open={Boolean(active)} onClose={() => close(false)} size="md" zIndexClass="z-[500]">
      {active && meta ? (
        <div>
          <div className="flex items-start gap-3">
            <div
              className={[
                "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                meta.accent,
              ].join(" ")}
            >
              <meta.icon className={["h-5 w-5", meta.iconColor].join(" ")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold tracking-tight text-[var(--app-text-85)]">
                {active.title ?? "Aviso"}
              </div>
              <div className="mt-1 text-sm text-[var(--app-text-70)]">{active.message}</div>
            </div>
          </div>

          {active.variant === "confirm" ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
              >
                {active.cancelText ?? "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={["inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold", meta.button].join(" ")}
              >
                {active.confirmText ?? "Confirmar"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => close()}
              className={["mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold", meta.button].join(" ")}
            >
              OK
            </button>
          )}
        </div>
      ) : null}
    </AppModal>
  );
}
