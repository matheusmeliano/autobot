"use client";

import { useState } from "react";
import { modalToast } from "@/lib/modalToast";

export function MercadoPagoCheckoutButton(props: {
  plan: "basico" | "pro";
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (props.disabled || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/billing/mercadopago/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: props.plan }),
      });

      const body = (await res.json().catch(() => null)) as
        | { ok?: true; init_point?: string; error?: string }
        | null;

      const url = body?.init_point ?? null;
      if (!res.ok || !body?.ok || !url) {
        modalToast.error(body?.error ?? "Falha ao iniciar checkout.");
        return;
      }

      window.location.href = url;
    } catch {
      modalToast.error("Falha ao iniciar checkout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      disabled={props.disabled || loading}
      className={props.className}
      onClick={onClick}
    >
      {loading ? "Abrindo checkout..." : props.children}
    </button>
  );
}
