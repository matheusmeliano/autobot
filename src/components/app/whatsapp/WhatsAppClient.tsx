"use client";

import { useForm } from "react-hook-form";
import { upsertWhatsAppInstanceAction } from "@/app/app/whatsapp/actions";
import { modalToast } from "@/lib/modalToast";

type InstanceRow = {
  instance_id: string | null;
  token: string | null;
  client_token: string | null;
  status: string | null;
  phone: string | null;
};

type FormValues = {
  instance_id: string;
  token: string;
  client_token: string;
  phone: string;
};

export function WhatsAppClient({ initial }: { initial: InstanceRow | null }) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      instance_id: initial?.instance_id ?? "",
      token: initial?.token ?? "",
      client_token: initial?.client_token ?? "",
      phone: initial?.phone ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await upsertWhatsAppInstanceAction({
      instance_id: values.instance_id,
      token: values.token,
      client_token: values.client_token || undefined,
      phone: values.phone || undefined,
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
          Configure sua instância (API) por usuário.
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 min-[1201px]:grid-cols-3">
        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Status</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {statusLabel}
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Instance ID</div>
          <div className="mt-2 min-w-0 truncate text-sm font-semibold text-white/80">
            {initial?.instance_id ?? "-"}
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:col-span-2 min-[1201px]:col-span-1">
          <div className="text-xs font-semibold text-white/55">Número</div>
          <div className="mt-2 min-w-0 truncate text-sm font-semibold text-white/80">
            {initial?.phone ?? "-"}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold">Configuração</div>
        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-white/60">
                Instance ID
              </div>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                placeholder="instance_xxx"
                {...register("instance_id", { required: true })}
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-white/60">Token</div>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                placeholder="token"
                {...register("token", { required: true })}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-white/60">
                Client-Token
              </div>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                placeholder="client-token"
                {...register("client_token")}
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-white/60">Número</div>
              <input
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                placeholder="55DDDNUMERO"
                {...register("phone")}
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
