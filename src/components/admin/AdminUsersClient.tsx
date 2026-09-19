"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { AlertTriangle, Eye, EyeOff, Key, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { isProtectedAdminOrUserEmail } from "@/lib/auth/admin";
import { normalizePlan, planLabel, type PlanKey } from "@/lib/plans";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import {
  createUserAdminAction,
  deleteUserAdminAction,
  resetPasswordAdminAction,
  updateUserAdminAction,
} from "@/app/admin/usuarios/actions";

export type AdminUserRow = {
  id: string;
  email: string;
  nome: string;
  email_confirmado: boolean;
  plano: string;
  assinatura_status: string;
  vencimento: string | null;
  criado_em: string | null;
};

type EditValues = {
  id: string;
  nome: string;
  plano: PlanKey;
  assinatura_status: "ativo" | "cancelado";
  vencimento?: string;
};

type PasswordValues = {
  id: string;
  password: string;
};

type CreateValues = {
  nome: string;
  email: string;
  password: string;
};

function dateBR(v: string | null) {
  if (!v) return "-";
  const s = v.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);
}

function normalizeStatus(v?: string | null): "ativo" | "cancelado" {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "ativo" || s === "cancelado") return s;
  if (s === "active") return "ativo";
  if (s === "trial") return "ativo";
  if (s === "past_due") return "cancelado";
  if (s === "canceled") return "cancelado";
  if (s === "pausado") return "cancelado";
  return "ativo";
}

function statusLabel(v: "ativo" | "cancelado") {
  if (v === "ativo") return "Ativo";
  return "Cancelado";
}

function statusClass(v: "ativo" | "cancelado") {
  if (v === "ativo") return "bg-emerald-600 text-[rgb(255,255,255)]";
  return "bg-rose-600 text-[rgb(255,255,255)]";
}

export function AdminUsersClient({ initial }: { initial: AdminUserRow[] }) {
  const pageSize = 5;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const vencimentoInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminUserRow[]>(initial);
  const [page, setPage] = useState(1);
  const [openEdit, setOpenEdit] = useState(false);
  const [openPassword, setOpenPassword] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  const isSelfAdmin = (email: string) => isProtectedAdminOrUserEmail(email);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const emailOk = r.email.toLowerCase().includes(q);
      const nomeOk = r.nome.toLowerCase().includes(q);
      return emailOk || nomeOk;
    });
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

  useEffect(() => {
    const updateOverflow = () => {
      const element = tableScrollRef.current;
      if (!element) {
        setHasHorizontalOverflow(false);
        return;
      }
      const contentWidth = element.firstElementChild instanceof HTMLElement
        ? element.firstElementChild.scrollWidth
        : element.scrollWidth;
      setHasHorizontalOverflow(contentWidth - element.clientWidth > 24);
    };

    updateOverflow();
    window.addEventListener("resize", updateOverflow);

    return () => {
      window.removeEventListener("resize", updateOverflow);
    };
  }, [filtered.length, page, safePage]);

  const editForm = useForm<EditValues>({
    defaultValues: {
      id: "",
      nome: "",
      plano: "teste",
      assinatura_status: "ativo",
      vencimento: "",
    },
  });

  const passForm = useForm<PasswordValues>({
    defaultValues: { id: "", password: "" },
  });
  const createForm = useForm<CreateValues>({
    defaultValues: { nome: "", email: "", password: "" },
  });
  const { ref: vencimentoFieldRef, ...vencimentoFieldProps } = editForm.register("vencimento");

  const refresh = () => {
    startTransition(async () => {
      const r = await fetch("/admin/usuarios/data", { cache: "no-store" });
      if (!r.ok) {
        modalToast.error("Falha ao carregar usuários.");
        return;
      }
      const json = (await r.json()) as AdminUserRow[];
      setRows(json);
    });
  };

  const closeEdit = () => {
    setOpenEdit(false);
    setEditing(null);
    editForm.reset({
      id: "",
      nome: "",
      plano: "teste",
      assinatura_status: "ativo",
      vencimento: "",
    });
  };

  const closePassword = () => {
    setOpenPassword(false);
    setEditing(null);
    setShowPassword(false);
    passForm.reset({ id: "", password: "" });
  };

  const closeDelete = () => {
    setOpenDelete(false);
    setDeleting(null);
  };

  const closeCreate = () => {
    setOpenCreate(false);
    setShowNewPassword(false);
    createForm.reset({ nome: "", email: "", password: "" });
  };

  const openVencimentoPicker = () => {
    vencimentoInputRef.current?.showPicker?.();
  };

  const openEditModal = (row: AdminUserRow) => {
    setEditing(row);
    setOpenEdit(true);
    const plan = normalizePlan(row.plano);
    editForm.reset({
      id: row.id,
      nome: row.nome === "-" ? "" : row.nome,
      plano: plan,
      assinatura_status: normalizeStatus(row.assinatura_status),
      vencimento: plan === "vitalicio" ? "" : (row.vencimento ?? ""),
    });
  };

  const openPasswordModal = (row: AdminUserRow) => {
    setEditing(row);
    setOpenPassword(true);
    setShowPassword(false);
    passForm.reset({ id: row.id, password: "" });
  };

  const openDeleteModal = (row: AdminUserRow) => {
    setDeleting(row);
    setOpenDelete(true);
  };

  const saveCreate = createForm.handleSubmit(async (values) => {
    const res = await createUserAdminAction({
      nome: values.nome,
      email: values.email,
      password: values.password,
    });
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao criar.");
      return;
    }
    modalToast.success("Usuário criado.");
    closeCreate();
    refresh();
  }, (errors) => {
    if (errors.password?.message) {
      modalToast.error(String(errors.password.message));
      return;
    }
    if (errors.email?.message) {
      modalToast.error(String(errors.email.message));
      return;
    }
    modalToast.warning("Confira os campos.");
  });

  const saveEdit = editForm.handleSubmit(async (values) => {
    const res = await updateUserAdminAction({
      id: values.id,
      nome: values.nome,
      plano: values.plano,
      assinatura_status: values.assinatura_status,
      vencimento:
        values.plano === "vitalicio" ? undefined : values.vencimento || undefined,
    });

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    modalToast.success("Usuário atualizado.");
    closeEdit();
    refresh();
  });

  const savePassword = passForm.handleSubmit(async (values) => {
    const res = await resetPasswordAdminAction(values);
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao redefinir.");
      return;
    }
    modalToast.success("Senha redefinida.");
    closePassword();
  }, (errors) => {
    if (errors.password?.message) {
      modalToast.error(String(errors.password.message));
      return;
    }
    modalToast.warning("Confira os campos.");
  });

  const remove = (row: AdminUserRow) => {
    startTransition(async () => {
      const res = await deleteUserAdminAction(row.id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      modalToast.success("Conta excluída.");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    });
  };

  const currentPlan = editForm.watch("plano");
  useEffect(() => {
    if (currentPlan !== "vitalicio") return;
    editForm.setValue("vencimento", "");
  }, [currentPlan, editForm]);

  return (
    <div>
      <div className="flex flex-col gap-4 min-[1201px]:flex-row min-[1201px]:items-end min-[1201px]:justify-between">
        <div className="min-w-0">
          <h1 className="mt-0 text-xl font-bold tracking-tight whitespace-nowrap max-[420px]:whitespace-normal sm:text-2xl min-[1201px]:text-[1.6rem] leading-[1.15] text-[var(--app-text-85)]">
            Usuários
          </h1>
          <div className="mt-2 truncate text-sm text-[var(--app-text-60)]">
            Gestão global de contas e assinaturas.
          </div>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 min-[1201px]:w-auto min-[1201px]:flex-row min-[1201px]:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
            className="w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 min-[1201px]:w-[360px]"
          />
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-2.5 text-[0.95rem] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] min-[1201px]:w-auto"
          >
            <UserPlus className="h-4 w-4" />
            Criar usuário
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-10 text-center text-sm text-[var(--app-text-60)] shadow-none">
          Nenhum usuário encontrado.
        </div>
      ) : (
        <>
          <div className="grid w-full gap-4 py-3 min-[1201px]:hidden">
            {pagedRows.map((r) => {
              const displayVenc =
                normalizePlan(r.plano) === "vitalicio"
                  ? "-"
                  : normalizePlan(r.plano) === "teste" &&
                    normalizeStatus(r.assinatura_status) === "cancelado" &&
                    r.vencimento &&
                    r.vencimento < today
                    ? "Expirado"
                    : dateBR(r.vencimento);
              return (
                <div
                  key={r.id}
                  className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none"
                >
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[17px] font-semibold tracking-tight text-[var(--app-text-85)]" title={r.nome}>
                          {r.nome}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-[var(--app-text-55)]">
                          {r.email}
                        </div>
                      </div>
                      {r.assinatura_status !== "-" ? (
                        <span
                          className={`inline-flex shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${statusClass(normalizeStatus(r.assinatura_status))}`}
                        >
                          {statusLabel(normalizeStatus(r.assinatura_status))}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] p-3 shadow-none">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                            Plano
                          </div>
                          <div className="mt-1 truncate text-[15px] font-semibold text-[var(--app-text-85)]">
                            {planLabel(normalizePlan(r.plano))}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] p-3 shadow-none">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                            Vencimento
                          </div>
                          <div className="mt-1 text-[15px] font-semibold text-[var(--app-text-85)]">
                            {displayVenc}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-[var(--app-border)] pt-4">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                        Ações
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {!isSelfAdmin(r.email) ? (
                          <button
                            onClick={() => openEditModal(r)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[13px] font-semibold text-[var(--app-text-75)] hover:bg-[var(--app-hover)] transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                            Editar
                          </button>
                        ) : (
                          <div className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-transparent text-transparent" aria-hidden />
                        )}
                        <button
                          onClick={() => openPasswordModal(r)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[13px] font-semibold text-[var(--app-text-75)] hover:bg-[var(--app-hover)] transition-colors"
                        >
                          <Key className="h-4 w-4" />
                          Senha
                        </button>
                        {!isSelfAdmin(r.email) ? (
                          <button
                            onClick={() => openDeleteModal(r)}
                            disabled={isPending}
                            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[13px] font-semibold text-[var(--app-text-75)] hover:bg-[var(--app-hover)] transition-colors disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" />
                            Excluir
                          </button>
                        ) : (
                          <div className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-transparent text-transparent" aria-hidden />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filtered.length > pageSize ? (
              <div className="grid grid-cols-3 items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-3 shadow-none">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-solid-surface)]"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  aria-label="Página anterior"
                >
                  {"<"}
                </button>
                <div className="text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                  {safePage} / {totalPages}
                </div>
                <button
                  type="button"
                  className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-solid-surface)]"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  aria-label="Próxima página"
                >
                  {">"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="hidden min-[1201px]:block mt-6 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none">
            <div className="overflow-x-auto">
              <div className="min-w-[1080px] min-[1201px]:min-w-0">
                <div className="grid grid-cols-14 gap-3 border-b border-[var(--app-border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                  <div className="col-span-5">Usuário</div>
                  <div className="col-span-2 text-center">Plano</div>
                  <div className="col-span-2 text-center">Status</div>
                  <div className="col-span-2 text-center">Venc.</div>
                  <div className="col-span-3 text-right">Ações</div>
                </div>

                <div className="divide-y divide-[var(--app-border)]">
                  {pagedRows.map((r) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-14 items-center gap-3 px-4 py-3 text-sm text-[var(--app-text-85)] hover:bg-[var(--app-hover)]/60 transition-colors"
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="truncate text-[17px] font-semibold tracking-tight text-[var(--app-text-85)]">{r.nome}</div>
                        <div className="mt-1 truncate text-[11px] text-[var(--app-text-55)]">{r.email}</div>
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <span className="inline-flex rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--app-text-75)]">
                          {planLabel(normalizePlan(r.plano))}
                        </span>
                      </div>
                      <div className="col-span-2 flex justify-center">
                        {r.assinatura_status === "-" ? (
                          <span className="text-[13px] text-[var(--app-text-60)]">-</span>
                        ) : (
                          <span
                            className={`inline-flex shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${statusClass(normalizeStatus(r.assinatura_status))}`}
                          >
                            {statusLabel(normalizeStatus(r.assinatura_status))}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 text-center text-[14px] font-medium text-[var(--app-text-65)]">
                        {normalizePlan(r.plano) === "vitalicio"
                          ? "-"
                          : normalizePlan(r.plano) === "teste" &&
                        normalizeStatus(r.assinatura_status) === "cancelado" &&
                        r.vencimento &&
                        r.vencimento < today
                            ? "Expirado"
                            : dateBR(r.vencimento)}
                      </div>
                      <div className="col-span-3 flex justify-end gap-2">
                        {!isSelfAdmin(r.email) ? (
                          <button
                            onClick={() => openEditModal(r)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        ) : null}
                        <button
                          onClick={() => openPasswordModal(r)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] transition-colors"
                          title="Redefinir senha"
                        >
                          <Key className="h-4 w-4" />
                        </button>
                        {!isSelfAdmin(r.email) ? (
                          <button
                            onClick={() => openDeleteModal(r)}
                            disabled={isPending}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] transition-colors disabled:opacity-60"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {filtered.length > pageSize ? (
              <div className="grid grid-cols-3 items-center border-t border-[var(--app-border)] px-4 py-3">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-solid-surface)]"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  aria-label="Página anterior"
                >
                  {"<"}
                </button>
                <div className="text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                  {safePage} / {totalPages}
                </div>
                <button
                  type="button"
                  className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-solid-surface)]"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  aria-label="Próxima página"
                >
                  {">"}
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}


      <AppModal open={openCreate} onClose={closeCreate} size="md" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold tracking-tight text-[var(--app-text-85)]">Criar usuário</div>
            <div className="mt-1 text-[13px] text-[var(--app-text-55)]">Plano teste (3 meses) com acesso ao painel.</div>
          </div>
          <button
            onClick={closeCreate}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-65)] hover:bg-[var(--app-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={saveCreate} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--app-text-60)]">Nome</label>
            <input
              type="text"
              className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0"
              placeholder="Nome do usuário"
              {...createForm.register("nome", { required: true, minLength: 2 })}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--app-text-60)]">E-mail</label>
            <input
              type="email"
              className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0"
              placeholder="voce@email.com"
              {...createForm.register("email", {
                required: "Informe o e-mail.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Informe um e-mail válido.",
                },
              })}
            />
            {createForm.formState.errors.email?.message ? (
              <div className="mt-2 text-xs font-semibold text-[rgb(225,29,72)]">
                {String(createForm.formState.errors.email.message)}
              </div>
            ) : null}
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--app-text-60)]">Senha</label>
            <div className="relative mt-2">
              <input
                type={showNewPassword ? "text" : "password"}
                className="w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 pr-12 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0"
                placeholder="Mínimo 8 caracteres"
                {...createForm.register("password", {
                  required: true,
                  minLength: { value: 8, message: "A senha deve ter no mínimo 8 caracteres." },
                })}
              />
              <button
                type="button"
                aria-label={showNewPassword ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-65)] hover:bg-[var(--app-hover)]"
              >
                {showNewPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {createForm.formState.errors.password?.message ? (
              <div className="mt-2 text-xs font-semibold text-[rgb(225,29,72)]">
                {String(createForm.formState.errors.password.message)}
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={createForm.formState.isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-btn-primary-bg)] px-6 py-3 text-[0.95rem] font-semibold text-[var(--app-btn-primary-fg)] hover:bg-[var(--app-btn-primary-bg-hover)] disabled:opacity-60 disabled:hover:bg-[var(--app-btn-primary-bg)]"
          >
            {createForm.formState.isSubmitting ? "Criando..." : "Criar usuário"}
          </button>
        </form>
      </AppModal>

      <AppModal open={openEdit} onClose={closeEdit} size="md" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold tracking-tight text-[var(--app-text-85)]">Editar usuário</div>
            <div className="mt-1 text-[13px] text-[var(--app-text-55)]">{editing?.email ?? ""}</div>
          </div>
          <button
            onClick={closeEdit}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-65)] hover:bg-[var(--app-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={saveEdit} className="mt-6 space-y-4">
          <input type="hidden" {...editForm.register("id", { required: true })} />
          <div>
            <label className="text-xs font-semibold text-[var(--app-text-60)]">Nome</label>
            <input
              className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0"
              placeholder="Nome do usuário"
              {...editForm.register("nome", { required: true })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[var(--app-text-60)]">Plano</label>
              <select
                className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none focus:border-[var(--app-accent-color)]/35 focus:ring-0 [color-scheme:light]"
                {...editForm.register("plano", { required: true })}
              >
                <option value="teste">
                  Teste
                </option>
                <option value="basico">
                  Básico
                </option>
                <option value="pro">
                  Pro
                </option>
                <option value="vitalicio">
                  Vitalício
                </option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--app-text-60)]">Status</label>
              <select
                className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none focus:border-[var(--app-accent-color)]/35 focus:ring-0 [color-scheme:light]"
                {...editForm.register("assinatura_status", { required: true })}
              >
                <option value="ativo">
                  Ativo
                </option>
                <option value="cancelado">
                  Cancelado
                </option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--app-text-60)]">Vencimento</label>
            {currentPlan === "vitalicio" ? (
              <div className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-2.5 text-[0.95rem] font-semibold text-[var(--app-text-75)]">
                -
              </div>
            ) : (
              <input
                ref={(element) => {
                  vencimentoFieldRef(element);
                  vencimentoInputRef.current = element;
                }}
                type="date"
                className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0"
                onClick={openVencimentoPicker}
                onFocus={openVencimentoPicker}
                {...vencimentoFieldProps}
              />
            )}
          </div>

          <button
            type="submit"
            disabled={editForm.formState.isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-btn-primary-bg)] px-6 py-3 text-[0.95rem] font-semibold text-[var(--app-btn-primary-fg)] hover:bg-[var(--app-btn-primary-bg-hover)] disabled:opacity-60 disabled:hover:bg-[var(--app-btn-primary-bg)]"
          >
            {editForm.formState.isSubmitting ? "Salvando..." : "Salvar alterações"}
          </button>
        </form>
      </AppModal>

      <AppModal open={openPassword} onClose={closePassword} size="md" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold tracking-tight text-[var(--app-text-85)]">Redefinir senha</div>
            <div className="mt-1 text-[13px] text-[var(--app-text-55)]">{editing?.email ?? ""}</div>
          </div>
          <button
            onClick={closePassword}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-65)] hover:bg-[var(--app-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={savePassword} className="mt-6 space-y-4">
          <input type="hidden" {...passForm.register("id", { required: true })} />
          <div>
            <label className="text-xs font-semibold text-[var(--app-text-60)]">Nova senha</label>
            <div className="relative mt-2">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full rounded-xl border border-[var(--app-border)] bg-white px-4 py-2.5 pr-12 text-[0.95rem] text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0"
                placeholder="Mínimo 8 caracteres"
                {...passForm.register("password", {
                  required: true,
                  minLength: { value: 8, message: "A senha deve ter no mínimo 8 caracteres." },
                })}
              />
              <button
                type="button"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-65)] hover:bg-[var(--app-hover)]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {passForm.formState.errors.password?.message ? (
              <div className="mt-2 text-xs font-semibold text-[rgb(225,29,72)]">
                {String(passForm.formState.errors.password.message)}
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={passForm.formState.isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-btn-primary-bg)] px-6 py-3 text-[0.95rem] font-semibold text-[var(--app-btn-primary-fg)] hover:bg-[var(--app-btn-primary-bg-hover)] disabled:opacity-60 disabled:hover:bg-[var(--app-btn-primary-bg)]"
          >
            {passForm.formState.isSubmitting ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </AppModal>

      <AppModal
        open={openDelete}
        onClose={closeDelete}
        size="md"
        zIndexClass="z-[100]"
        panelClassName="max-w-md p-5 sm:p-5"
      >
        <div className="flex items-start gap-4">
          <div className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-solid-surface-2)] text-[var(--app-text-75)]">
            <AlertTriangle className="h-8 w-8" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold tracking-tight text-[var(--app-text-85)]">Excluir usuário</div>
            <div className="mt-4 text-[15px] leading-relaxed text-[var(--app-text-75)]">
              Tem certeza que deseja excluir o usuário "{deleting?.nome ?? deleting?.email ?? ""}"?
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={closeDelete}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-6 py-3 text-[0.95rem] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60 disabled:hover:bg-[var(--app-solid-surface)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isPending || !deleting}
            onClick={() => {
              if (!deleting) return;
              closeDelete();
              remove(deleting);
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-6 py-3 text-[0.95rem] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60 disabled:hover:bg-[var(--app-solid-surface)]"
          >
            Excluir
          </button>
        </div>
      </AppModal>
    </div>
  );
}
