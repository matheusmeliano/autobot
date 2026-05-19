"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Key, Pencil, Trash2, X } from "lucide-react";
import { normalizePlan, planLabel, type PlanKey } from "@/lib/plans";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import {
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

export function AdminUsersClient({ initial }: { initial: AdminUserRow[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminUserRow[]>(initial);
  const [openEdit, setOpenEdit] = useState(false);
  const [openPassword, setOpenPassword] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const isSelfAdmin = (email: string) =>
    email.toLowerCase() === "heybrotherscolaboradores@gmail.com";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.email.toLowerCase().includes(q) || r.nome.toLowerCase().includes(q)
      );
    });
  }, [query, rows]);

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
    passForm.reset({ id: "", password: "" });
  };

  const closeDelete = () => {
    setOpenDelete(false);
    setDeleting(null);
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
    passForm.reset({ id: row.id, password: "" });
  };

  const openDeleteModal = (row: AdminUserRow) => {
    setDeleting(row);
    setOpenDelete(true);
  };

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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
            Usuários
          </h1>
          <div className="mt-2 truncate text-sm text-white/60">
            Gestão global de contas e assinaturas.
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome ou email..."
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20 min-[1201px]:w-[360px]"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 min-[1201px]:hidden">
          Role para o lado.
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[820px] min-[1201px]:min-w-0">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-4">Usuário</div>
              <div className="col-span-2 text-center">Plano</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-center">Vencimento</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum usuário encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-4 min-w-0">
                      <div className="truncate font-semibold">{r.nome}</div>
                      <div className="mt-1 truncate text-xs text-white/50">{r.email}</div>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-white/70">
                        {planLabel(normalizePlan(r.plano))}
                      </span>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      {r.assinatura_status === "-" ? (
                        <span className="text-white/60">-</span>
                      ) : (
                        <span
                          className={[
                            "inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold",
                            normalizeStatus(r.assinatura_status) === "ativo"
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                              : "border-rose-400/30 bg-rose-400/10 text-rose-200",
                          ].join(" ")}
                        >
                          {statusLabel(normalizeStatus(r.assinatura_status))}
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-center text-white/60">
                      {normalizePlan(r.plano) === "vitalicio"
                        ? "-"
                        : normalizePlan(r.plano) === "teste" &&
                      normalizeStatus(r.assinatura_status) === "cancelado" &&
                      r.vencimento &&
                      r.vencimento < today
                          ? "Expirado"
                          : dateBR(r.vencimento)}
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      {!isSelfAdmin(r.email) ? (
                        <button
                          onClick={() => openEditModal(r)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06]"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => openPasswordModal(r)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06]"
                        title="Redefinir senha"
                      >
                        <Key className="h-4 w-4" />
                      </button>
                      {!isSelfAdmin(r.email) ? (
                        <button
                          onClick={() => openDeleteModal(r)}
                          disabled={isPending}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06] disabled:opacity-60"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AppModal open={openEdit} onClose={closeEdit} size="md" zIndexClass="z-[100]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">Editar usuário</div>
            <div className="mt-1 text-xs text-white/55">{editing?.email ?? ""}</div>
          </div>
          <button
            onClick={closeEdit}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={saveEdit} className="mt-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-white/60">Nome</label>
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              placeholder="Nome do usuário"
              {...editForm.register("nome", { required: true })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-white/60">Plano</label>
              <select
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark]"
                {...editForm.register("plano", { required: true })}
              >
                <option value="teste" className="bg-[#070A10] text-white">
                  Teste
                </option>
                <option value="basico" className="bg-[#070A10] text-white">
                  Básico
                </option>
                <option value="pro" className="bg-[#070A10] text-white">
                  Pro
                </option>
                <option value="vitalicio" className="bg-[#070A10] text-white">
                  Vitalício
                </option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/60">Status</label>
              <select
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark]"
                {...editForm.register("assinatura_status", { required: true })}
              >
                <option value="ativo" className="bg-[#070A10] text-white">
                  Ativo
                </option>
                <option value="cancelado" className="bg-[#070A10] text-white">
                  Cancelado
                </option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-white/60">Vencimento</label>
            {currentPlan === "vitalicio" ? (
              <div className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/70">
                -
              </div>
            ) : (
              <input
                type="date"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                {...editForm.register("vencimento")}
              />
            )}
          </div>

          <button
            type="submit"
            disabled={editForm.formState.isSubmitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
          >
            {editForm.formState.isSubmitting ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </AppModal>

      <AppModal open={openPassword} onClose={closePassword} size="md" zIndexClass="z-[100]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">Redefinir senha</div>
            <div className="mt-1 text-xs text-white/55">{editing?.email ?? ""}</div>
          </div>
          <button
            onClick={closePassword}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={savePassword} className="mt-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-white/60">Nova senha</label>
            <input
              type="password"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              placeholder="Mínimo 8 caracteres"
              {...passForm.register("password", { required: true, minLength: 8 })}
            />
          </div>

          <button
            type="submit"
            disabled={passForm.formState.isSubmitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">Excluir usuário</div>
            <div className="mt-1 truncate text-xs text-white/55">{deleting?.email ?? ""}</div>
          </div>
          <button
            onClick={closeDelete}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 text-sm text-white/80">
          Você tem certeza que deseja excluir esse usuário?
        </div>
        <div className="mt-1 text-xs text-white/55">Essa ação não pode ser desfeita.</div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={closeDelete}
            className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
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
            className="inline-flex w-full items-center justify-center rounded-xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-500/90 disabled:opacity-60"
          >
            Excluir
          </button>
        </div>
      </AppModal>
    </div>
  );
}
