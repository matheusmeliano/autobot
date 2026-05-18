"use client";

import { useState } from "react";
import { modalToast } from "@/lib/modalToast";

export function MercadoPagoCheckoutButton(props: {
  plan: "basico" | "pro" | "vitalicio";
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (props.disabled || loading) return;
    setLoading(true);
    try {
      const a = document.createElement("a");
      a.href = `/api/billing/mercadopago/checkout?plan=${encodeURIComponent(props.plan)}`;
      a.target = "_blank";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      if (opened && !opened.closed) opened.close();
      modalToast.error("Falha ao iniciar checkout.");
    } finally {
      setLoading(false);
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
