"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import {
  createTemplateAction,
  deleteTemplateAction,
  updateTemplateAction,
} from "@/app/app/mensagens/actions";

export type TemplateRow = {
  id: string;
  nome: string;
  conteudo: string;
  created_at: string;
};

type FormValues = {
  id?: string;
  nome: string;
  conteudo: string;
};

export function TemplatesClient({ initial }: { initial: TemplateRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<TemplateRow[]>(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.nome.toLowerCase().includes(q) || r.conteudo.toLowerCase().includes(q)
    );
  }, [query, rows]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { nome: "", conteudo: "" },
  });

  const close = () => {
    setOpen(false);
    setEditing(null);
    reset({ nome: "", conteudo: "" });
  };

  const openCreate = () => {
    close();
    setOpen(true);
  };

  const openEdit = (row: TemplateRow) => {
    setEditing(row);
    setOpen(true);
    reset({ id: row.id, nome: row.nome, conteudo: row.conteudo });
  };

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      ...(values.id ? { id: values.id } : {}),
      nome: values.nome,
      conteudo: values.conteudo,
    };

    const res = editing
      ? await updateTemplateAction(payload)
      : await createTemplateAction(payload);

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    modalToast.success(editing ? "Template atualizado." : "Template criado.");

    startTransition(async () => {
      const r = await fetch("/app/mensagens/data", { cache: "no-store" });
      const json = (await r.json()) as TemplateRow[];
      setRows(json);
      close();
    });
  });

  const remove = async (row: TemplateRow) => {
    const confirmed = await modalToast.confirm(
      `Tem certeza que deseja excluir o template "${row.nome}"?`,
      { title: "Excluir template", confirmText: "Excluir", cancelText: "Cancelar" },
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await deleteTemplateAction(row.id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      modalToast.success("Template excluído.");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Templates
          </h1>
          <div className="mt-2 text-sm text-white/60">
            Use variáveis: {"{nome}"} {"{valor}"} {"{vencimento}"} {"{pix}"}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar template..."
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
          />
          <button
            onClick={openCreate}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo template
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 sm:hidden">
          Role para o lado.
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-3">Nome</div>
              <div className="col-span-8">Conteúdo</div>
              <div className="col-span-1 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum template encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-3 font-semibold">{r.nome}</div>
                    <div className="col-span-8 line-clamp-2 text-white/60">
                      {r.conteudo}
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
                        onClick={() => remove(r)}
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
            <div className="text-sm font-semibold text-white/90">
              {editing ? "Editar template" : "Novo template"}
            </div>
            <div className="mt-1 text-xs text-white/55">
              Monte sua mensagem com variáveis e PIX.
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
                <div className="text-xs font-semibold text-white/60">Nome</div>
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  placeholder="Ex: Cobrança amigável"
                  {...register("nome", { required: true })}
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-white/60">
                  Conteúdo
                </div>
                <textarea
                  rows={7}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  placeholder={
                    "Olá {nome}, tudo bem?\n\nSeu pagamento de {valor} vence em {vencimento}.\nPIX: {pix}\n\nObrigado!"
                  }
                  {...register("conteudo", { required: true })}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || isPending}
                className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
              >
                {editing ? "Salvar alterações" : "Criar template"}
              </button>
        </form>
      </AppModal>
    </div>
  );
}
