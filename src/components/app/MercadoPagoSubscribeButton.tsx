"use client";

import { useState } from "react";
import { toast } from "sonner";

export function MercadoPagoSubscribeButton(props: {
  plan: "basico" | "pro";
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (loading || props.disabled) return;
    setLoading(true);
    try {
      const res = await fetch("/api/billing/mercadopago/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: props.plan }),
      });
      const data = (await res.json().catch(() => null)) as
        | { init_point?: string; error?: string }
        | null;

      if (!res.ok || !data?.init_point) {
        toast.error(
          data?.error ??
            "Falha ao iniciar pagamento. Verifique configuração do Mercado Pago na Vercel e a migration de pagamentos no Supabase.",
        );
        return;
      }

      window.location.href = data.init_point;
    } catch {
      toast.error("Falha ao iniciar pagamento.");
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
      {props.children}
    </button>
  );
}
