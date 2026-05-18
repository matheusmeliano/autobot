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
  const [method, setMethod] = useState<"card" | "pix">("card");
  const [pix, setPix] = useState<{
    id: string;
    status: string | null;
    qr_code: string | null;
    qr_code_base64: string | null;
    ticket_url: string | null;
  } | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const loadingRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const controllerRef = useRef<any>(null);

  const ids = useMemo(() => {
    const suffix = `${props.plan}-${Math.random().toString(16).slice(2)}`;
    return {
      brick: `mp-brick-${suffix}`,
    };
  }, [props.plan]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!mounted) return;
    if (method !== "card") return;
    if (!publicKey) {
      toast.error(
        "Configuração incompleta. Defina NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY na Vercel.",
      );
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        await loadMercadoPagoSdk();
        if (cancelled) return;
        const containerId = ids.brick;
        for (let i = 0; i < 10; i++) {
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

        controllerRef.current = await bricksBuilder.create("payment", containerId, {
          initialization: {
            amount: props.amount,
            payer: props.userEmail ? { email: props.userEmail } : undefined,
          },
          customization: {
            paymentMethods: {
              creditCard: "all",
              minInstallments: 1,
              maxInstallments: 1,
            },
            visual: {
              style: {
                theme: "dark",
                customVariables: {
                  textPrimaryColor: "#ffffff",
                  textSecondaryColor: "rgba(255,255,255,0.65)",
                  inputBackgroundColor: "rgba(255,255,255,0.04)",
                  formBackgroundColor: "transparent",
                  baseColor: "#ffffff",
                  buttonTextColor: "#000000",
                  outlinePrimaryColor: "rgba(255,255,255,0.18)",
                  outlineSecondaryColor: "rgba(255,255,255,0.10)",
                  borderRadiusMedium: "16px",
                },
              },
            },
          },
          callbacks: {
            onReady: () => {},
            onError: () => {
              toast.error("Falha ao carregar o formulário do cartão.");
            },
            onSubmit: ({ formData }: any) => {
              return new Promise<void>((resolve, reject) => {
                if (loadingRef.current) {
                  resolve();
                  return;
                }
                setLoading(true);
                loadingRef.current = true;
                fetch("/api/billing/mercadopago/card", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ plan: props.plan, formData }),
                })
                  .then(async (r) => ({
                    ok: r.ok,
                    b: await r.json().catch(() => null),
                  }))
                  .then(({ ok, b }) => {
                    if (!ok || !b?.ok) {
                      toast.error(b?.error ?? "Falha ao iniciar pagamento.");
                      reject(new Error("Subscribe failed"));
                      return;
                    }

                    toast.success("Pagamento criado. Pode levar alguns minutos para confirmar.");
                    setOpen(false);
                    window.location.reload();
                    resolve();
                  })
                  .catch(() => {
                    toast.error("Falha ao iniciar pagamento.");
                    reject(new Error("Request failed"));
                  })
                  .finally(() => {
                    setLoading(false);
                    loadingRef.current = false;
                  });
              });
            },
          },
        });
      } catch {
        toast.error("Falha ao carregar o Mercado Pago.");
      }
    };

    init();

    return () => {
      cancelled = true;
      try {
        controllerRef.current?.unmount?.();
      } catch {}
      controllerRef.current = null;
    };
  }, [open, mounted, method, publicKey, props.amount, props.plan, props.userEmail, ids]);

  useEffect(() => {
    if (!open) {
      setPix(null);
      setPixLoading(false);
      setMethod("card");
      return;
    }
    if (!mounted) return;
    if (method !== "pix") return;
    if (pix || pixLoading) return;

    setPixLoading(true);
    fetch("/api/billing/mercadopago/pix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: props.plan }),
    })
      .then(async (r) => ({
        ok: r.ok,
        b: await r.json().catch(() => null),
      }))
      .then(({ ok, b }) => {
        if (!ok || !b?.ok) {
          toast.error(b?.error ?? "Falha ao gerar PIX.");
          return;
        }
        setPix({
          id: String(b.id),
          status: b.status ?? null,
          qr_code: b.qr_code ?? null,
          qr_code_base64: b.qr_code_base64 ?? null,
          ticket_url: b.ticket_url ?? null,
        });
      })
      .catch(() => {
        toast.error("Falha ao gerar PIX.");
      })
      .finally(() => setPixLoading(false));
  }, [open, mounted, method, pix, pixLoading, props.plan]);

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

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setMethod("card")}
                className={[
                  "inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold",
                  method === "card"
                    ? "bg-white text-black"
                    : "bg-white/[0.04] text-white/80 hover:bg-white/[0.06]",
                ].join(" ")}
              >
                Cartão
              </button>
              <button
                type="button"
                onClick={() => setMethod("pix")}
                className={[
                  "inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold",
                  method === "pix"
                    ? "bg-white text-black"
                    : "bg-white/[0.04] text-white/80 hover:bg-white/[0.06]",
                ].join(" ")}
              >
                PIX
              </button>
            </div>

            {method === "card" ? (
              <div
                id={ids.brick}
                className={[
                  "mp-brick-wrapper mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3",
                  loading ? "pointer-events-none opacity-80" : "",
                ].join(" ")}
              />
            ) : (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white/85">
                  Pague com PIX (pagamento único)
                </div>
                <div className="mt-1 text-sm text-white/60">
                  Após pagar, a liberação pode levar alguns minutos para confirmar.
                </div>

                {pixLoading ? (
                  <div className="mt-4 text-sm text-white/60">Gerando QR Code...</div>
                ) : pix?.qr_code_base64 ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[220px,1fr] sm:items-start">
                    <img
                      src={`data:image/png;base64,${pix.qr_code_base64}`}
                      alt="QR Code PIX"
                      className="h-[220px] w-[220px] rounded-xl border border-white/10 bg-white"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
                        COPIA E COLA
                      </div>
                      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/80 break-all">
                        {pix.qr_code ?? ""}
                      </div>
                      {pix.ticket_url ? (
                        <a
                          href={pix.ticket_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90"
                        >
                          Abrir página do PIX
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-white/60">
                    Não foi possível gerar o PIX. Tente novamente.
                  </div>
                )}
              </div>
            )}
      </AppModal>
    </>
  );
}
