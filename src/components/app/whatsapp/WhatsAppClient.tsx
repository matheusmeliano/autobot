"use client";

import { useForm } from "react-hook-form";
import { Eye, EyeOff, HelpCircle } from "lucide-react";
import { useState } from "react";
import { upsertWhatsAppInstanceAction } from "@/app/app/whatsapp/actions";
import { modalToast } from "@/lib/modalToast";

type InstanceRow = {
  instance_id: string | null;
  status: string | null;
  hasToken: boolean;
  tokenLast4: string | null;
  hasClientToken: boolean;
  clientTokenLast4: string | null;
};

type FormValues = {
  instance_id: string;
  token: string;
  client_token: string;
};

export function WhatsAppClient({ initial }: { initial: InstanceRow | null }) {
  const [showToken, setShowToken] = useState(false);
  const [showClientToken, setShowClientToken] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      instance_id: initial?.instance_id ?? "",
      token: "",
      client_token: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await upsertWhatsAppInstanceAction({
      instance_id: values.instance_id,
      token: values.token || undefined,
      client_token: values.client_token || undefined,
    });
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }
    modalToast.success("Configuração salva.");
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
          <div className="text-xs font-semibold text-white/55">Instance ID</div>
          <div className="mt-2 min-w-0 break-all text-sm font-semibold leading-relaxed text-white/80">
            {initial?.instance_id ?? "-"}
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
                className="mt-2 w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
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
              <div className="text-xs font-semibold text-white/60">Token</div>
              <div className="relative mt-2">
                <input
                  type={showToken ? "text" : "password"}
                  className="w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-11 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  placeholder={initial?.hasToken ? "•••••••• (deixe em branco para manter)" : "token"}
                  {...register("token", {
                    validate: (value) => {
                      const v = String(value ?? "").trim();
                      if (!v && !initial?.hasToken) return "Informe o token.";
                      return true;
                    },
                  })}
                />
                <button
                  type="button"
                  aria-label={showToken ? "Ocultar token" : "Ver token"}
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/50 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {initial?.hasToken && initial.tokenLast4 ? (
                <div className="mt-2 text-[11px] font-semibold text-white/45">
                  Token atual termina com {initial.tokenLast4}
                </div>
              ) : null}
              {errors.token?.message ? (
                <div className="mt-2 text-xs font-medium text-rose-300">
                  {String(errors.token.message)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
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
              <div className="relative mt-2">
                <input
                  type={showClientToken ? "text" : "password"}
                  className="w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-11 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  placeholder={
                    initial?.hasClientToken ? "•••••••• (deixe em branco para manter)" : "client-token"
                  }
                  {...register("client_token")}
                />
                <button
                  type="button"
                  aria-label={showClientToken ? "Ocultar client-token" : "Ver client-token"}
                  onClick={() => setShowClientToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/50 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  {showClientToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {initial?.hasClientToken && initial.clientTokenLast4 ? (
                <div className="mt-2 text-[11px] font-semibold text-white/45">
                  Client-Token atual termina com {initial.clientTokenLast4}
                </div>
              ) : null}
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
