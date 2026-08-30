"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  const pageSize = 5;
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<TemplateRow[]>(initial);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pagedRows = useMemo(() => {
    if (!filtered.length) return [];
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
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

    close();
    const toastId = modalToast.success(editing ? "Template atualizado." : "Template criado.");
    await modalToast.wait(toastId);
    window.location.reload();
  });

  const remove = async (row: TemplateRow) => {
    const confirmed = await modalToast.confirm(
      `Tem certeza que deseja excluir o template "${row.nome}"?`,
      { title: "Excluir template", confirmText: "Excluir", cancelText: "Cancelar" },
    );
    if (!confirmed) return;
    const res = await deleteTemplateAction(row.id);
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao excluir.");
      return;
    }
    const toastId = modalToast.success("Template excluído.");
    await modalToast.wait(toastId);
    window.location.reload();
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Templates
          </h1>
          <div className="mt-2 text-sm text-[var(--app-text-60)]">
            Use variáveis: {"{nome}"} {"{valor}"} {"{vencimento}"} {"{pix}"} {"{pix_link}"}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar template..."
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)] focus:border-[var(--app-border)]"
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

      <div className="mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--app-text-60)]">
            Nenhum template encontrado.
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-3 min-[1201px]:hidden">
              {pagedRows.map((r) => (
                <div
                  key={r.id}
                  className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                      {r.nome}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                      Template
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                      Conteúdo
                    </div>
                    <div className="mt-1 whitespace-pre-line text-sm text-[var(--app-text-85)] line-clamp-4">
                      {r.conteudo}
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                      Ações
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openEdit(r)}
                        className="inline-flex min-h-[40px] w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => remove(r)}
                        disabled={isPending}
                        className="inline-flex min-h-[40px] w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden min-[1201px]:block">
              <div className="grid grid-cols-12 gap-3 border-b border-[var(--app-border)] px-4 py-3 text-xs font-semibold text-[var(--app-text-55)]">
                <div className="col-span-3 text-center">Nome</div>
                <div className="col-span-7 text-center">Conteúdo</div>
                <div className="col-span-2 text-right">Ações</div>
              </div>

              <div className="divide-y divide-[var(--app-border)]">
                {pagedRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-[var(--app-text-85)]"
                  >
                    <div
                      className="col-span-3 truncate text-center font-semibold"
                      title={r.nome}
                    >
                      {r.nome}
                    </div>
                    <div className="col-span-7 min-w-0 text-center text-[var(--app-text-70)] line-clamp-2">
                      {r.conteudo}
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(r)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(r)}
                        disabled={isPending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-60"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {filtered.length > pageSize ? (
          <div className="grid grid-cols-3 items-center border-t border-[var(--app-border)] px-4 py-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-card)]"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Página anterior"
            >
              {"<"}
            </button>
            <div className="text-center text-xs font-semibold text-[var(--app-text-60)]">
              {safePage} / {totalPages}
            </div>
            <button
              type="button"
              className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-card)]"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Próxima página"
            >
              {">"}
            </button>
          </div>
        ) : null}
      </div>

      <AppModal open={open} onClose={close} size="lg" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-text-85)]">
              {editing ? "Editar template" : "Novo template"}
            </div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">
              Monte sua mensagem com variáveis, PIX e link para copiar o PIX.
            </div>
          </div>
          <button
            onClick={close}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
              <div>
                <div className="text-xs font-semibold text-[var(--app-text-60)]">Nome</div>
                <input
                  className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)] focus:border-[var(--app-border)]"
                  placeholder="Ex: Cobrança amigável"
                  {...register("nome", {
                    validate: (value) =>
                      String(value ?? "").trim().length >= 2 ||
                      "Informe um nome com pelo menos 2 caracteres.",
                  })}
                />
                {errors.nome?.message ? (
                  <div className="mt-2 text-xs font-medium text-rose-300">{errors.nome.message}</div>
                ) : null}
              </div>

              <div>
                <div className="text-xs font-semibold text-[var(--app-text-60)]">
                  Conteúdo
                </div>
                <textarea
                  rows={7}
                  className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)] focus:border-[var(--app-border)]"
                  placeholder={
                    "Ola {nome}, tudo bem?\n\nSeu pagamento de {valor} vence em {vencimento}.\nPara copiar a chave PIX, acesse: {pix_link}\n\nObrigado!"
                  }
                  {...register("conteudo", {
                    validate: (value) =>
                      String(value ?? "").trim().length > 0 || "Informe o conteúdo do template.",
                  })}
                />
                {errors.conteudo?.message ? (
                  <div className="mt-2 text-xs font-medium text-rose-300">
                    {errors.conteudo.message}
                  </div>
                ) : null}
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
