"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { Calendar, Pencil, Plus, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import {
  createDebtorAction,
  deleteDebtorAction,
  updateDebtorAction,
} from "@/app/app/clientes/actions";
import { type PlanKey } from "@/lib/plans";

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("pt-BR");
}

function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
}

function formatBRLFromDigits(digits: string) {
  const clean = digitsOnly(digits);
  if (!clean) return "";
  const value = Number(clean) / 100;
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseBRLToNumber(v: string) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const num = Number(s.replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(num)) return null;
  return num;
}

function isUuidLike(v: string) {
  const s = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function maskCpf(v: string) {
  const d = digitsOnly(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

function maskCnpj(v: string) {
  const d = digitsOnly(v).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  if (d.length <= 2) return p1;
  if (d.length <= 5) return `${p1}.${p2}`;
  if (d.length <= 8) return `${p1}.${p2}.${p3}`;
  if (d.length <= 12) return `${p1}.${p2}.${p3}/${p4}`;
  return `${p1}.${p2}.${p3}/${p4}-${p5}`;
}

function maskPhone(v: string) {
  const d0 = digitsOnly(v);
  const d = d0.startsWith("55") ? d0.slice(2) : d0;
  const dd = d.slice(0, 2);
  const rest = d.slice(2);
  if (!dd) return d0;
  if (rest.length <= 4) return `(${dd}) ${rest}`;
  if (rest.length <= 8) return `(${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${dd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

function maskPixPhone(v: string) {
  const raw = v.trimStart();
  if (!raw.startsWith("+")) return v;
  const d = digitsOnly(raw);
  if (!d.startsWith("55")) return v;
  const local = d.slice(2);
  if (!local) return "+55";
  if (local.length <= 2) return `+55 ${local}`;
  const dd = local.slice(0, 2);
  const rest = local.slice(2);
  if (!rest) return `+55 (${dd})`;
  if (rest.length <= 4) return `+55 (${dd}) ${rest}`;
  if (rest.length <= 8) return `+55 (${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `+55 (${dd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

type PixKeyType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | "desconhecida";

function detectPixKeyType(raw: string): PixKeyType {
  const v = raw.trim();
  if (!v) return "desconhecida";
  if (v.includes("@")) return "email";
  if (isUuidLike(v)) return "aleatoria";
  const d = digitsOnly(v);
  if (v.startsWith("+55") && d.startsWith("55")) {
    return "telefone";
  }
  if (d.length === 14) return "cnpj";
  if (d.length === 11) return "cpf";
  return "desconhecida";
}

function formatPixKey(raw: string) {
  const type = detectPixKeyType(raw);
  if (type === "email") return raw.trim().toLowerCase();
  if (type === "aleatoria") return raw.trim();
  if (type === "cnpj") return maskCnpj(raw);
  if (type === "cpf") return maskCpf(raw);
  if (type === "telefone") return maskPixPhone(raw);
  return raw;
}

function normalizePixKeyForSave(raw: string) {
  const type = detectPixKeyType(raw);
  if (type === "email") return raw.trim().toLowerCase();
  if (type === "aleatoria") return raw.trim();
  if (type === "cpf" || type === "cnpj") return digitsOnly(raw);
  if (type === "telefone") {
    return digitsOnly(raw);
  }
  return raw.trim();
}

export function DebtorsClient({ initial, plan }: { initial: DebtorRow[]; plan: PlanKey }) {
  const pageSize = 5;
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DebtorRow[]>(initial);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DebtorRow | null>(null);
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("desconhecida");
  const vencimentoInputRef = useRef<HTMLInputElement | null>(null);
  const canCreate = plan === "pro" || plan === "vitalicio" || rows.length < 15;

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
    control,
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

  const vencimentoField = register("vencimento");
  const openVencimentoPicker = () => {
    vencimentoInputRef.current?.showPicker?.();
    vencimentoInputRef.current?.focus();
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setPixKeyType("desconhecida");
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
    if (!canCreate) {
      modalToast.error("Limite do plano básico: até 15 cadastros de clientes.");
      return;
    }
    close();
    setOpen(true);
  };

  const openEdit = (row: DebtorRow) => {
    setEditing(row);
    setOpen(true);
    setPixKeyType(detectPixKeyType(row.pix_key ?? ""));
    reset({
      id: row.id,
      nome: row.nome,
      telefone: row.telefone ?? "",
      valor: row.valor != null ? String(row.valor) : "",
      vencimento: row.vencimento ?? "",
      pix_key: row.pix_key ? formatPixKey(row.pix_key) : "",
      observacoes: row.observacoes ?? "",
      status: row.status ?? "ativo",
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const valor = values.valor ? parseBRLToNumber(values.valor) : null;
    const pixKey = values.pix_key ? normalizePixKeyForSave(values.pix_key) : null;
    const payload = {
      ...(values.id ? { id: values.id } : {}),
      nome: values.nome,
      telefone: values.telefone || undefined,
      valor: typeof valor === "number" ? valor : undefined,
      vencimento: values.vencimento || undefined,
      pix_key: pixKey ? pixKey : undefined,
      observacoes: values.observacoes || undefined,
      status: values.status || "ativo",
    };

    const res = editing
      ? await updateDebtorAction(payload)
      : await createDebtorAction(payload);

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    modalToast.success(editing ? "Cliente atualizado." : "Cliente criado.");

    startTransition(async () => {
      const r = await fetch("/app/clientes/data", { cache: "no-store" });
      const json = (await r.json()) as DebtorRow[];
      setRows(json);
      close();
    });
  });

  const remove = async (row: DebtorRow) => {
    const confirmed = await modalToast.confirm(
      `Tem certeza que deseja excluir o cliente "${row.nome}"?`,
      { title: "Excluir cliente", confirmText: "Excluir", cancelText: "Cancelar" },
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await deleteDebtorAction(row.id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      modalToast.success("Cliente excluído.");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
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
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20 min-[1201px]:w-[420px]"
          />
          <button
            onClick={openCreate}
            disabled={!canCreate}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60 disabled:hover:bg-white sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo cliente
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
              <div className="col-span-3">Nome</div>
              <div className="col-span-2 text-center">Telefone</div>
              <div className="col-span-2 text-center">Valor</div>
              <div className="col-span-2 text-center">Vencimento</div>
              <div className="col-span-1 text-center">Status</div>
              <div className="col-span-2 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum cliente encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {pagedRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-3 truncate font-semibold">{r.nome}</div>
                    <div className="col-span-2 truncate text-center text-white/60">
                      {r.telefone ?? "-"}
                    </div>
                    <div className="col-span-2 text-center">{money(r.valor)}</div>
                    <div className="col-span-2 text-center text-white/60">
                      {dateBR(r.vencimento)}
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

      <AppModal open={open} onClose={close} size="lg" zIndexClass="z-[100]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">
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
                      <Controller
                        control={control}
                        name="telefone"
                        render={({ field }) => (
                          <input
                            inputMode="tel"
                            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                            placeholder="(DD) 9XXXX-XXXX"
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const raw = e.currentTarget.value;
                              field.onChange(maskPhone(raw));
                            }}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        )}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold text-white/60">Valor</div>
                    <Controller
                      control={control}
                      name="valor"
                      render={({ field }) => (
                        <div className="relative mt-2">
                          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/55">
                            R$
                          </div>
                          <input
                            inputMode="numeric"
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-12 pr-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                            placeholder="0,00"
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const next = formatBRLFromDigits(e.currentTarget.value);
                              field.onChange(next);
                            }}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        </div>
                      )}
                    />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white/60">
                        Vencimento
                      </div>
                      <div className="relative mt-2">
                        <input
                          type="date"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0"
                          {...vencimentoField}
                          onFocus={openVencimentoPicker}
                          onClick={openVencimentoPicker}
                          ref={(el) => {
                            vencimentoField.ref(el);
                            vencimentoInputRef.current = el;
                          }}
                        />
                        <button
                          type="button"
                          onClick={openVencimentoPicker}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-white/80"
                          aria-label="Selecionar vencimento"
                        >
                          <Calendar className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <input type="hidden" {...register("status")} />
                    <div className="text-xs font-semibold text-white/60">
                      Chave PIX (recebimento)
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-white/45">
                      {pixKeyType === "cpf"
                        ? "Detectado: CPF"
                        : pixKeyType === "cnpj"
                          ? "Detectado: CNPJ"
                          : pixKeyType === "email"
                            ? "Detectado: Email"
                            : pixKeyType === "telefone"
                              ? "Detectado: Telefone"
                              : pixKeyType === "aleatoria"
                                ? "Detectado: Chave aleatória"
                                : "Se for telefone, use no formato +55DD9XXXXXXXX."}
                    </div>
                    <Controller
                      control={control}
                      name="pix_key"
                      render={({ field }) => (
                        <input
                          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                          placeholder="Sua chave PIX (CPF, CNPJ, email, telefone ou aleatória)"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const raw = e.currentTarget.value;
                            const next = formatPixKey(raw);
                            setPixKeyType(detectPixKeyType(next));
                            field.onChange(next);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      )}
                    />
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
