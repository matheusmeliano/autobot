"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { useAppTheme } from "@/components/app/AppThemeProvider";
import { modalToast } from "@/lib/modalToast";
import {
  createDebtorAction,
  deleteDebtorAction,
  updateDebtorAction,
} from "@/app/app/clientes/actions";
import { type PlanKey } from "@/lib/plans";
import {
  DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  DEFAULT_RETRY_INTERVAL_DAYS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_TIME,
  MAX_RETRY_ATTEMPTS_PER_DAY,
  DEFAULT_RETRY_WEEKDAYS,
  normalizeRetryWeekdays,
} from "@/lib/chargeRetry";

export type DebtorRow = {
  id: string;
  nome: string;
  telefone: string | null;
  valor: number | null;
  vencimento: string | null;
  pix_key: string | null;
  observacoes: string | null;
  status: string;
  charges?: Array<{
    id: string;
    amount: number;
    due_day: number;
    created_at?: string | null;
  }>;
  progress_paid?: number;
  progress_total?: number;
  accumulate_open_monthly_charges: boolean | null;
  skip_weekends_on_first_charge: boolean | null;
  retry_weekdays: number[] | null;
  retry_time: string | null;
  retry_max_attempts: number | null;
  retry_interval_days: number | null;
  retry_auto_close_days: number | null;
  created_at: string;
};

type FormValues = {
  id?: string;
  nome: string;
  telefone?: string;
  charges: Array<{
    charge_id?: string;
    amount: string;
    due_day: string;
  }>;
  pix_key?: string;
  observacoes?: string;
  status?: string;
  accumulate_open_monthly_charges?: boolean;
  skip_weekends_on_first_charge?: boolean;
  retry_weekdays: number[];
  retry_time: string;
  retry_max_attempts: number;
  retry_interval_days: number;
  retry_auto_close_days: number;
};

const weekdayOptions = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
  { value: 7, label: "Dom" },
];

const monthOptions = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Marco" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

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

function dueDayLabel(v: string | null) {
  if (!v) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return String(Number(v.slice(8, 10)));
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return String(d.getDate());
}

function chargesTotal(row: DebtorRow) {
  if (row.charges && row.charges.length) {
    const sum = row.charges.reduce((acc, c) => {
      const n = typeof c.amount === "number" ? c.amount : Number(c.amount);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    return Number.isFinite(sum) ? sum : row.valor;
  }
  return row.valor;
}

function chargesFirstDueDay(row: DebtorRow) {
  if (row.charges && row.charges.length) {
    const min = row.charges
      .map((c) => Number(c.due_day))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
      .sort((a, b) => a - b)[0];
    return typeof min === "number" ? String(min) : dueDayLabel(row.vencimento);
  }
  return dueDayLabel(row.vencimento);
}

function progressText(row: DebtorRow) {
  const total = Number(row.progress_total ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const paid = Math.max(0, Math.min(total, Number(row.progress_paid ?? 0) || 0));
  return `${paid}/${total} Pagas`;
}

function splitDueDateParts(v: string | null | undefined, fallbackDate: Date) {
  const fallbackYear = String(fallbackDate.getFullYear());
  const fallbackMonth = String(fallbackDate.getMonth() + 1).padStart(2, "0");
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return {
      day: "",
      month: fallbackMonth,
      year: fallbackYear,
      custom: false,
    };
  }
  const year = v.slice(0, 4);
  const month = v.slice(5, 7);
  const day = String(Number(v.slice(8, 10)));
  const custom = year !== fallbackYear || month !== fallbackMonth;
  return { day, month, year, custom };
}

function buildDueDateIso(params: { day?: string; month?: string; year?: string }) {
  const day = Number(String(params.day ?? "").trim());
  const month = Number(String(params.month ?? "").trim());
  const year = Number(String(params.year ?? "").trim());
  if (!day) return { ok: true as const, value: undefined };
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { ok: false as const, error: "Informe um dia de vencimento entre 1 e 31." };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false as const, error: "Informe um mes de vencimento valido." };
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    return { ok: false as const, error: "Informe um ano de vencimento valido." };
  }
  const lastDay = new Date(year, month, 0).getDate();
  if (day > lastDay) {
    return { ok: false as const, error: `Esse mes possui apenas ${lastDay} dias.` };
  }
  return {
    ok: true as const,
    value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function debtorStatusLabel(status: string | null | undefined) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "ativo") return "Pago";
  if (s === "agendado") return "Agendado";
  if (s === "pendente") return "Pendente";
  if (s === "pago") return "Pago";
  if (s === "atrasado") return "Atrasado";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "-";
}

function debtorStatusClass(status: string | null | undefined) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "ativo" || s === "pago") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600";
  }
  if (s === "agendado") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600";
  }
  if (s === "pendente" || s === "suspeita_de_pagamento") {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-600";
  }
  if (s === "atrasado") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-600";
  }
  return "border-white/10 bg-white/[0.04] text-white/70";
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
  const { theme } = useAppTheme();
  const pageSize = 5;
  const currentDate = useMemo(() => new Date(), []);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DebtorRow[]>(initial);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DebtorRow | null>(null);
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("desconhecida");
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
      charges: [{ amount: "", due_day: String(currentDate.getDate()) }],
      pix_key: "",
      observacoes: "",
      status: "ativo",
      accumulate_open_monthly_charges: false,
      skip_weekends_on_first_charge: false,
      retry_weekdays: DEFAULT_RETRY_WEEKDAYS,
      retry_time: DEFAULT_RETRY_TIME,
      retry_max_attempts: DEFAULT_RETRY_MAX_ATTEMPTS,
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    },
  });

  const { fields: chargeFields, append: appendCharge, remove: removeCharge } = useFieldArray({
    control,
    name: "charges",
  });

  const close = () => {
    setOpen(false);
    setEditing(null);
    setPixKeyType("desconhecida");
    reset({
      nome: "",
      telefone: "",
      charges: [{ amount: "", due_day: String(currentDate.getDate()) }],
      pix_key: "",
      observacoes: "",
      status: "ativo",
      accumulate_open_monthly_charges: false,
      skip_weekends_on_first_charge: false,
      retry_weekdays: DEFAULT_RETRY_WEEKDAYS,
      retry_time: DEFAULT_RETRY_TIME,
      retry_max_attempts: DEFAULT_RETRY_MAX_ATTEMPTS,
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: DEFAULT_RETRY_AUTO_CLOSE_DAYS,
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
    const charges =
      row.charges && row.charges.length
        ? [...row.charges]
            .sort((a, b) => (a.due_day ?? 0) - (b.due_day ?? 0))
            .slice(0, MAX_RETRY_ATTEMPTS_PER_DAY)
            .map((c) => ({
              charge_id: c.id,
              amount: (() => {
                const n = typeof c.amount === "number" ? c.amount : Number(c.amount);
                return Number.isFinite(n)
                  ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "";
              })(),
              due_day: String(c.due_day ?? ""),
            }))
        : [
            {
              amount:
                typeof row.valor === "number"
                  ? row.valor.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "",
              due_day: String(dueDayLabel(row.vencimento) ?? ""),
            },
          ];
    reset({
      id: row.id,
      nome: row.nome,
      telefone: row.telefone ?? "",
      charges,
      pix_key: row.pix_key ? formatPixKey(row.pix_key) : "",
      observacoes: row.observacoes ?? "",
      status: row.status ?? "ativo",
      accumulate_open_monthly_charges: Boolean(row.accumulate_open_monthly_charges),
      skip_weekends_on_first_charge: Boolean(row.skip_weekends_on_first_charge),
      retry_weekdays: normalizeRetryWeekdays(row.retry_weekdays),
      retry_time: row.retry_time ?? DEFAULT_RETRY_TIME,
      retry_max_attempts: Math.min(
        MAX_RETRY_ATTEMPTS_PER_DAY,
        row.retry_max_attempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
      ),
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: row.retry_auto_close_days ?? DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    });
  };

  const onSubmit = handleSubmit(async (values) => {
    const pixKey = values.pix_key ? normalizePixKeyForSave(values.pix_key) : null;
    const mappedCharges = (values.charges ?? [])
      .map((c, index) => ({
        index,
        id: c.charge_id,
        amount: c.amount ? parseBRLToNumber(c.amount) : null,
        dueDay: Number(String(c.due_day ?? "").trim()),
      }))
      .filter((c) => typeof c.amount === "number" && c.amount > 0 && Number.isInteger(c.dueDay) && c.dueDay >= 1 && c.dueDay <= 31)
      .slice(0, MAX_RETRY_ATTEMPTS_PER_DAY)
      .sort((a, b) => (a.dueDay !== b.dueDay ? a.dueDay - b.dueDay : a.index - b.index));

    if (!mappedCharges.length) {
      modalToast.error("Informe pelo menos 1 cobrança (valor e dia de vencimento).");
      return;
    }

    const payload = {
      ...(values.id ? { id: values.id } : {}),
      nome: values.nome,
      telefone: values.telefone || undefined,
      charges: mappedCharges.map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        amount: c.amount as number,
        due_day: c.dueDay,
      })),
      pix_key: pixKey ? pixKey : undefined,
      observacoes: values.observacoes || undefined,
      status: values.status || "ativo",
      accumulate_open_monthly_charges: Boolean(values.accumulate_open_monthly_charges),
      skip_weekends_on_first_charge: Boolean(values.skip_weekends_on_first_charge),
      retry_weekdays: normalizeRetryWeekdays(values.retry_weekdays),
      retry_time: values.retry_time || DEFAULT_RETRY_TIME,
      retry_max_attempts: Math.min(
        MAX_RETRY_ATTEMPTS_PER_DAY,
        Number(values.retry_max_attempts) || DEFAULT_RETRY_MAX_ATTEMPTS,
      ),
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: Number(values.retry_auto_close_days) || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    };

    const res = editing
      ? await updateDebtorAction(payload)
      : await createDebtorAction(payload);

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    close();
    if ("warning" in res && res.warning) {
      const warnId = modalToast.warning(res.warning);
      await modalToast.wait(warnId);
    }
    const toastId = modalToast.success(editing ? "Cliente atualizado." : "Cliente criado.");
    await modalToast.wait(toastId);
    window.location.reload();
  });

  const remove = async (row: DebtorRow) => {
    const confirmed = await modalToast.confirm(
      `Tem certeza que deseja excluir o cliente "${row.nome}"?`,
      { title: "Excluir cliente", confirmText: "Excluir", cancelText: "Cancelar" },
    );
    if (!confirmed) return;
    const res = await deleteDebtorAction(row.id);
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao excluir.");
      return;
    }
    const toastId = modalToast.success("Cliente excluído.");
    await modalToast.wait(toastId);
    window.location.reload();
  };

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
            Clientes e devedores
          </h1>
          <div className="mt-2 text-sm text-[var(--app-text-60)]">
            Cadastre clientes, valores e vencimentos para gerar cobranças.
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)] focus:border-[var(--app-border)] min-[1201px]:w-[420px]"
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

      <div className="mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--app-text-60)]">
            Nenhum cliente encontrado.
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
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                          {r.nome}
                        </div>
                        {r.observacoes ? (
                          <div
                            className="mt-1 truncate text-[11px] text-[var(--app-text-55)]"
                            title={r.observacoes}
                          >
                            {r.observacoes}
                          </div>
                        ) : null}
                        {(() => {
                          const p = progressText(r);
                          return p ? (
                            <div className="mt-1 truncate text-[11px] text-[var(--app-text-55)]">{p}</div>
                          ) : null;
                        })()}
                      </div>
                      <span
                        className={[
                          "inline-flex shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold",
                          debtorStatusClass(r.status),
                        ].join(" ")}
                      >
                        {debtorStatusLabel(r.status)}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                          Telefone
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-[var(--app-text-85)]">
                          {r.telefone ?? "-"}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                            Valor
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[var(--app-text-85)]">
                            {money(chargesTotal(r))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                            Vencimento
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[var(--app-text-85)]">
                            {chargesFirstDueDay(r)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                      Ações
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openEdit(r)}
                        className="inline-flex min-h-[40px] w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
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
                <div className="col-span-3">Nome</div>
                <div className="col-span-2 text-center">Telefone</div>
                <div className="col-span-2 text-center">Valor</div>
                <div className="col-span-2 text-center">Vencimento</div>
                <div className="col-span-1 text-center">Status</div>
                <div className="col-span-2 text-right">Ações</div>
              </div>

              <div className="divide-y divide-[var(--app-border)]">
                {pagedRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-[var(--app-text-85)]"
                  >
                    <div className="col-span-3 min-w-0">
                      <div className="truncate font-semibold" title={r.nome}>
                        {r.nome}
                      </div>
                      {r.observacoes ? (
                        <div
                          className="truncate text-[11px] text-[var(--app-text-55)]"
                          title={r.observacoes}
                        >
                          {r.observacoes}
                        </div>
                      ) : null}
                      {(() => {
                        const p = progressText(r);
                        return p ? <div className="truncate text-[11px] text-[var(--app-text-55)]">{p}</div> : null;
                      })()}
                    </div>
                    <div className="col-span-2 truncate text-center text-[var(--app-text-70)]">
                      {r.telefone ?? "-"}
                    </div>
                    <div className="col-span-2 text-center">{money(chargesTotal(r))}</div>
                    <div className="col-span-2 text-center text-[var(--app-text-70)]">
                      {chargesFirstDueDay(r)}
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <span
                        className={[
                          "inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold",
                          debtorStatusClass(r.status),
                        ].join(" ")}
                      >
                        {debtorStatusLabel(r.status)}
                      </span>
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

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-white/60">Cobranças do mês</div>
                      <button
                        type="button"
                        onClick={() => {
                          if (chargeFields.length >= MAX_RETRY_ATTEMPTS_PER_DAY) {
                            modalToast.error(`Limite: no máximo ${MAX_RETRY_ATTEMPTS_PER_DAY} cobranças por cliente.`);
                            return;
                          }
                          appendCharge({ amount: "", due_day: String(currentDate.getDate()) });
                        }}
                        className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/85 hover:bg-white/[0.06]"
                      >
                        Adicionar
                      </button>
                    </div>

                    <div className="mt-2 grid gap-3">
                      {chargeFields.map((field, index) => (
                        <div
                          key={field.id}
                          className="rounded-2xl border border-white/10 bg-white/[0.02] p-3"
                        >
                          <input type="hidden" {...register(`charges.${index}.charge_id`)} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="w-full">
                              <div className="text-xs font-semibold text-white/60">Valor</div>
                              <Controller
                                control={control}
                                name={`charges.${index}.amount`}
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
                              <div className="text-xs font-semibold text-white/60">Dia de vencimento</div>
                              <input
                                type="number"
                                min={1}
                                max={31}
                                inputMode="numeric"
                                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                                placeholder="Ex: 10"
                                {...register(`charges.${index}.due_day` as const)}
                              />
                            </div>
                          </div>

                          {chargeFields.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeCharge(index)}
                              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/85 hover:bg-white/[0.06]"
                            >
                              Remover cobrança
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 text-[11px] text-white/45">
                      Ordena automaticamente por vencimento e permite até {MAX_RETRY_ATTEMPTS_PER_DAY} cobranças por cliente.
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

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-white/15 bg-white/[0.03]"
                      {...register("accumulate_open_monthly_charges")}
                    />
                    <div>
                      <div className="text-xs font-semibold text-white/75">
                        Acumular mensalidades em aberto
                      </div>
                      <div className="mt-1 text-[11px] text-white/45">
                        Quando ativado, mensalidades vencidas somam automaticamente aos meses seguintes ate o pagamento ou encerramento da cobranca.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-white/15 bg-white/[0.03]"
                      {...register("skip_weekends_on_first_charge")}
                    />
                    <div>
                      <div className="text-xs font-semibold text-white/75">
                        Pular finais de semana na primeira cobrança
                      </div>
                      <div className="mt-1 text-[11px] text-white/45">
                        Quando ativado, a primeira tentativa agendada para sábado ou domingo é movida automaticamente para o próximo dia útil. Reenvios e cobranças em atraso seguem a programação normal.
                      </div>
                    </div>
                  </label>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="text-xs font-semibold text-white/70">
                      Reenvio de cobrança em atraso
                    </div>
                    <div className="mt-1 text-[11px] text-white/45">
                      Define em quais dias, horários e quantos envios podem acontecer no mesmo dia para cobranças não pagas.
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-semibold text-white/60">Dias permitidos</div>
                      <Controller
                        control={control}
                        name="retry_weekdays"
                        render={({ field }) => {
                          const current = normalizeRetryWeekdays(field.value);
                          return (
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                              {weekdayOptions.map((option) => {
                                const active = current.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      const next = active
                                        ? current.filter((item) => item !== option.value)
                                        : [...current, option.value];
                                      field.onChange(normalizeRetryWeekdays(next));
                                    }}
                                    className={[
                                      "rounded-xl border px-3 py-2 text-xs font-semibold",
                                      active
                                        ? "border-[var(--app-border)] bg-[var(--app-hover)] text-[var(--app-text-85)]"
                                        : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.05]",
                                    ].join(" ")}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                    </div>

                    <div className="mt-4 grid gap-3">
                      <div>
                        <div className="text-xs font-semibold text-white/60">Horário de reenvio</div>
                        <input
                          type="time"
                          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
                          style={{ colorScheme: theme }}
                          onClick={(e) => {
                            e.currentTarget.showPicker?.();
                          }}
                          {...register("retry_time")}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white/60">Envios por dia</div>
                        <input
                          type="number"
                          min={1}
                          max={MAX_RETRY_ATTEMPTS_PER_DAY}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
                          {...register("retry_max_attempts", { valueAsNumber: true })}
                        />
                        <div className="mt-2 text-[11px] text-white/45">
                          Distribui automaticamente as demais cobranças ao longo do mesmo dia.
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="w-full">
                        <div className="text-xs font-semibold text-white/60">Encerrar automaticamente após (dias)</div>
                        <input
                          type="number"
                          min={1}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20"
                          {...register("retry_auto_close_days", { valueAsNumber: true })}
                        />
                      </div>
                    </div>
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
