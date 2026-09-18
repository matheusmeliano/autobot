"use client";

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

export function WhatsAppClient({
  initial,
  showZApiNotice,
}: {
  initial: InstanceRow | null;
  showZApiNotice?: boolean;
}) {
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--app-text-85)] md:text-3xl">
          Integração Z-API
        </h1>
        <div className="mt-2 text-sm text-[var(--app-text-60)]">
          Configure sua instância por usuário.
        </div>
      </div>

      {showZApiNotice ? (
        <div className="mt-6 rounded-2xl border border-[var(--app-warning-border)] bg-[var(--app-warning-bg)] p-4 text-sm text-[var(--app-warning-text)] shadow-none">
          <div className="text-base font-semibold text-[var(--app-warning-text)]">
            Sobre a conexão com o WhatsApp
          </div>
          <div className="mt-3 space-y-3 opacity-95 leading-relaxed">
            <p>
              Você precisará contratar a Z-API separadamente para conectar seu WhatsApp ao AutoBot e utilizar os envios automáticos e demais automações do sistema.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
        <div className="text-[17px] font-semibold tracking-tight text-[var(--app-text-85)]">
          Configuração
        </div>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--app-text-60)]">
                Instance ID
              </div>
              <input
                className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 autofill:bg-white autofill:text-[var(--app-text-85)] autofill:shadow-[inset_0_0_0px_1000px_#ffffff] autofill:[-webkit-text-fill-color:var(--app-text-85)]"
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
                <div className="mt-2 text-xs font-medium text-rose-500">
                  {String(errors.instance_id.message)}
                </div>
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--app-text-60)]">
                Token
              </div>
              <input
                type="password"
                className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 autofill:bg-white autofill:text-[var(--app-text-85)] autofill:shadow-[inset_0_0_0px_1000px_#ffffff] autofill:[-webkit-text-fill-color:var(--app-text-85)]"
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
                <div className="mt-2 text-xs font-medium text-rose-500">
                  {String(errors.token.message)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--app-text-60)]">
                Client-Token
              </span>
              <span className="group relative inline-flex">
                <HelpCircle className="h-4 w-4 text-[var(--app-text-50)]" aria-hidden="true" />
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-[280px] -translate-y-1/2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3 py-2 text-[11px] font-semibold leading-relaxed text-[var(--app-text-70)] opacity-0 transition-opacity group-hover:opacity-100 shadow-none">
                  Use o Client-Token para autenticar as requisições do AutoBot na sua instância da Z-API (header
                  Client-Token). Algumas operações, como agendamentos, podem exigir esse token para funcionar.
                </span>
              </span>
            </div>
            <input
              type="password"
              className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 autofill:bg-white autofill:text-[var(--app-text-85)] autofill:shadow-[inset_0_0_0px_1000px_#ffffff] autofill:[-webkit-text-fill-color:var(--app-text-85)]"
              placeholder={initial?.hasClientToken ? MASK : "client-token"}
              {...register("client_token")}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-btn-primary-bg)] px-6 py-3 text-[0.95rem] font-semibold text-[var(--app-btn-primary-fg)] hover:bg-[var(--app-btn-primary-bg-hover)] disabled:opacity-60 disabled:hover:bg-[var(--app-btn-primary-bg)] shadow-none"
          >
            {isSubmitting ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>
    </div>
  );
}
