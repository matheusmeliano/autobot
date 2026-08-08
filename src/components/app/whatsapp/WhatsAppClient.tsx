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
  phone: string | null;
};

type FormValues = {
  instance_id: string;
  token: string;
  client_token: string;
};

function formatWhatsAppPhone(value: string | null): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 10 || digits.length > 15) return "";
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
  if (digits.length >= 7 && digits.length <= 15) {
    const groups: string[] = [];
    let remaining = digits;
    if (remaining.length > 10) {
      const ccLen = remaining.length >= 12 ? 2 : remaining.length >= 11 ? 1 : 2;
      groups.push(`+${remaining.slice(0, ccLen)}`);
      remaining = remaining.slice(ccLen);
    } else {
      groups.push("+");
    }
    while (remaining.length > 4) {
      groups.push(remaining.slice(0, 3));
      remaining = remaining.slice(3);
    }
    if (remaining) groups.push(remaining);
    return groups.join(" ").replace("+ ", "+");
  }
  return "";
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
    },
  });

  const isConnected =
    initial?.status === "connected" || initial?.status === "configured";
  const statusLabel = isConnected ? "Conectado" : "Desconectado";

  const phoneFormatted = useMemo(() => formatWhatsAppPhone(initial?.phone ?? null), [initial?.phone]);
  const rawDigits = String(initial?.phone ?? "").replace(/\D/g, "");
  const hasPhoneDigits = rawDigits.length >= 10 && rawDigits.length <= 15;
  const phoneCardTitle = phoneFormatted || "";
  const phonePrimaryLabel = !isConnected
    ? "-"
    : hasPhoneDigits
      ? phoneCardTitle
      : "Número ainda não sincronizado";

  const primaryLabel = phonePrimaryLabel;
  const secondaryInfo = !isConnected
    ? "Instância desconectada na Z-API."
    : phoneCardTitle
      ? (initial?.instance_id ? `Instance: ${initial.instance_id}` : "")
      : (initial?.instance_id
        ? `Instance: ${initial.instance_id}. A próxima mensagem recebida da Z-API atualiza o número.`
        : "A próxima mensagem recebida da Z-API atualiza automaticamente.");

  const onSubmit = handleSubmit(async (values) => {
    const tokenValue = String(values.token ?? "").trim();
    const clientTokenValue = String(values.client_token ?? "").trim();
    const res = await upsertWhatsAppInstanceAction({
      instance_id: values.instance_id,
      token: tokenValue && tokenValue !== MASK ? tokenValue : undefined,
      client_token: clientTokenValue && clientTokenValue !== MASK ? clientTokenValue : undefined,
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
    });
    await modalToast.wait(toastId);
    window.location.reload();
  });

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
