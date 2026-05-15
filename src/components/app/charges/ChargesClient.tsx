"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  createChargeAction,
  deleteChargeAction,
  updateChargeStatusAction,
} from "@/app/app/cobrancas/actions";

export type DebtorOption = { id: string; nome: string; pix_key: string | null };
export type TemplateOption = { id: string; nome: string; conteudo: string };

export type ChargeRow = {
  id: string;
  debtor_id: string;
  mensagem: string | null;
  status: string;
  enviada_em: string | null;
  tentativa: number;
  created_at: string;
  debtor_nome: string;
};

type FormValues = {
  debtor_id: string;
  template_id?: string;
  mensagem: string;
};

function dateBR(v: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("pt-BR");
}

export function ChargesClient({
  initial,
  debtors,
  templates,
}: {
  initial: ChargeRow[];
  debtors: DebtorOption[];
  templates: TemplateOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ChargeRow[]>(initial);
  const [query, setQuery] = useState("");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { debtor_id: "", template_id: "", mensagem: "" },
  });

  const selectedTemplateId = watch("template_id");
  const selectedDebtorId = watch("debtor_id");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.debtor_nome.toLowerCase().includes(q));
  }, [query, rows]);

  const applyTemplate = (templateId?: string) => {
    if (!templateId) return;
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    const debtor = debtors.find((d) => d.id === selectedDebtorId);
    const pix = debtor?.pix_key ?? "{pix}";
    const msg = t.conteudo.split("{pix}").join(pix);
    setValue("mensagem", msg);
  };

  const refresh = () =>
    startTransition(async () => {
      const r = await fetch("/app/cobrancas/data", { cache: "no-store" });
      const json = (await r.json()) as ChargeRow[];
      setRows(json);
    });

  const onSubmit = handleSubmit(async (values) => {
    if (!values.debtor_id) {
      toast.error("Selecione um cliente.");
      return;
    }
    if (!values.mensagem.trim()) {
      toast.error("Mensagem obrigatória.");
      return;
    }

    const res = await createChargeAction({
      debtor_id: values.debtor_id,
      mensagem: values.mensagem,
      status: "pendente",
    });
    if (!res.ok) {
      toast.error(res.error ?? "Falha ao criar cobrança.");
      return;
    }
    toast.success("Cobrança criada (pendente).");
    reset({ debtor_id: "", template_id: "", mensagem: "" });
    refresh();
  });

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteChargeAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      toast.success("Cobrança excluída.");
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  };

  const setStatus = (id: string, status: string) => {
    startTransition(async () => {
      const res = await updateChargeStatusAction(id, status);
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao atualizar status.");
        return;
      }
      toast.success("Status atualizado.");
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
            COBRANÇAS
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Cobranças
          </h1>
          <div className="mt-2 text-sm text-white/60">
            Crie cobranças pendentes e acompanhe status.
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold">Nova cobrança</div>
        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-white/60">Cliente</div>
              <select
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
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
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
                {...register("template_id")}
                onChange={(e) => {
                  const v = e.target.value;
                  setValue("template_id", v);
                  applyTemplate(v);
                }}
                value={selectedTemplateId ?? ""}
              >
                <option value="">Sem template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-white/60">Mensagem</div>
            <textarea
              rows={5}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              placeholder="Digite ou use um template..."
              {...register("mensagem", { required: true })}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || isPending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Criar cobrança
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 sm:hidden">
          Role para o lado.
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-3">Cliente</div>
              <div className="col-span-4">Mensagem</div>
              <div className="col-span-2">Criada em</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1 text-right">Ações</div>
            </div>

            <div className="border-b border-white/10 px-4 py-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por cliente..."
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              />
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhuma cobrança encontrada.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-3 font-semibold">{r.debtor_nome}</div>
                    <div className="col-span-4 line-clamp-2 text-white/60">
                      {r.mensagem ?? "-"}
                    </div>
                    <div className="col-span-2 text-white/60">
                      {dateBR(r.created_at)}
                    </div>
                    <div className="col-span-2">
                      <select
                        value={r.status}
                        disabled={isPending}
                        onChange={(e) => setStatus(r.id, e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white outline-none focus:border-white/20"
                      >
                        <option value="pendente">pendente</option>
                        <option value="enviada">enviada</option>
                        <option value="falhou">falhou</option>
                        <option value="paga">paga</option>
                        <option value="cancelada">cancelada</option>
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-end">
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
    </div>
  );
}
