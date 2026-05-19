"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import {
  createScheduleAction,
  deleteScheduleAction,
  updateScheduleAction,
} from "@/app/app/agenda/actions";

export type DebtorOption = { id: string; nome: string };
export type TemplateOption = { id: string; nome: string };

export type ScheduleRow = {
  id: string;
  debtor_id: string;
  template_id: string | null;
  data_envio: string;
  status: string;
  created_at: string;
  debtor_nome: string;
  template_nome: string | null;
};

type FormValues = {
  id?: string;
  debtor_id: string;
  template_id?: string;
  data_envio: string;
  status: string;
};

function dateTimeBR(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("pt-BR");
}

export function SchedulesClient({
  initial,
  debtors,
  templates,
}: {
  initial: ScheduleRow[];
  debtors: DebtorOption[];
  templates: TemplateOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ScheduleRow[]>(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.debtor_nome.toLowerCase().includes(q));
  }, [query, rows]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      debtor_id: "",
      template_id: "",
      data_envio: "",
      status: "agendado",
    },
  });

  const close = () => {
    setOpen(false);
    setEditing(null);
    reset({
      debtor_id: "",
      template_id: "",
      data_envio: "",
      status: "agendado",
    });
  };

  const openCreate = () => {
    close();
    setOpen(true);
  };

  const openEdit = (row: ScheduleRow) => {
    setEditing(row);
    setOpen(true);
    reset({
      id: row.id,
      debtor_id: row.debtor_id,
      template_id: row.template_id ?? "",
      data_envio: row.data_envio.slice(0, 16),
      status: row.status,
    });
  };

  const refresh = () =>
    startTransition(async () => {
      const r = await fetch("/app/agenda/data", { cache: "no-store" });
      const json = (await r.json()) as ScheduleRow[];
      setRows(json);
    });

  const onSubmit = handleSubmit(async (values) => {
    if (!values.debtor_id) {
      modalToast.warning("Selecione um cliente.");
      return;
    }

    const payload = {
      ...(values.id ? { id: values.id } : {}),
      debtor_id: values.debtor_id,
      template_id: values.template_id ? values.template_id : undefined,
      data_envio: values.data_envio,
      status: values.status,
    };

    const res = editing
      ? await updateScheduleAction(payload)
      : await createScheduleAction(payload);

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    modalToast.success(editing ? "Agendamento atualizado." : "Agendamento criado.");
    refresh();
    close();
  });

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteScheduleAction(id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      modalToast.success("Agendamento excluído.");
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Agendamentos
          </h1>
          <div className="mt-2 text-sm text-white/60">
            Agende envios por cliente e template.
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente..."
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
          />
          <button
            onClick={openCreate}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo agendamento
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 min-[1201px]:hidden">
          Role para o lado.
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[820px] min-[1201px]:min-w-0">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-4">Cliente</div>
              <div className="col-span-3">Template</div>
              <div className="col-span-2 text-center">Data/Hora</div>
              <div className="col-span-1 text-center">Status</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum agendamento encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-4 truncate font-semibold">{r.debtor_nome}</div>
                    <div className="col-span-3 truncate text-white/60">
                      {r.template_nome ?? "-"}
                    </div>
                    <div className="col-span-2 text-center text-white/60">
                      {dateTimeBR(r.data_envio)}
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-white/70">
                        {r.status}
                      </span>
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(r)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06]"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(r.id)}
                        disabled={isPending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06] disabled:opacity-60"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AppModal open={open} onClose={close} size="lg" zIndexClass="z-[100]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">
              {editing ? "Editar agendamento" : "Novo agendamento"}
            </div>
            <div className="mt-1 text-xs text-white/55">
              Escolha cliente, template e data/hora.
            </div>
          </div>
          <button
            onClick={close}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
              <div>
                <div className="text-xs font-semibold text-white/60">
                  Cliente
                </div>
                <select
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                  {...register("debtor_id", { required: true })}
                >
                  <option value="">Selecione...</option>
                  {debtors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs font-semibold text-white/60">
                  Template (Mensagens)
                </div>
                <select
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                  {...register("template_id")}
                >
                  <option value="">Sem template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-white/60">
                    Data/Hora
                  </div>
                  <input
                    type="datetime-local"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
                    {...register("data_envio", { required: true })}
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white/60">
                    Status
                  </div>
                  <select
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark]"
                    {...register("status")}
                  >
                    <option className="bg-[#070A10] text-white" value="agendado">
                      agendado
                    </option>
                    <option className="bg-[#070A10] text-white" value="pausado">
                      pausado
                    </option>
                    <option className="bg-[#070A10] text-white" value="executado">
                      executado
                    </option>
                    <option className="bg-[#070A10] text-white" value="cancelado">
                      cancelado
                    </option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || isPending}
                className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
              >
                {editing ? "Salvar alterações" : "Criar agendamento"}
              </button>
        </form>
      </AppModal>
    </div>
  );
}
