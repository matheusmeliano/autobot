"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, Key, Pencil, Phone as PhoneIcon, Trash2, X } from "lucide-react";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { normalizePlan, planLabel, type PlanKey } from "@/lib/plans";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import {
  deleteUserAdminAction,
  resetPasswordAdminAction,
  updateUserAdminAction,
} from "@/app/admin/usuarios/actions";
import { setWhatsAppInstanceDisplayNameAdminAction } from "@/app/app/whatsapp/actions";

type AdminUserWhatsAppInfo = {
  instance_id: string | null;
  display_name: string | null;
  phone: string | null;
  status: string | null;
} | null;

export type AdminUserRow = {
  id: string;
  email: string;
  nome: string;
  email_confirmado: boolean;
  plano: string;
  assinatura_status: string;
  vencimento: string | null;
  criado_em: string | null;
  whatsapp?: AdminUserWhatsAppInfo;
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

type WhatsAppDisplayNameValues = {
  user_id: string;
  display_name: string;
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

function formatWhatsAppPhone(value: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "";
  if (digits.startsWith("55") && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.startsWith("55") && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.startsWith("1") && digits.length === 11) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length >= 7 && digits.length <= 15) {
    const groups: string[] = [];
    let remaining = digits;
    if (remaining.length > 10) {
      const ccLen = remaining.length >= 12 ? 2 : remaining.length >= 11 ? 1 : 2;
      groups.push(`+${remaining.slice(0, ccLen)}`);
      remaining = remaining.slice(ccLen);
    } else {
      groups.push("+");
    }
    while (remaining.length > 4) {
      groups.push(remaining.slice(0, 3));
      remaining = remaining.slice(3);
    }
    if (remaining) groups.push(remaining);
    return groups.join(" ").replace("+ ", "+");
  }
  return "";
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
  const [openWhatsApp, setOpenWhatsApp] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const [whatsAppRow, setWhatsAppRow] = useState<AdminUserRow | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  const isSelfAdmin = (email: string) => isGlobalAdminEmail(email);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const emailOk = r.email.toLowerCase().includes(q);
      const nomeOk = r.nome.toLowerCase().includes(q);
      const waDn = (r.whatsapp?.display_name ?? "").toLowerCase();
      const waPhone = (r.whatsapp?.phone ?? "").toLowerCase();
      const waInstance = (r.whatsapp?.instance_id ?? "").toLowerCase();
      const waOk = waDn.includes(q) || waPhone.includes(q) || waInstance.includes(q);
      return emailOk || nomeOk || waOk;
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
  const whatsAppForm = useForm<WhatsAppDisplayNameValues>({
    defaultValues: { user_id: "", display_name: "" },
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

  const closeWhatsApp = () => {
    setOpenWhatsApp(false);
    setWhatsAppRow(null);
    whatsAppForm.reset({ user_id: "", display_name: "" });
  };

  const openWhatsAppModal = (row: AdminUserRow) => {
    setWhatsAppRow(row);
    setOpenWhatsApp(true);
    whatsAppForm.reset({
      user_id: row.id,
      display_name: row.whatsapp?.display_name ?? "",
    });
  };

  const saveWhatsApp = whatsAppForm.handleSubmit(async (values) => {
    const res = await setWhatsAppInstanceDisplayNameAdminAction({
      user_id: values.user_id,
      display_name: values.display_name.trim() || null,
    });
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar apelido.");
      return;
    }
    modalToast.success("Apelido do WhatsApp atualizado.");
    const safeDisplayName = String(res.display_name ?? "").trim() || null;
    const safePhone = String(res.phone ?? "").trim() || null;
    const safeInstanceId = String(res.instance_id ?? "").trim() || null;
    setRows((prev) =>
      prev.map((r) =>
        r.id === values.user_id
          ? {
              ...r,
              whatsapp: {
                instance_id: (r.whatsapp?.instance_id ?? safeInstanceId) || null,
                display_name: safeDisplayName,
                phone: (r.whatsapp?.phone ?? safePhone) || null,
                status: r.whatsapp?.status ?? null,
              },
            }
          : r,
      ),
    );
    closeWhatsApp();
  });

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
        {hasHorizontalOverflow ? (
          <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 min-[1201px]:hidden">
            Role para o lado.
          </div>
        ) : null}
        <div ref={tableScrollRef} className="overflow-x-auto">
          <div className="min-w-[1080px] min-[1201px]:min-w-0">
            <div className="grid grid-cols-14 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-3">Usuário</div>
              <div className="col-span-4">WhatsApp</div>
              <div className="col-span-2 text-center">Plano</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-1 text-center">Venc.</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum usuário encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {pagedRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-14 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-3 min-w-0">
                      <div className="truncate font-semibold">{r.nome}</div>
                      <div className="mt-1 truncate text-xs text-white/50">{r.email}</div>
                    </div>
                    <div className="col-span-4 min-w-0">
                      {r.whatsapp?.instance_id || r.whatsapp?.phone || r.whatsapp?.display_name ? (
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold leading-relaxed text-[var(--app-text-85)]">
                              {r.whatsapp.status === "disconnected"
                                ? "WhatsApp desconectado"
                                : r.whatsapp.display_name?.trim() ||
                                  (r.whatsapp.phone
                                    ? "WhatsApp conectado"
                                    : "WhatsApp (sem número sincronizado)")}
                            </div>
                            <div
                              className="mt-1 truncate text-xs text-[var(--app-text-55)]"
                              title={
                                r.whatsapp.status === "disconnected"
                                  ? "-"
                                  : formatWhatsAppPhone(r.whatsapp.phone) ||
                                    r.whatsapp.instance_id ||
                                    undefined
                              }
                            >
                              {r.whatsapp.status === "disconnected"
                                ? "-"
                                : formatWhatsAppPhone(r.whatsapp.phone) ||
                                  r.whatsapp.instance_id ||
                                  "Número ainda não sincronizado."}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white/35">
                              Sem WhatsApp
                            </div>
                            <div className="mt-1 truncate text-xs text-white/25">
                              Não configurado
                            </div>
                          </div>
                        </div>
                      )}
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
                          className={`inline-flex shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(normalizeStatus(r.assinatura_status))}`}
                        >
                          {statusLabel(normalizeStatus(r.assinatura_status))}
                        </span>
                      )}
                    </div>
                    <div className="col-span-1 text-center text-white/60">
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
        {filtered.length > pageSize ? (
          <div className="grid grid-cols-3 items-center border-t border-white/10 px-4 py-3">
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

      <AppModal open={openEdit} onClose={closeEdit} size="md" zIndexClass="z-[320]" fullScreenOnMobile>
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
          <input type="hidden" {...editForm.register("id", { required: true })} />
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
                ref={(element) => {
                  vencimentoFieldRef(element);
                  vencimentoInputRef.current = element;
                }}
                type="date"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                onClick={openVencimentoPicker}
                onFocus={openVencimentoPicker}
                {...vencimentoFieldProps}
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

      <AppModal open={openPassword} onClose={closePassword} size="md" zIndexClass="z-[320]" fullScreenOnMobile>
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
          <input type="hidden" {...passForm.register("id", { required: true })} />
          <div>
            <label className="text-xs font-semibold text-white/60">Nova senha</label>
            <div className="relative mt-2">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-12 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
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
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {passForm.formState.errors.password?.message ? (
              <div className="mt-2 text-xs font-semibold text-rose-200">
                {String(passForm.formState.errors.password.message)}
              </div>
            ) : null}
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
            className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
          >
            Excluir
          </button>
        </div>
      </AppModal>

      <AppModal open={openWhatsApp} onClose={closeWhatsApp} size="md" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
              <PhoneIcon className="h-4 w-4" />
              Apelido do WhatsApp
            </div>
            <div className="mt-1 truncate text-xs text-white/55">{whatsAppRow?.email ?? ""}</div>
          </div>
          <button
            onClick={closeWhatsApp}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Identificação atual</div>
          <div className="mt-2 truncate text-sm font-semibold text-[var(--app-text-85)]">
            {whatsAppRow?.whatsapp?.status === "disconnected"
              ? "WhatsApp desconectado"
              : whatsAppRow?.whatsapp?.display_name?.trim() ||
                (whatsAppRow?.whatsapp?.phone
                  ? "WhatsApp conectado (sem apelido)"
                  : whatsAppRow?.whatsapp?.instance_id
                    ? "Instância configurada (sem número sincronizado)"
                    : "WhatsApp não configurado")}
          </div>
          <div className="mt-1 truncate text-xs text-[var(--app-text-55)]">
            {whatsAppRow?.whatsapp?.status === "disconnected"
              ? "-"
              : formatWhatsAppPhone(whatsAppRow?.whatsapp?.phone ?? null) ||
                whatsAppRow?.whatsapp?.instance_id ||
                "—"}
          </div>
        </div>

        <form onSubmit={saveWhatsApp} className="mt-5 space-y-3">
          <input type="hidden" {...whatsAppForm.register("user_id", { required: true })} />
          <div>
            <label className="text-xs font-semibold text-white/60">
              Nome (apelido) do número
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              placeholder="Ex.: Suporte, Vendas, Professor Lucas, Financeiro"
              maxLength={80}
              {...whatsAppForm.register("display_name", { maxLength: 80 })}
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
              <span>Campo opcional. Se vazio, exibe &quot;WhatsApp conectado&quot; + número.</span>
              <span>
                {(whatsAppForm.watch("display_name") ?? "").length}/80
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={whatsAppForm.formState.isSubmitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
          >
            {whatsAppForm.formState.isSubmitting ? "Salvando..." : "Salvar apelido"}
          </button>
        </form>
      </AppModal>
    </div>
  );
}
