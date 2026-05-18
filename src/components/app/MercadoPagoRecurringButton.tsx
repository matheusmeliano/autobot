"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { loadMercadoPagoSdk } from "@/lib/mercadopago-sdk";

export function MercadoPagoRecurringButton(props: {
  plan: "basico" | "pro";
  amount: number;
  userEmail?: string | null;
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? "";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const controllerRef = useRef<any>(null);

  const ids = useMemo(() => {
    const suffix = `${props.plan}-${Math.random().toString(16).slice(2)}`;
    return {
      brick: `mp-recurring-${suffix}`,
    };
  }, [props.plan]);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setLoading(false);
      try {
        controllerRef.current?.unmount?.();
      } catch {}
      controllerRef.current = null;
      return;
    }

    if (!publicKey) {
      toast.error(
        "Configuração incompleta. Defina NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY na Vercel.",
      );
      setOpen(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        setReady(false);
        await loadMercadoPagoSdk();
        if (cancelled) return;

        const containerId = ids.brick;
        for (let i = 0; i < 20; i++) {
          if (cancelled) return;
          if (document.getElementById(containerId)) break;
          await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
        }
        if (cancelled) return;
        if (!document.getElementById(containerId)) throw new Error("Brick root missing");

        const w = window as any;
        if (!w?.MercadoPago) throw new Error("SDK missing");

        const mp = new w.MercadoPago(publicKey, { locale: "pt-BR" });
        const bricksBuilder = mp.bricks();

        controllerRef.current = await bricksBuilder.create("cardPayment", containerId, {
          initialization: {
            amount: props.amount,
            payer: props.userEmail ? { email: props.userEmail } : undefined,
          },
          customization: {
            paymentMethods: {
              minInstallments: 1,
              maxInstallments: 1,
              types: {
                excluded: ["debit_card", "prepaid_card"],
              },
            },
            visual: {
              hideFormTitle: true,
              hidePaymentButton: true,
              style: {
                theme: "dark",
                customVariables: {
                  textPrimaryColor: "#ffffff",
                  textSecondaryColor: "rgba(255,255,255,0.65)",
                  inputBackgroundColor: "rgba(255,255,255,0.04)",
                  formBackgroundColor: "transparent",
                  baseColor: "#ffffff",
                  outlinePrimaryColor: "rgba(255,255,255,0.18)",
                  outlineSecondaryColor: "rgba(255,255,255,0.10)",
                  buttonTextColor: "#000000",
                  borderRadiusMedium: "16px",
                },
              },
            },
          },
          callbacks: {
            onReady: () => {
              setReady(true);
            },
            onError: () => {
              setReady(false);
              toast.error("Falha ao carregar o formulário do cartão.");
            },
          },
        });
      } catch {
        toast.error("Falha ao carregar o Mercado Pago.");
        setOpen(false);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [open, publicKey, ids, props.amount]);

  async function confirm() {
    if (loading) return;
    if (!controllerRef.current?.getFormData) {
      toast.error("Formulário ainda não está pronto.");
      return;
    }

    setLoading(true);
    try {
      const formData = await controllerRef.current.getFormData();
      const token = formData?.token ?? null;
      if (!token) {
        toast.error("Não foi possível validar o cartão.");
        return;
      }

      const res = await fetch("/api/billing/mercadopago/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: props.plan,
          card_token_id: token,
        }),
      });

      const body = (await res.json().catch(() => null)) as
        | { ok?: true; error?: string }
        | null;

      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Falha ao iniciar assinatura.");
        return;
      }

      toast.success("Assinatura mensal criada. Pode levar alguns minutos para ativar.");
      setOpen(false);
      window.location.reload();
    } catch {
      toast.error("Falha ao iniciar assinatura.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={props.disabled || loading}
        className={props.className}
        onClick={() => setOpen(true)}
      >
        {props.children}
      </button>

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        zIndexClass="z-[60]"
        size="lg"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
              ASSINATURA
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight">
              Cartão de crédito (mensal)
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06]"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 text-sm text-white/60">
          Sua assinatura será cobrada automaticamente todo mês.
        </div>
        <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          Alguns bancos exigem que o cartão esteja habilitado para compras online e cobranças
          recorrentes. Se falhar, tente outro cartão ou libere no app do banco.
        </div>

        <div
          id={ids.brick}
          className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          style={{ colorScheme: "dark" }}
        />

        <button
          type="button"
          disabled={loading || !ready}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
          onClick={confirm}
        >
          {loading ? "Processando..." : "Confirmar assinatura"}
        </button>
      </AppModal>
    </>
  );
}
