"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { HelpCircle } from "lucide-react";
import { upsertWhatsAppInstanceAction } from "@/app/app/whatsapp/actions";
import { modalToast } from "@/lib/modalToast";

const MASK = "********";

type InstanceRow = {
  instance_id: string | null;
  status: string | null;
  hasToken: boolean;
  hasClientToken: boolean;
  display_name: string | null;
  phone: string | null;
};

type FormValues = {
  instance_id: string;
  token: string;
  client_token: string;
  display_name: string;
};

function formatWhatsAppPhone(value: string | null): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "-";
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const nine = digits.length === 13 ? digits.slice(4, 5) : "";
    const block1 = digits.length === 13 ? digits.slice(5, 9) : digits.slice(4, 8);
    const block2 = digits.length === 13 ? digits.slice(9) : digits.slice(8);
    return `+55 (${ddd}) ${nine}${block1}-${block2}`;
  }
  if (digits.startsWith("1") && digits.length === 11) {
    const area = digits.slice(1, 4);
    const b1 = digits.slice(4, 7);
    const b2 = digits.slice(7);
    return `+1 (${area}) ${b1}-${b2}`;
  }
  return digits.replace(/^(\d{1,3})(\d{2,})(\d{4})$/, (_, p1, p2, p3) => `+${p1} (${p2}) ${p3}`);
}

export function WhatsAppClient({ initial }: { initial: InstanceRow | null }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      instance_id: initial?.instance_id ?? "",
      token: initial?.hasToken ? MASK : "",
      client_token: initial?.hasClientToken ? MASK : "",
      display_name: initial?.display_name ?? "",
    },
  });

  const displayNameValue = initial?.display_name;
  const phoneFormatted = useMemo(() => formatWhatsAppPhone(initial?.phone ?? null), [initial?.phone]);
  const primaryLabel = displayNameValue?.trim() ? displayNameValue.trim() : "WhatsApp não identificado";
  const secondaryInfo =
    initial?.phone?.trim()
      ? phoneFormatted
      : initial?.instance_id
        ? `Instance: ${initial.instance_id}`
        : "Número ainda não sincronizado. A próxima mensagem recebida atualiza automaticamente.";

  const onSubmit = handleSubmit(async (values) => {
    const tokenValue = String(values.token ?? "").trim();
    const clientTokenValue = String(values.client_token ?? "").trim();
    const displayNameValueRaw = String(values.display_name ?? "").trim();
    const res = await upsertWhatsAppInstanceAction({
      instance_id: values.instance_id,
      token: tokenValue && tokenValue !== MASK ? tokenValue : undefined,
      client_token: clientTokenValue && clientTokenValue !== MASK ? clientTokenValue : undefined,
      display_name: displayNameValueRaw ? displayNameValueRaw : null,
    });
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }
    const toastId = modalToast.success("Configuração salva.");
    const nextHasClientToken =
      initial?.hasClientToken || Boolean(clientTokenValue && clientTokenValue !== MASK);
    reset({
      instance_id: values.instance_id,
      token: MASK,
      client_token: nextHasClientToken ? MASK : "",
      display_name: displayNameValueRaw,
    });
    await modalToast.wait(toastId);
    window.location.reload();
  });

  const isConnected =
    initial?.status === "connected" || initial?.status === "configured";
  const statusLabel = isConnected ? "Conectado" : "Desconectado";

  return (
    <div>
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Integração Z-API
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Configure sua instância por usuário.
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Status</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {statusLabel}
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Número WhatsApp</div>
          <div className="mt-2 min-w-0">
            <div className="truncate text-sm font-semibold leading-relaxed text-[var(--app-text-85)]">
              {primaryLabel}
            </div>
            <div
              className="mt-1 truncate text-xs text-[var(--app-text-55)]"
              title={initial?.instance_id ?? secondaryInfo}
            >
              {secondaryInfo}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold">Configuração</div>
        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white/60">
                Instance ID
              </div>
              <input
                className="mt-2 w-full min-w-0 rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
                style={{ backgroundColor: "#0b1220" }}
                placeholder="instance_xxx"
                {...register("instance_id", {
                  validate: (value) => {
                    const v = String(value ?? "").trim();
                    if (!v) return "Informe o Instance ID.";
                    return true;
                  },
                })}
              />
              {errors.instance_id?.message ? (
                <div className="mt-2 text-xs font-medium text-rose-300">
                  {String(errors.instance_id.message)}
                </div>
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-white/60">Token</div>
              </div>
              <input
                type="password"
                className="mt-2 w-full min-w-0 rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
                style={{ backgroundColor: "#0b1220" }}
                placeholder={initial?.hasToken ? MASK : "token"}
                {...register("token", {
                  validate: (value) => {
                    const v = String(value ?? "").trim();
                    if (!v) return initial?.hasToken ? true : "Informe o token.";
                    if (v === MASK) return initial?.hasToken ? true : "Informe o token.";
                    return true;
                  },
                })}
              />
              {errors.token?.message ? (
                <div className="mt-2 text-xs font-medium text-rose-300">
                  {String(errors.token.message)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0 md:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/60">
                <span>Client-Token</span>
                <span className="group relative inline-flex">
                  <HelpCircle className="h-4 w-4 text-white/50" aria-hidden="true" />
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-[280px] -translate-y-1/2 rounded-xl border border-white/10 bg-[#070A10] px-3 py-2 text-[11px] font-semibold leading-relaxed text-white/70 opacity-0 transition-opacity group-hover:opacity-100">
                    Use o Client-Token para autenticar as requisições do AutoBot na sua instância da Z-API (header
                    Client-Token). Algumas operações, como agendamentos, podem exigir esse token para funcionar.
                  </span>
                </span>
              </div>
              <input
                type="password"
                className="mt-2 w-full min-w-0 rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
                style={{ backgroundColor: "#0b1220" }}
                placeholder={initial?.hasClientToken ? MASK : "client-token"}
                {...register("client_token")}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0 md:col-span-2">
              <div className="text-xs font-semibold text-white/60">
                Nome (apelido) do número <span className="font-normal text-white/45">— Opcional. Ex.: Suporte, Vendas, Professor Lucas, Financeiro</span>
              </div>
              <input
                className="mt-2 w-full min-w-0 rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
                style={{ backgroundColor: "#0b1220" }}
                placeholder="Ex.: Professor Lucas"
                maxLength={80}
                {...register("display_name", {
                  validate: (value) => {
                    const v = String(value ?? "").trim();
                    if (v.length > 80) return "Máximo 80 caracteres.";
                    return true;
                  },
                })}
              />
              {errors.display_name?.message ? (
                <div className="mt-2 text-xs font-medium text-rose-300">
                  {String(errors.display_name.message)}
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-white/45">
                Esse nome aparecerá como identificação principal no painel. O número de telefone é exibido abaixo como
                informação secundária (automaticamente sincronizado quando a próxima mensagem é recebida da Z-API).
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
          >
            {isSubmitting ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>
    </div>
  );
}
