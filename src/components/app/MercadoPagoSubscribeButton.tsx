"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { loadMercadoPagoSdk } from "@/lib/mercadopago-sdk";

export function MercadoPagoSubscribeButton(props: {
  plan: "basico" | "pro";
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
  amount: number;
  userEmail?: string | null;
}) {
  const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? "";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadingRef = useRef(false);
  const [mounted, setMounted] = useState(false);

  const ids = useMemo(() => {
    const suffix = `${props.plan}-${attempt}-${Math.random().toString(16).slice(2)}`;
    return {
      form: `mp-form-${suffix}`,
      cardNumber: `mp-cardNumber-${suffix}`,
      expirationDate: `mp-expirationDate-${suffix}`,
      securityCode: `mp-securityCode-${suffix}`,
      cardholderName: `mp-cardholderName-${suffix}`,
      issuer: `mp-issuer-${suffix}`,
      installments: `mp-installments-${suffix}`,
      identificationType: `mp-identificationType-${suffix}`,
      identificationNumber: `mp-identificationNumber-${suffix}`,
      cardholderEmail: `mp-cardholderEmail-${suffix}`,
    };
  }, [props.plan, attempt]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!mounted) return;
    if (!publicKey) {
      toast.error(
        "Configuração incompleta. Defina NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY na Vercel.",
      );
      setInitError(
        "Configuração incompleta. Defina NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY na Vercel.",
      );
      return;
    }

    let cardForm: any = null;
    let cancelled = false;

    const init = async () => {
      try {
        setInitError(null);
        await loadMercadoPagoSdk();
        if (cancelled) return;
        await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
        if (cancelled) return;

        const w = window as any;
        if (!w?.MercadoPago) throw new Error("SDK missing");

        const mp = new w.MercadoPago(publicKey);
        cardForm = mp.cardForm({
          amount: String(props.amount),
          iframe: true,
          form: {
            id: ids.form,
            cardNumber: { id: ids.cardNumber, placeholder: "Número do cartão" },
            expirationDate: { id: ids.expirationDate, placeholder: "MM/AA" },
            securityCode: { id: ids.securityCode, placeholder: "CVV" },
            cardholderName: {
              id: ids.cardholderName,
              placeholder: "Nome no cartão",
            },
            issuer: { id: ids.issuer, placeholder: "Banco" },
            installments: { id: ids.installments, placeholder: "Parcelas" },
            identificationType: {
              id: ids.identificationType,
              placeholder: "Documento",
            },
            identificationNumber: {
              id: ids.identificationNumber,
              placeholder: "Número do documento",
            },
            cardholderEmail: { id: ids.cardholderEmail, placeholder: "E-mail" },
          },
          callbacks: {
            onFormMounted: (error: any) => {
              if (error) {
                setInitError("Falha ao carregar o formulário do cartão.");
              }
            },
            onSubmit: async (event: any) => {
              event.preventDefault();
              if (loadingRef.current) return;
              setLoading(true);
              loadingRef.current = true;
              try {
                const data = cardForm.getCardFormData();
                const token = data?.token ?? null;
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
                  toast.error(body?.error ?? "Falha ao iniciar pagamento.");
                  return;
                }

                toast.success(
                  "Assinatura criada. Pode levar alguns minutos para ativar.",
                );
                setOpen(false);
                window.location.reload();
              } catch {
                toast.error("Falha ao iniciar pagamento.");
              } finally {
                setLoading(false);
                loadingRef.current = false;
              }
            },
          },
        });
      } catch {
        setInitError(
          "Falha ao carregar o Mercado Pago. Toque em “Tentar novamente”. Se persistir, recarregue a página.",
        );
      }
    };

    init();

    return () => {
      cancelled = true;
      try {
        cardForm?.unmount?.();
      } catch {}
    };
  }, [open, mounted, publicKey, props.amount, props.plan, ids]);

  function onClick() {
    if (props.disabled || loading) return;
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        disabled={props.disabled || loading}
        className={props.className}
        onClick={onClick}
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
                  PAGAMENTO
                </div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  Cartão de crédito
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
              Alguns bancos exigem que o cartão esteja habilitado para compras online e
              cobranças recorrentes. Se falhar, tente outro cartão ou libere no app do
              banco.
            </div>

            {initError ? (
              <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                <div>{initError}</div>
                <button
                  type="button"
                  className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90"
                  onClick={() => setAttempt((v) => v + 1)}
                >
                  Tentar novamente
                </button>
              </div>
            ) : null}

            <form id={ids.form} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3">
                <div id={ids.cardNumber} className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2" />
                <div className="grid grid-cols-2 gap-3">
                  <div id={ids.expirationDate} className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2" />
                  <div id={ids.securityCode} className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2" />
                </div>
                <input
                  id={ids.cardholderName}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                  placeholder="Nome no cartão"
                />
                <select
                  id={ids.issuer}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <select
                  id={ids.installments}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    id={ids.identificationType}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/85 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                  />
                  <input
                    id={ids.identificationNumber}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                    placeholder="CPF"
                    inputMode="numeric"
                    maxLength={11}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.value = el.value.replace(/\D/g, "").slice(0, 11);
                    }}
                  />
                </div>
                <input
                  id={ids.cardholderEmail}
                  defaultValue={props.userEmail ?? ""}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                  placeholder="E-mail"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !!initError}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
              >
                {loading ? "Processando..." : "Confirmar assinatura"}
              </button>
            </form>
      </AppModal>
    </>
  );
}
