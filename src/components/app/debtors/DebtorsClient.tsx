"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import {
  createDebtorAction,
  deleteDebtorAction,
  updateDebtorAction,
} from "@/app/app/clientes/actions";

export type DebtorRow = {
  id: string;
  nome: string;
  telefone: string | null;
  valor: number | null;
  vencimento: string | null;
  pix_key: string | null;
  observacoes: string | null;
  status: string;
  created_at: string;
};

type FormValues = {
  id?: string;
  nome: string;
  telefone?: string;
  valor?: string;
  vencimento?: string;
  pix_key?: string;
  observacoes?: string;
  status?: string;
};

function money(v: number | null) {
  if (typeof v !== "number") return "-";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateBR(v: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("pt-BR");
}

export function DebtorsClient({ initial }: { initial: DebtorRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DebtorRow[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DebtorRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.nome.toLowerCase().includes(q) ||
        (r.telefone ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, rows]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      nome: "",
      telefone: "",
      valor: "",
      vencimento: "",
      pix_key: "",
      observacoes: "",
      status: "ativo",
    },
  });

  const close = () => {
    setOpen(false);
    setEditing(null);
    reset({
      nome: "",
      telefone: "",
      valor: "",
      vencimento: "",
      pix_key: "",
      observacoes: "",
      status: "ativo",
    });
  };

  const openCreate = () => {
    close();
    setOpen(true);
  };

  const openEdit = (row: DebtorRow) => {
    setEditing(row);
    setOpen(true);
    reset({
      id: row.id,
      nome: row.nome,
      telefone: row.telefone ?? "",
      valor: row.valor != null ? String(row.valor) : "",
      vencimento: row.vencimento ?? "",
      pix_key: row.pix_key ?? "",
      observacoes: row.observacoes ?? "",
      status: row.status ?? "ativo",
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      ...(values.id ? { id: values.id } : {}),
      nome: values.nome,
      telefone: values.telefone || undefined,
      valor: values.valor ? Number(values.valor.replace(",", ".")) : undefined,
      vencimento: values.vencimento || undefined,
      pix_key: values.pix_key || undefined,
      observacoes: values.observacoes || undefined,
      status: values.status || "ativo",
    };

    const res = editing
      ? await updateDebtorAction(payload)
      : await createDebtorAction(payload);

    if (!res.ok) {
      toast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    toast.success(editing ? "Cliente atualizado." : "Cliente criado.");

    startTransition(async () => {
      const r = await fetch("/app/clientes/data", { cache: "no-store" });
      const json = (await r.json()) as DebtorRow[];
      setRows(json);
      close();
    });
  });

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteDebtorAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      toast.success("Cliente excluído.");
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
            CLIENTES
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Clientes e devedores
          </h1>
          <div className="mt-2 text-sm text-white/60">
            Cadastre clientes, valores e vencimentos para gerar cobranças.
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
          />
          <button
            onClick={openCreate}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo cliente
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 sm:hidden">
          Role para o lado.
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-4">Nome</div>
              <div className="col-span-2">Telefone</div>
              <div className="col-span-2">Valor</div>
              <div className="col-span-2">Vencimento</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum cliente encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-4 truncate font-semibold">{r.nome}</div>
                    <div className="col-span-2 text-white/60">{r.telefone ?? "-"}</div>
                    <div className="col-span-2">{money(r.valor)}</div>
                    <div className="col-span-2 text-white/60">{dateBR(r.vencimento)}</div>
                    <div className="col-span-1">
                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-white/70">
                        {r.status}
                      </span>
                    </div>
                    <div className="col-span-1 flex justify-end gap-2">
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
              {editing ? "Editar cliente" : "Novo cliente"}
            </div>
            <div className="mt-1 text-xs text-white/55">
              Campos essenciais para cobrança automática.
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold text-white/60">Nome</div>
                      <input
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                        placeholder="Ex: João Silva"
                        {...register("nome", { required: true })}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white/60">
                        Telefone
                      </div>
                      <input
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                        placeholder="DDD + número"
                        {...register("telefone")}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold text-white/60">Valor</div>
                      <input
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                        placeholder="Ex: 149.90"
                        {...register("valor")}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white/60">
                        Vencimento
                      </div>
                      <input
                        type="date"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
                        {...register("vencimento")}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold text-white/60">
                        Chave PIX (recebimento)
                      </div>
                      <div className="mt-1 text-[11px] font-semibold text-white/45">
                        Chave que será enviada ao cliente para pagamento.
                      </div>
                      <input
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                        placeholder="Sua chave PIX (CPF, email, telefone ou aleatória)"
                        {...register("pix_key")}
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
                        <option className="bg-[#070A10] text-white" value="ativo">
                          ativo
                        </option>
                        <option className="bg-[#070A10] text-white" value="inativo">
                          inativo
                        </option>
                        <option
                          className="bg-[#070A10] text-white"
                          value="inadimplente"
                        >
                          inadimplente
                        </option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-white/60">
                      Observações
                    </div>
                    <textarea
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                      placeholder="Notas internas"
                      {...register("observacoes")}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || isPending}
                    className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
                  >
                    {editing ? "Salvar alterações" : "Criar cliente"}
                  </button>
        </form>
      </AppModal>
    </div>
  );
}
