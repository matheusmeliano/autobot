"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { createPortal } from "react-dom";
import { Calendar, Check, Clock, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { useAppTheme } from "@/components/app/AppThemeProvider";
import { modalToast } from "@/lib/modalToast";
import {
  localDateInTimeZone,
  MAX_MONTHLY_SCHEDULES_PER_DEBTOR,
  MAX_YEARLY_RECURRENCE_OCCURRENCES,
  nextMonthlyIso,
  nextYearlyIso,
  recurrenceLimitMaxDateFromLocalDate,
  shouldContinueRecurringRecurrence,
} from "@/lib/recurrence";
import { type BrazilTimeZone, zonedDateTimeToUtcIso } from "@/lib/timezone";
import {
  createScheduleAction,
  deleteScheduleAction,
  markSchedulePaidAction,
  triggerScheduleNowAction,
  updateScheduleAction,
} from "@/app/app/agenda/actions";
import {
  DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  DEFAULT_RETRY_INTERVAL_DAYS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_TIME,
  DEFAULT_RETRY_WEEKDAYS,
  MAX_RETRY_ATTEMPTS_PER_DAY,
  normalizeRetryWeekdays,
} from "@/lib/chargeRetry";
import {
  agendarYearMonthKey as yearMonthKey,
  deriveAgendarVisualStatus,
  getAgendarDisplayReferenceMoment,
} from "@/lib/agendarStatus";

type DebtorChargeOption = {
  id?: string | null;
  due_day?: number | null;
  recurrence_month?: number | null;
  recurrence_year?: number | null;
  created_at?: string | null;
};

export type DebtorOption = {
  id: string;
  nome: string;
  vencimento?: string | null;
  retry_weekdays?: number[] | null;
  retry_time?: string | null;
  retry_max_attempts?: number | null;
  retry_interval_days?: number | null;
  retry_auto_close_days?: number | null;
  debtor_charges?: DebtorChargeOption[] | null;
};
export type TemplateOption = { id: string; nome: string };

export type ScheduleRow = {
  id: string;
  debtor_id: string;
  charge_id?: string | null;
  source_kind?: "charge" | "schedule";
  schedule_missing?: boolean;
  template_id: string | null;
  template_pending_id: string | null;
  template_overdue_id: string | null;
  data_envio: string;
  charge_due_at?: string | null;
  operational_due_at?: string | null;
  next_charge_due_at?: string | null;
  status: string;
  recurrence?: string | null;
  recurrence_until?: string | null;
  recurrence_day?: number | null;
  recurrence_time?: string | null;
  schedule_timezone?: string | null;
  last_sent_at?: string | null;
  payment_received_at?: string | null;
  last_executed_scheduled_for?: string | null;
  created_at: string;
  debtor_nome: string;
  template_nome: string | null;
  template_pending_nome: string | null;
  template_overdue_nome: string | null;
};

type FormValues = {
  id?: string;
  debtor_id: string;
  charge_id?: string;
  template_pending_id?: string;
  template_overdue_id?: string;
  data_envio_date: string;
  data_envio_time: string;
  recurrence: "none" | "monthly" | "yearly";
  recurrence_until: string;
  status: string;
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

function dateTimeBR(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function dateBR(v: string, timeZone: BrazilTimeZone) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short" }).format(d);
}

function timeBR(v: string, timeZone: BrazilTimeZone) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function monthYearBR(v: string, timeZone: BrazilTimeZone) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(d);
}

function monthYearCompactBR(v: string, timeZone: BrazilTimeZone) {
  return monthYearBR(v, timeZone).replace(" de ", "/");
}

function normalizeDateOnly(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return "";
}

function localDateBR(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function buildLocalDate(yearMonth: string, day: number) {
  const [yearRaw, monthRaw] = yearMonth.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return "";
  const safeDay = Math.max(1, Math.min(Number(day) || 1, lastDayOfMonth(year, month)));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function compareDebtorChargeOrder(a: DebtorChargeOption, b: DebtorChargeOption) {
  const yearA = Number(a.recurrence_year ?? 0);
  const yearB = Number(b.recurrence_year ?? 0);
  if (yearA !== yearB) return yearA - yearB;
  const monthA = Number(a.recurrence_month ?? 0);
  const monthB = Number(b.recurrence_month ?? 0);
  if (monthA !== monthB) return monthA - monthB;
  const dayA = Number(a.due_day ?? 0);
  const dayB = Number(b.due_day ?? 0);
  if (dayA !== dayB) return dayA - dayB;
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

function debtorReferenceLocalDate(debtor: DebtorOption | null | undefined) {
  const charges = Array.isArray(debtor?.debtor_charges) ? debtor.debtor_charges.slice() : [];
  const firstCharge = charges
    .filter((charge) => {
      const year = Number(charge.recurrence_year ?? 0);
      const month = Number(charge.recurrence_month ?? 0);
      const day = Number(charge.due_day ?? 0);
      return year >= 2000 && month >= 1 && month <= 12 && day >= 1;
    })
    .sort(compareDebtorChargeOrder)[0];

  if (firstCharge) {
    return buildLocalDate(
      `${String(Number(firstCharge.recurrence_year)).padStart(4, "0")}-${String(Number(firstCharge.recurrence_month)).padStart(2, "0")}`,
      Number(firstCharge.due_day),
    );
  }

  return normalizeDateOnly(debtor?.vencimento);
}

function debtorReferenceDateOptions(debtor: DebtorOption | null | undefined) {
  const charges = Array.isArray(debtor?.debtor_charges) ? debtor.debtor_charges.slice() : [];
  const chargeOptions = charges
    .filter((charge) => {
      const year = Number(charge.recurrence_year ?? 0);
      const month = Number(charge.recurrence_month ?? 0);
      const day = Number(charge.due_day ?? 0);
      return year >= 2000 && month >= 1 && month <= 12 && day >= 1;
    })
    .sort(compareDebtorChargeOrder)
    .map((charge) => {
      const value = buildLocalDate(
        `${String(Number(charge.recurrence_year)).padStart(4, "0")}-${String(Number(charge.recurrence_month)).padStart(2, "0")}`,
        Number(charge.due_day),
      );
      return value
        ? {
            value,
            label: localDateBR(value),
            chargeId: String(charge.id ?? "").trim() || null,
          }
        : null;
    })
    .filter(Boolean) as Array<{ value: string; label: string; chargeId: string | null }>;

  const uniqueOptions = new Map<string, { value: string; label: string; chargeId: string | null }>();
  for (const option of chargeOptions) {
    const optionKey = option.chargeId || option.value;
    if (!uniqueOptions.has(optionKey)) {
      uniqueOptions.set(optionKey, option);
    }
  }

  const legacyDate = normalizeDateOnly(debtor?.vencimento);
  if (legacyDate && !uniqueOptions.has(legacyDate)) {
    uniqueOptions.set(legacyDate, { value: legacyDate, label: localDateBR(legacyDate), chargeId: null });
  }

  return Array.from(uniqueOptions.values());
}

function debtorReferenceOptionKey(option: { value: string; chargeId: string | null }) {
  return option.chargeId || option.value;
}

function scheduleReferenceLocalDate(row: ScheduleRow, fallbackTimeZone: BrazilTimeZone) {
  const referenceMoment = String(row.operational_due_at ?? row.charge_due_at ?? row.data_envio ?? "").trim();
  if (!referenceMoment) return "";
  const rowTimeZone = (String(row.schedule_timezone ?? "").trim() || fallbackTimeZone) as BrazilTimeZone;
  try {
    return localDateInTimeZone(referenceMoment, rowTimeZone);
  } catch {
    return normalizeDateOnly(referenceMoment);
  }
}

function monthDistance(fromYearMonth: string, toYearMonth: string) {
  const [fromYear, fromMonth] = fromYearMonth.split("-").map(Number);
  const [toYear, toMonth] = toYearMonth.split("-").map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) return null;
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function localScheduleIso(date: string, time: string, timeZone: BrazilTimeZone) {
  if (!date || !time) return null;
  try {
    return zonedDateTimeToUtcIso({ date, time, timeZone });
  } catch {
    return null;
  }
}

function splitDateTimeForInput(v: string, timeZone: BrazilTimeZone) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type === "literal") continue;
    m[p.type] = p.value;
  }
  const date = `${m.year}-${m.month}-${m.day}`;
  const time = `${m.hour}:${m.minute}`;
  return { date, time };
}

function currentMinScheduleLocalDateTime(timeZone: BrazilTimeZone) {
  const nowRounded = new Date();
  nowRounded.setSeconds(0, 0);
  const minDate = new Date(nowRounded.getTime() + 3 * 60 * 1000);
  return splitDateTimeForInput(minDate.toISOString(), timeZone);
}

function isFutureScheduleDateTime(params: {
  date: string;
  time: string;
  timeZone: BrazilTimeZone;
}) {
  try {
    const iso = zonedDateTimeToUtcIso({
      date: params.date,
      time: params.time,
      timeZone: params.timeZone,
    });
    const nowRounded = new Date();
    nowRounded.setSeconds(0, 0);
    const minAllowed = nowRounded.getTime() + 3 * 60 * 1000;
    return new Date(iso).getTime() >= minAllowed;
  } catch {
    return false;
  }
}

function getMonthlyCycleConfig(row: ScheduleRow, timeZone: BrazilTimeZone) {
  const dateTime = splitDateTimeForInput(row.data_envio, timeZone);
  const fallbackDay = Number(dateTime.date.split("-")[2] ?? "1");
  return {
    day: Number.isFinite(Number(row.recurrence_day)) ? Number(row.recurrence_day) : fallbackDay,
    time:
      typeof row.recurrence_time === "string" && /^\d{2}:\d{2}$/.test(row.recurrence_time)
        ? row.recurrence_time
        : dateTime.time || "00:00",
  };
}

function getNextRecurringMoment(row: ScheduleRow, timeZone: BrazilTimeZone) {
  const recurrence = String(row.recurrence ?? "none").toLowerCase();
  if (recurrence !== "monthly" && recurrence !== "yearly") return null;

  const baseIso = row.operational_due_at ?? row.charge_due_at ?? row.data_envio;
  if (!baseIso) return null;

  const dueInput = splitDateTimeForInput(baseIso, timeZone);
  const sendInput = splitDateTimeForInput(row.data_envio, timeZone);
  const recurrenceDay = Number(row.recurrence_day ?? dueInput.date.split("-")[2] ?? "");
  const recurrenceTime =
    typeof row.recurrence_time === "string" && /^\d{2}:\d{2}$/.test(row.recurrence_time)
      ? row.recurrence_time
      : sendInput.time || dueInput.time || "00:00";

  try {
    const nextIso =
      recurrence === "yearly"
        ? nextYearlyIso({
            fromUtcIso: baseIso,
            timeZone,
            day: Number.isFinite(recurrenceDay) ? recurrenceDay : 1,
            time: recurrenceTime,
          })
        : nextMonthlyIso({
            fromUtcIso: baseIso,
            timeZone,
            day: Number.isFinite(recurrenceDay) ? recurrenceDay : 1,
            time: recurrenceTime,
          });

    if (
      !shouldContinueRecurringRecurrence({
        nextUtcIso: nextIso,
        recurrenceUntil: row.recurrence_until ?? null,
        timeZone,
      })
    ) {
      return null;
    }

    return nextIso;
  } catch {
    return null;
  }
}

function normalizeDebtorRetryValues(debtor: DebtorOption | null | undefined) {
  return {
    retry_weekdays:
      debtor?.retry_weekdays == null ? DEFAULT_RETRY_WEEKDAYS : normalizeRetryWeekdays(debtor.retry_weekdays),
    retry_time: debtor?.retry_time ?? DEFAULT_RETRY_TIME,
    retry_max_attempts: Math.min(
      MAX_RETRY_ATTEMPTS_PER_DAY,
      debtor?.retry_max_attempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
    ),
    retry_interval_days: debtor?.retry_interval_days ?? DEFAULT_RETRY_INTERVAL_DAYS,
    retry_auto_close_days: debtor?.retry_auto_close_days ?? DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  };
}

function scheduleStatusClass(raw: unknown, theme: "light" | "dark") {
  const s = String(raw ?? "").toLowerCase();
  if (s === "agendado") return `${theme === "dark" ? "bg-yellow-600" : "bg-yellow-500"} text-[rgb(255,255,255)]`;
  if (s === "pendente" || s === "suspeita_de_pagamento") {
    return `${theme === "dark" ? "bg-yellow-600" : "bg-yellow-500"} text-[rgb(255,255,255)]`;
  }
  if (s === "pago" || s === "executado") return "bg-emerald-600 text-[rgb(255,255,255)]";
  if (s === "atrasado") return "bg-rose-600 text-[rgb(255,255,255)]";
  return `${theme === "dark" ? "bg-yellow-600" : "bg-yellow-500"} text-[rgb(255,255,255)]`;
}

function scheduleHasExecutedCurrentInstance(row: ScheduleRow) {
  const normalizedStatus = String(row.status ?? "").trim().toLowerCase();
  if (normalizedStatus === "executado" || normalizedStatus === "pago") return true;

  const lastExecutedAt = String(row.last_executed_scheduled_for ?? "").trim();
  const scheduledFor = String(row.data_envio ?? "").trim();
  if (lastExecutedAt && scheduledFor) {
    const executedMs = new Date(lastExecutedAt).getTime();
    const scheduledMs = new Date(scheduledFor).getTime();
    if (!Number.isNaN(executedMs) && !Number.isNaN(scheduledMs) && executedMs === scheduledMs) {
      return true;
    }
  }

  return false;
}

export function SchedulesClient({
  initial,
  debtors,
  templates,
  timeZone,
  whatsappConfigured,
}: {
  initial: ScheduleRow[];
  debtors: DebtorOption[];
  templates: TemplateOption[];
  timeZone: BrazilTimeZone | null;
  whatsappConfigured: boolean;
}) {
  const { theme } = useAppTheme();
  const pageSize = 5;
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ScheduleRow[]>(initial);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const recurrenceUntilInputRef = useRef<HTMLInputElement | null>(null);
  const [monthlyExtras, setMonthlyExtras] = useState<Array<{ date: string; time: string }>>([]);
  const extraDateInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const extraTimeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const extraTimeAnchorRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timePickerAnchorRef = useRef<HTMLDivElement | null>(null);
  const timePickerPanelRef = useRef<HTMLDivElement | null>(null);
  const [timePickerTarget, setTimePickerTarget] = useState<
    { kind: "main" } | { kind: "extra"; index: number } | null
  >(null);
  const [timePickerPos, setTimePickerPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const effectiveTimeZone: BrazilTimeZone = timeZone ?? "America/Sao_Paulo";
  const debtorsById = useMemo(
    () => new Map(debtors.map((debtor) => [String(debtor.id), debtor])),
    [debtors],
  );
  const missingTimeZone = !timeZone;
  const missingWhatsApp = !whatsappConfigured;
  const todayMinDate = useMemo(
    () => localDateInTimeZone(new Date().toISOString(), effectiveTimeZone),
    [effectiveTimeZone],
  );
  const scheduleDateMin = todayMinDate;

  const prereqMessage = (context: "criar/editar" | "disparar") => {
    const actionLabel = context === "disparar" ? "disparar agora" : "criar ou editar agendamentos";
    if (missingTimeZone && missingWhatsApp) {
      return `Selecione e salve seu fuso horário em Configurações e configure seu WhatsApp na página WhatsApp antes de ${actionLabel}.`;
    }
    if (missingTimeZone) {
      return `Selecione e salve seu fuso horário em Configurações antes de ${actionLabel}.`;
    }
    if (missingWhatsApp) {
      return `Configure seu WhatsApp na página WhatsApp antes de ${actionLabel}.`;
    }
    return null;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (!q ? true : r.debtor_nome.toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => {
        const debtorCompare = String(a.debtor_nome ?? "").localeCompare(String(b.debtor_nome ?? ""), "pt-BR", {
          sensitivity: "base",
        });
        if (debtorCompare !== 0) return debtorCompare;
        return String(a.operational_due_at ?? a.charge_due_at ?? a.data_envio).localeCompare(
          String(b.operational_due_at ?? b.charge_due_at ?? b.data_envio),
        );
      });
  }, [query, rows]);
  const operationalMonthKey = useMemo(
    () => yearMonthKey(new Date().toISOString(), effectiveTimeZone),
    [effectiveTimeZone],
  );
  const operationalScheduleByDebtor = useMemo(() => {
    const grouped = new Map<string, ScheduleRow[]>();

    for (const row of rows) {
      const debtorId = String(row.debtor_id ?? "");
      if (!debtorId) continue;
      const list = grouped.get(debtorId) ?? [];
      list.push(row);
      grouped.set(debtorId, list);
    }

    const scheduleMap = new Map<string, ScheduleRow>();
    for (const [debtorId, debtorRows] of grouped.entries()) {
      const currentMonthRows = debtorRows
        .filter(
          (row) =>
            yearMonthKey(row.operational_due_at ?? row.charge_due_at ?? row.data_envio, effectiveTimeZone) ===
            operationalMonthKey,
        )
        .sort((a, b) =>
          String(a.operational_due_at ?? a.charge_due_at ?? a.data_envio).localeCompare(
            String(b.operational_due_at ?? b.charge_due_at ?? b.data_envio),
          ),
        );
      const referenceRow = currentMonthRows[0] ?? null;
      if (referenceRow) scheduleMap.set(debtorId, referenceRow);
    }

    return scheduleMap;
  }, [effectiveTimeZone, operationalMonthKey, rows]);
  const operationalStatusByDebtor = useMemo(() => {
    const currentLocalDate = localDateInTimeZone(new Date().toISOString(), effectiveTimeZone);
    const statusMap = new Map<string, { label: "Agendado" | "Executado"; className: string }>();
    for (const row of rows) {
      try {
        const debtorId = String(row.debtor_id ?? "");
        if (!debtorId || statusMap.has(debtorId)) continue;
        const referenceRow = operationalScheduleByDebtor.get(debtorId) ?? null;
        if (!referenceRow) {
          statusMap.set(debtorId, {
            label: "Agendado",
            className: scheduleStatusClass("pendente", theme),
          });
          continue;
        }

        const dueMoment = referenceRow.operational_due_at ?? referenceRow.charge_due_at ?? referenceRow.data_envio;
        const dueLocalDate = localDateInTimeZone(dueMoment, effectiveTimeZone);
        const executedByCurrentInstance = scheduleHasExecutedCurrentInstance(referenceRow);
        const isExecuted =
          executedByCurrentInstance || (Boolean(dueLocalDate) && dueLocalDate < currentLocalDate);
        statusMap.set(debtorId, {
          label: isExecuted ? "Executado" : "Agendado",
          className: scheduleStatusClass(isExecuted ? "executado" : "pendente", theme),
        });
      } catch {
        const debtorId = String(row.debtor_id ?? "");
        if (!debtorId || statusMap.has(debtorId)) continue;
        statusMap.set(debtorId, {
          label: "Agendado",
          className: scheduleStatusClass("pendente", theme),
        });
      }
    }

    return statusMap;
  }, [effectiveTimeZone, operationalScheduleByDebtor, rows, theme]);

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
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      debtor_id: "",
      charge_id: "",
      template_pending_id: "",
      template_overdue_id: "",
      data_envio_date: "",
      data_envio_time: "",
      recurrence: "none",
      recurrence_until: "",
      status: "agendado",
      retry_weekdays: DEFAULT_RETRY_WEEKDAYS,
      retry_time: DEFAULT_RETRY_TIME,
      retry_max_attempts: DEFAULT_RETRY_MAX_ATTEMPTS,
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    },
  });

  const statusLabel = (raw: unknown) => {
    const s = String(raw ?? "");
    if (s === "agendado") return "Agendado";
    if (s === "pendente") return "Agendado";
    if (s === "pago") return "Pago";
    if (s === "atrasado") return "Atrasado";
    if (s === "executando") return "Executando";
    if (s === "executado") return "Executado";
    if (s === "suspeita_de_pagamento") return "Suspeita";
    return s || "-";
  };

  function displayReferenceMoment(row: ScheduleRow) {
    return getAgendarDisplayReferenceMoment(row, effectiveTimeZone, operationalMonthKey);
  }

  const displayStatus = (row: ScheduleRow) => {
    const derived = deriveAgendarVisualStatus(row, effectiveTimeZone, operationalMonthKey);

    if (derived.label === "Agendado") {
      return {
        label: "Agendado",
        subtitle: null as "Não pago" | "Pago" | null,
        className: scheduleStatusClass("pendente", theme),
        isExecuted: false,
        isPaid: false,
        referenceMoment: derived.referenceMoment,
        referenceMonthKey: derived.referenceMonthKey,
        isCurrentMonth: derived.isCurrentMonth,
      };
    }

    return {
      label: "Executado",
      subtitle: derived.subtitle,
      className: scheduleStatusClass("executado", theme),
      isExecuted: true,
      isPaid: derived.isPaid,
      referenceMoment: derived.referenceMoment,
      referenceMonthKey: derived.referenceMonthKey,
      isCurrentMonth: derived.isCurrentMonth,
    };
  };

  const displayMoments = (row: ScheduleRow) => {
    const dueMoment = displayReferenceMoment(row);
    const scheduledMoment = String(row.data_envio ?? dueMoment ?? "").trim();
    const dueInput = splitDateTimeForInput(dueMoment, effectiveTimeZone);
    const dueDay = dueInput.date ? dueInput.date.slice(-2) : "--";
    const scheduledDate = dateBR(dueMoment || scheduledMoment, effectiveTimeZone);

    return {
      primaryDate: dueDay,
      primaryTime: timeBR(scheduledMoment || dueMoment, effectiveTimeZone),
      scheduledDate,
    };
  };

  const getEditDateTime = (row: ScheduleRow) => {
    const dueInput = splitDateTimeForInput(
      row.operational_due_at ?? row.charge_due_at ?? row.data_envio,
      effectiveTimeZone,
    );
    const sendInput = splitDateTimeForInput(row.data_envio, effectiveTimeZone);
    return {
      date: dueInput.date,
      time: sendInput.time || dueInput.time,
    };
  };

  const renderActionButtons = (r: ScheduleRow, variant: "desktop" | "mobile") => {
    const sourceKind = String((r as any).source_kind ?? "").trim().toLowerCase();
    const scheduleUnavailable =
      sourceKind === "charge" || Boolean(r.schedule_missing) || String(r.id ?? "").startsWith("charge:");
    const visualStatus = displayStatus(r);
    const baseButtonClass =
      variant === "mobile"
        ? "inline-flex min-h-[40px] w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60"
        : "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06] disabled:opacity-60";
    const triggerButtonClass =
      variant === "mobile"
        ? "inline-flex min-h-[40px] w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60"
        : "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.06] disabled:opacity-60";

    return (
      <div className={variant === "mobile" ? "grid grid-cols-2 gap-2" : "flex flex-nowrap justify-end gap-2"}>
        <button
          onClick={() => openEdit(r)}
          disabled={
            scheduleUnavailable ||
            isPending ||
            markingPaidId === r.id ||
            visualStatus.label !== "Agendado"
          }
          className={baseButtonClass}
          title="Editar"
        >
          <Pencil className="h-4 w-4" />
          {variant === "mobile" ? <span>Editar</span> : null}
        </button>
        <button
          onClick={() => markAsPaid(r)}
          disabled={
            scheduleUnavailable ||
            isPending ||
            triggeringId === r.id ||
            markingPaidId === r.id ||
            visualStatus.isPaid ||
            String(r.status ?? "") === "executando" ||
            (visualStatus.isCurrentMonth && String(r.status ?? "") === "suspeita_de_pagamento")
          }
          className={baseButtonClass}
          title="Pagamento realizado"
        >
          <Check className="h-4 w-4" />
          {variant === "mobile" ? <span>Pago</span> : null}
        </button>
        <button
          onClick={() => triggerNow(r)}
          disabled={
            scheduleUnavailable ||
            isPending ||
            triggeringId === r.id ||
            markingPaidId === r.id ||
            visualStatus.isExecuted ||
            String(r.status ?? "") === "executando" ||
            (visualStatus.isCurrentMonth && String(r.status ?? "") === "suspeita_de_pagamento")
          }
          className={triggerButtonClass}
          title="Disparar agora"
        >
          <Send className="h-4 w-4" />
          {variant === "mobile" ? <span>Disparar</span> : null}
        </button>
        <button
          onClick={() => remove(r)}
          disabled={
            scheduleUnavailable ||
            isPending ||
            triggeringId === r.id ||
            markingPaidId === r.id
          }
          className={baseButtonClass}
          title="Excluir"
        >
          <Trash2 className="h-4 w-4" />
          {variant === "mobile" ? <span>Excluir</span> : null}
        </button>
      </div>
    );
  };

  const timeValue = watch("data_envio_time");
  const scheduleDateValue = watch("data_envio_date");
  const recurrenceValue = watch("recurrence");
  const hasRecurringSchedule = recurrenceValue !== "none";
  const isMonthlyRecurrence = recurrenceValue === "monthly";
  const isYearlyRecurrence = recurrenceValue === "yearly";
  const selectedDebtorId = watch("debtor_id");
  const selectedChargeId = String(watch("charge_id") ?? "").trim();
  const selectedDebtor = useMemo(
    () => debtorsById.get(String(selectedDebtorId ?? "")) ?? null,
    [debtorsById, selectedDebtorId],
  );
  const debtorReferenceOptions = useMemo(() => debtorReferenceDateOptions(selectedDebtor), [selectedDebtor]);
  const editingReferenceDate = useMemo(() => {
    if (!editing) return "";
    return scheduleReferenceLocalDate(editing, effectiveTimeZone);
  }, [editing, effectiveTimeZone]);
  const editingChargeId = String(editing?.charge_id ?? "").trim();
  const occupiedDebtorReferenceDates = useMemo(() => {
    const occupied = new Set<string>();
    for (const row of rows) {
      if (String(row.debtor_id ?? "") !== String(selectedDebtorId ?? "")) continue;
      if (editing && String(row.id ?? "") === String(editing.id ?? "")) continue;
      const date = scheduleReferenceLocalDate(row, effectiveTimeZone);
      if (date) occupied.add(date);
    }
    return occupied;
  }, [editing, effectiveTimeZone, rows, selectedDebtorId]);
  const occupiedDebtorChargeIds = useMemo(() => {
    const occupied = new Set<string>();
    for (const row of rows) {
      if (String(row.debtor_id ?? "") !== String(selectedDebtorId ?? "")) continue;
      if (editing && String(row.id ?? "") === String(editing.id ?? "")) continue;
      const chargeId = String(row.charge_id ?? "").trim();
      if (chargeId) occupied.add(chargeId);
    }
    return occupied;
  }, [editing, rows, selectedDebtorId]);
  const selectableDebtorIds = useMemo(() => {
    const occupiedDatesByDebtor = new Map<string, Set<string>>();
    const occupiedChargeIdsByDebtor = new Map<string, Set<string>>();
    const openSchedulesCountByDebtor = new Map<string, number>();
    for (const row of rows) {
      if (editing && String(row.id ?? "") === String(editing.id ?? "")) continue;
      const debtorId = String(row.debtor_id ?? "").trim();
      if (!debtorId) continue;
      openSchedulesCountByDebtor.set(debtorId, (openSchedulesCountByDebtor.get(debtorId) ?? 0) + 1);
      const date = scheduleReferenceLocalDate(row, effectiveTimeZone);
      if (date) {
        const current = occupiedDatesByDebtor.get(debtorId) ?? new Set<string>();
        current.add(date);
        occupiedDatesByDebtor.set(debtorId, current);
      }
      const chargeId = String(row.charge_id ?? "").trim();
      if (chargeId) {
        const currentChargeIds = occupiedChargeIdsByDebtor.get(debtorId) ?? new Set<string>();
        currentChargeIds.add(chargeId);
        occupiedChargeIdsByDebtor.set(debtorId, currentChargeIds);
      }
    }

    const selectable = new Set<string>();
    for (const debtor of debtors) {
      const debtorId = String(debtor.id ?? "").trim();
      if (!debtorId) continue;
      const options = debtorReferenceDateOptions(debtor);
      if (!options.length) continue;
      const openSchedulesCount = openSchedulesCountByDebtor.get(debtorId) ?? 0;
      if (openSchedulesCount >= options.length) continue;
      const occupied = occupiedDatesByDebtor.get(debtorId) ?? new Set<string>();
      const occupiedChargeIds = occupiedChargeIdsByDebtor.get(debtorId) ?? new Set<string>();
      const hasAvailableDate = options.some((option) =>
        option.chargeId ? !occupiedChargeIds.has(option.chargeId) : !occupied.has(option.value),
      );
      if (hasAvailableDate) {
        selectable.add(debtorId);
      }
    }

    if (editing?.debtor_id) {
      selectable.add(String(editing.debtor_id));
    }

    return selectable;
  }, [debtors, editing, effectiveTimeZone, rows]);
  const selectableDebtors = useMemo(
    () => debtors.filter((debtor) => selectableDebtorIds.has(String(debtor.id ?? ""))),
    [debtors, selectableDebtorIds],
  );
  const selectedDebtorReferenceOptions = useMemo(
    () =>
      debtorReferenceOptions.filter(
        (option) =>
          option.chargeId
            ? !occupiedDebtorChargeIds.has(option.chargeId) || option.chargeId === editingChargeId
            : !occupiedDebtorReferenceDates.has(option.value) || option.value === editingReferenceDate,
      ),
    [debtorReferenceOptions, editingChargeId, editingReferenceDate, occupiedDebtorChargeIds, occupiedDebtorReferenceDates],
  );
  const noAvailableReferenceDates =
    debtorReferenceOptions.length > 0 && selectedDebtorReferenceOptions.length === 0;
  const selectedDebtorReferenceOption = useMemo(() => {
    if (selectedChargeId) {
      const matchedByCharge = selectedDebtorReferenceOptions.find(
        (option) => String(option.chargeId ?? "").trim() === selectedChargeId,
      );
      if (matchedByCharge) return matchedByCharge;
    }
    const currentDate = normalizeDateOnly(scheduleDateValue);
    if (currentDate) {
      const matchedByDate = selectedDebtorReferenceOptions.find((option) => option.value === currentDate);
      if (matchedByDate) return matchedByDate;
    }
    return selectedDebtorReferenceOptions[0] ?? null;
  }, [scheduleDateValue, selectedChargeId, selectedDebtorReferenceOptions]);
  const selectedDebtorReferenceDate = selectedDebtorReferenceOption?.value ?? "";
  const selectedDebtorReferenceKey = selectedDebtorReferenceOption
    ? debtorReferenceOptionKey(selectedDebtorReferenceOption)
    : "";

  useEffect(() => {
    if (!open || !selectedDebtorId) return;
    const retryDefaults = normalizeDebtorRetryValues(selectedDebtor);
    setValue("retry_weekdays", retryDefaults.retry_weekdays, { shouldDirty: false });
    setValue("retry_time", retryDefaults.retry_time, { shouldDirty: false });
    setValue("retry_max_attempts", retryDefaults.retry_max_attempts, { shouldDirty: false });
    setValue("retry_interval_days", retryDefaults.retry_interval_days, { shouldDirty: false });
    setValue("retry_auto_close_days", retryDefaults.retry_auto_close_days, { shouldDirty: false });
  }, [open, selectedDebtor, selectedDebtorId, setValue]);

  useEffect(() => {
    if (!open) return;
    setValue("data_envio_date", selectedDebtorReferenceDate, { shouldDirty: false, shouldTouch: false });
    setValue("charge_id", selectedDebtorReferenceOption?.chargeId ?? "", {
      shouldDirty: false,
      shouldTouch: false,
    });
  }, [open, selectedDebtorId, selectedDebtorReferenceDate, selectedDebtorReferenceOption, setValue]);

  const currentTimeForPicker = useMemo(() => {
    if (!timePickerTarget) return "";
    if (timePickerTarget.kind === "main") return typeof timeValue === "string" ? timeValue : "";
    return monthlyExtras[timePickerTarget.index]?.time ?? "";
  }, [monthlyExtras, timePickerTarget, timeValue]);
  const currentMinSchedule = useMemo(
    () => currentMinScheduleLocalDateTime(effectiveTimeZone),
    [effectiveTimeZone, open, timePickerOpen, timePickerTarget, timeValue, monthlyExtras],
  );
  const currentPickerDate = useMemo(() => {
    if (!timePickerTarget) return "";
    if (timePickerTarget.kind === "main") return String(scheduleDateValue ?? "");
    return monthlyExtras[timePickerTarget.index]?.date ?? "";
  }, [monthlyExtras, scheduleDateValue, timePickerTarget]);
  const existingMonthlySchedulesForDebtor = useMemo(
    () =>
      rows.filter(
        (row) =>
          String(row.debtor_id ?? "") === String(selectedDebtorId ?? "") &&
          String(row.recurrence ?? "") === "monthly",
      ).length,
    [rows, selectedDebtorId],
  );
  const editingCountsAsMonthlyForSelectedDebtor = Boolean(
    editing &&
      String(editing.recurrence ?? "") === "monthly" &&
      String(editing.debtor_id ?? "") === String(selectedDebtorId ?? ""),
  );
  const baseMonthlySchedulesCount = isMonthlyRecurrence
    ? existingMonthlySchedulesForDebtor + (editing ? (editingCountsAsMonthlyForSelectedDebtor ? 0 : 1) : 1)
    : 0;
  const currentProjectedMonthlySchedulesCount = isMonthlyRecurrence
    ? baseMonthlySchedulesCount + monthlyExtras.length
    : 0;
  const recurrenceUntilMax = useMemo(
    () =>
      recurrenceLimitMaxDateFromLocalDate({
        recurrence: recurrenceValue ?? "none",
        currentDate: String(scheduleDateValue ?? ""),
      }),
    [recurrenceValue, scheduleDateValue],
  );

  useEffect(() => {
    if (recurrenceValue !== "monthly" && monthlyExtras.length > 0) {
      setMonthlyExtras([]);
    }
  }, [monthlyExtras.length, recurrenceValue]);

  const setTimeForTarget = (next: string, closeAfter = false) => {
    if (!timePickerTarget) return;
    if (timePickerTarget.kind === "main") {
      setValue("data_envio_time", next, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    } else {
      const idx = timePickerTarget.index;
      setMonthlyExtras((prev) => prev.map((c, i) => (i === idx ? { ...c, time: next } : c)));
    }
    if (closeAfter) {
      setTimePickerOpen(false);
      setTimePickerTarget(null);
    }
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setTimePickerOpen(false);
    setTimePickerTarget(null);
    setMonthlyExtras([]);
    reset({
      debtor_id: "",
      charge_id: "",
      template_pending_id: "",
      template_overdue_id: "",
      data_envio_date: "",
      data_envio_time: "",
      recurrence: "none",
      recurrence_until: "",
      status: "agendado",
      retry_weekdays: DEFAULT_RETRY_WEEKDAYS,
      retry_time: DEFAULT_RETRY_TIME,
      retry_max_attempts: DEFAULT_RETRY_MAX_ATTEMPTS,
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    });
  };

  const openCreate = () => {
    const msg = prereqMessage("criar/editar");
    if (msg) {
      modalToast.error(msg);
      return;
    }
    close();
    setOpen(true);
  };

  const openEdit = (row: ScheduleRow) => {
    const msg = prereqMessage("criar/editar");
    if (msg) {
      modalToast.error(msg);
      return;
    }
    setEditing(row);
    setOpen(true);
    setMonthlyExtras([]);
    const retryDefaults = normalizeDebtorRetryValues(debtorsById.get(String(row.debtor_id)) ?? null);
    const dt = getEditDateTime(row);
    const debtorReferenceDate = scheduleReferenceLocalDate(row, effectiveTimeZone);
    reset({
      id: row.id,
      debtor_id: row.debtor_id,
      charge_id: row.charge_id ?? "",
      template_pending_id: row.template_pending_id ?? row.template_id ?? "",
      template_overdue_id: row.template_overdue_id ?? row.template_id ?? "",
      data_envio_date: debtorReferenceDate || dt.date,
      data_envio_time: dt.time,
      recurrence:
        String((row as any).recurrence ?? "none") === "yearly"
          ? "yearly"
          : String((row as any).recurrence ?? "none") === "monthly"
            ? "monthly"
            : "none",
      recurrence_until: normalizeDateOnly(row.recurrence_until),
      status: row.status,
      retry_weekdays: retryDefaults.retry_weekdays,
      retry_time: retryDefaults.retry_time,
      retry_max_attempts: retryDefaults.retry_max_attempts,
      retry_interval_days: retryDefaults.retry_interval_days,
      retry_auto_close_days: retryDefaults.retry_auto_close_days,
    });
  };

  const refresh = () =>
    startTransition(async () => {
      const r = await fetch("/app/agendar/data", { cache: "no-store" });
      const json = (await r.json()) as ScheduleRow[];
      setRows(json);
    });

  const onSubmit = handleSubmit(async (values) => {
    const msg = prereqMessage("criar/editar");
    if (msg) {
      modalToast.error(msg);
      return;
    }
    if (!values.debtor_id) {
      modalToast.warning("Selecione um cliente.");
      return;
    }
    if (!values.template_pending_id) {
      modalToast.warning("Selecione o template agendado.");
      return;
    }
    if (!values.template_overdue_id) {
      modalToast.warning("Selecione o template atrasado.");
      return;
    }
    if (!selectedDebtorReferenceDate) {
      modalToast.warning(
        noAvailableReferenceDates
          ? "Todas as datas desse cliente já estão em uso em Agendar."
          : "Esse cliente não possui data cadastrada para o agendamento.",
      );
      return;
    }
    if (!values.data_envio_time) {
      modalToast.warning("Selecione a hora.");
      return;
    }
    if (values.recurrence === "monthly") {
      if (currentProjectedMonthlySchedulesCount > MAX_MONTHLY_SCHEDULES_PER_DEBTOR) {
        modalToast.warning(
          `Esse cliente pode ter no máximo ${MAX_MONTHLY_SCHEDULES_PER_DEBTOR} cobranças mensais no bloco "Cobranças no mês".`,
        );
        return;
      }
      for (const [i, c] of monthlyExtras.entries()) {
        if (!c.date || !c.time) {
          modalToast.warning(`Preencha data e hora da cobrança adicional ${i + 1}.`);
          return;
        }
      }
    }

    const normalizedEditDate = selectedDebtorReferenceDate;
    const normalizedRecurrenceUntil = normalizeDateOnly(values.recurrence_until);
    const effectiveRecurrenceUntil =
      values.recurrence === "yearly"
        ? normalizedRecurrenceUntil || recurrenceUntilMax || undefined
        : values.recurrence !== "none"
          ? normalizedRecurrenceUntil || undefined
          : undefined;

    const payload = {
      ...(values.id ? { id: values.id } : {}),
      debtor_id: values.debtor_id,
      charge_id: selectedDebtorReferenceOption?.chargeId ?? undefined,
      template_pending_id: values.template_pending_id ? values.template_pending_id : undefined,
      template_overdue_id: values.template_overdue_id ? values.template_overdue_id : undefined,
      data_envio_date: normalizedEditDate,
      data_envio_time: values.data_envio_time,
      recurrence: values.recurrence,
      recurrence_until: effectiveRecurrenceUntil,
      status: values.status || "agendado",
      retry_weekdays: normalizeRetryWeekdays(values.retry_weekdays),
      retry_time: values.retry_time || DEFAULT_RETRY_TIME,
      retry_max_attempts: Math.min(
        MAX_RETRY_ATTEMPTS_PER_DAY,
        Number(values.retry_max_attempts) || DEFAULT_RETRY_MAX_ATTEMPTS,
      ),
      retry_interval_days: Number(values.retry_interval_days) || DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: Number(values.retry_auto_close_days) || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    };

    if (
      values.recurrence !== "none" &&
      normalizedRecurrenceUntil &&
      normalizedRecurrenceUntil < normalizedEditDate
    ) {
      modalToast.warning("A data final deve ser igual ou posterior à primeira cobrança.");
      return;
    }
    if (values.recurrence === "yearly" && recurrenceUntilMax && normalizedRecurrenceUntil && normalizedRecurrenceUntil > recurrenceUntilMax) {
      modalToast.warning(
        `A recorrência anual permite no máximo ${MAX_YEARLY_RECURRENCE_OCCURRENCES} cobranças até ${recurrenceUntilMax}.`,
      );
      return;
    }

    try {
      if (
        !isFutureScheduleDateTime({
          date: normalizedEditDate,
          time: values.data_envio_time,
          timeZone: effectiveTimeZone,
        })
      ) {
        modalToast.error("Escolha um horário futuro válido (mínimo +3 minutos).");
        return;
      }
    } catch {
      modalToast.warning("Data/hora inválida.");
      return;
    }
    if (values.recurrence === "monthly") {
      try {
        for (const c of monthlyExtras) {
          if (
            !isFutureScheduleDateTime({
              date: c.date,
              time: c.time,
              timeZone: effectiveTimeZone,
            })
          ) {
            modalToast.error("Escolha um horário futuro válido (mínimo +3 minutos).");
            return;
          }
        }
      } catch {
        modalToast.warning("Data/hora inválida.");
        return;
      }
    }

    const res = editing
      ? await updateScheduleAction(payload)
      : await createScheduleAction(payload);

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    if (values.recurrence === "monthly" && monthlyExtras.length > 0) {
      for (const c of monthlyExtras) {
        const extraRes = await createScheduleAction({
          debtor_id: values.debtor_id,
          charge_id: undefined,
          template_pending_id: values.template_pending_id ? values.template_pending_id : undefined,
          template_overdue_id: values.template_overdue_id ? values.template_overdue_id : undefined,
          data_envio_date: c.date,
          data_envio_time: c.time,
          recurrence: "monthly",
          recurrence_until: effectiveRecurrenceUntil,
          status: values.status || "agendado",
          retry_weekdays: normalizeRetryWeekdays(values.retry_weekdays),
          retry_time: values.retry_time || DEFAULT_RETRY_TIME,
          retry_max_attempts: Math.min(
            MAX_RETRY_ATTEMPTS_PER_DAY,
            Number(values.retry_max_attempts) || DEFAULT_RETRY_MAX_ATTEMPTS,
          ),
          retry_interval_days: Number(values.retry_interval_days) || DEFAULT_RETRY_INTERVAL_DAYS,
          retry_auto_close_days: Number(values.retry_auto_close_days) || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
        });
        if (!extraRes.ok) {
          modalToast.error(extraRes.error ?? "Falha ao salvar cobrança adicional.");
          break;
        }
      }
    }

    if (!editing) {
      close();
      const toastId = modalToast.success("Agendamento criado.");
      await modalToast.wait(toastId);
      window.location.reload();
      return;
    }
    close();
    const toastId = modalToast.success("Agendamento atualizado.");
    await modalToast.wait(toastId);
    window.location.reload();
  });

  const remove = async (row: ScheduleRow) => {
    const confirmed = await modalToast.confirm(
      `Tem certeza que deseja excluir o agendamento do cliente "${row.debtor_nome}"?`,
      { title: "Excluir agendamento", confirmText: "Excluir", cancelText: "Cancelar" },
    );
    if (!confirmed) return;
    const res = await deleteScheduleAction(row.id);
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao excluir.");
      return;
    }
    const toastId = modalToast.success("Agendamento excluído.");
    await modalToast.wait(toastId);
    window.location.reload();
  };

  const triggerNow = (row: ScheduleRow) => {
    const msg = prereqMessage("disparar");
    if (msg) {
      modalToast.error(msg);
      return;
    }
    const visualStatus = displayStatus(row);
    const effectiveTimeZone = (String(row.schedule_timezone ?? "").trim() || timeZone) as BrazilTimeZone;
    const referenceMoment =
      visualStatus.isCurrentMonth && visualStatus.referenceMoment
        ? visualStatus.referenceMoment
        : new Date().toISOString();
    const referenceMonthCompactLabel = referenceMoment ? monthYearCompactBR(referenceMoment, effectiveTimeZone) : null;
    const referenceYearMonth = visualStatus.isCurrentMonth
      ? visualStatus.referenceMonthKey
      : operationalMonthKey;
    const executedYearMonth = row.last_executed_scheduled_for
      ? yearMonthKey(row.last_executed_scheduled_for, effectiveTimeZone)
      : "";
    const alreadyProcessed = visualStatus.isPaid;
    const alreadyTriggeredThisMonth =
      visualStatus.isCurrentMonth &&
      visualStatus.isExecuted &&
      !visualStatus.isPaid &&
      Boolean(executedYearMonth) &&
      executedYearMonth === referenceYearMonth;
    if (alreadyProcessed) {
      modalToast.info(
        `Você já marcou a cobrança de ${referenceMonthCompactLabel ?? "referência atual"} de "${row.debtor_nome}" como pagamento realizado. Isso evita registros duplicados e deixa claro que a cobrança já foi processada.`,
      );
      return;
    }
    if (alreadyTriggeredThisMonth) {
      modalToast.info(
        `Você já disparou a cobrança de ${referenceMonthCompactLabel ?? "referência atual"} de "${row.debtor_nome}". Isso evita registros duplicados e deixa claro que esse envio já foi processado no mês.`,
      );
      return;
    }
    if (visualStatus.isCurrentMonth && String(row.status ?? "") === "suspeita_de_pagamento") {
      modalToast.info("Pagamento em análise. Confirme no painel para continuar.");
      return;
    }
    if (visualStatus.isExecuted && !visualStatus.isPaid) {
      modalToast.info("Essa cobrança já foi enviada e está aguardando pagamento.");
      return;
    }
    if (String(row.status ?? "") === "executando") {
      modalToast.info("Esse agendamento já está sendo processado.");
      return;
    }
    setTriggeringId(row.id);
    startTransition(async () => {
      const res = await triggerScheduleNowAction(row.id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao disparar.");
        setTriggeringId(null);
        return;
      }
      setTriggeringId(null);
      const toastId = modalToast.success("Disparo iniciado.");
      await modalToast.wait(toastId);
      window.location.reload();
    });
  };

  const markAsPaid = async (row: ScheduleRow) => {
    const visualStatus = displayStatus(row);
    const effectiveTimeZone = (String(row.schedule_timezone ?? "").trim() || timeZone) as BrazilTimeZone;
    const referenceMoment =
      visualStatus.isCurrentMonth && visualStatus.referenceMoment
        ? visualStatus.referenceMoment
        : new Date().toISOString();
    const referenceMonthLabel = referenceMoment ? monthYearBR(referenceMoment, effectiveTimeZone) : null;
    const referenceMonthCompactLabel = referenceMoment ? monthYearCompactBR(referenceMoment, effectiveTimeZone) : null;
    const nextRecurringMoment = getNextRecurringMoment(row, effectiveTimeZone);
    const nextReferenceLabel = nextRecurringMoment ? monthYearBR(nextRecurringMoment, effectiveTimeZone) : null;
    if (visualStatus.isPaid) {
      modalToast.info(
        `Você já marcou a cobrança de ${referenceMonthCompactLabel ?? "referência atual"} de "${row.debtor_nome}" como pagamento realizado. Isso evita registros duplicados e deixa claro que a cobrança já foi processada.`,
      );
      return;
    }
    const confirmed = await modalToast.confirm(
      String(row.recurrence ?? "none") === "monthly"
        ? `Deseja marcar a mensalidade de ${referenceMonthLabel ?? "referência atual"} de "${row.debtor_nome}" como quitada e avançar a próxima cobrança para ${nextReferenceLabel ?? "o próximo mês"}?`
        : String(row.recurrence ?? "none") === "yearly"
          ? `Deseja marcar a cobrança anual de ${referenceMonthLabel ?? "referência atual"} de "${row.debtor_nome}" como quitada e avançar a próxima cobrança para ${nextReferenceLabel ?? "o próximo ano"}?`
          : `Marcar a cobrança atual de "${row.debtor_nome}" como paga?`,
      {
        title: "Pagamento realizado",
        confirmText: "Confirmar",
        cancelText: "Cancelar",
      },
    );
    if (!confirmed) return;

    setMarkingPaidId(row.id);
    startTransition(async () => {
      const res = await markSchedulePaidAction(row.id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao marcar pagamento.");
        setMarkingPaidId(null);
        return;
      }
      setMarkingPaidId(null);
      const toastId = modalToast.success(
        String(row.recurrence ?? "none") === "monthly"
          ? "Mensalidade atual marcada como quitada."
          : String(row.recurrence ?? "none") === "yearly"
            ? "Cobrança anual atual marcada como quitada."
            : "Cobrança marcada como paga.",
      );
      await modalToast.wait(toastId);
      window.location.reload();
    });
  };

  const timeField = register("data_envio_time", { required: true });
  const recurrenceUntilField = register("recurrence_until");
  const openExtraDatePicker = (index: number) => {
    extraDateInputRefs.current[index]?.showPicker?.();
    extraDateInputRefs.current[index]?.focus();
  };
  const openRecurrenceUntilDatePicker = () => {
    recurrenceUntilInputRef.current?.showPicker?.();
    recurrenceUntilInputRef.current?.focus();
  };
  const openTimePicker = (params: {
    target: { kind: "main" } | { kind: "extra"; index: number };
    inputEl: HTMLInputElement | null;
    anchorEl: HTMLDivElement | null;
  }) => {
    const rect = params.inputEl?.getBoundingClientRect();
    if (!rect) return;

    const pickerWidth = 260;
    const pickerHeight = 256;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const left = Math.max(gap, Math.min(rect.right - pickerWidth, vw - pickerWidth - gap));
    const belowTop = rect.bottom + gap;
    const shouldOpenAbove = vh - rect.bottom < pickerHeight + gap && rect.top > pickerHeight + gap;
    const top = shouldOpenAbove ? Math.max(gap, rect.top - gap - pickerHeight) : belowTop;

    setTimePickerPos({ left, top });
    setTimePickerOpen(true);
    setTimePickerTarget(params.target);
    timePickerAnchorRef.current = params.anchorEl;
  };

  useLayoutEffect(() => {
    if (!timePickerOpen) return;
    const onUpdate = () => {
      if (!timePickerTarget) return;
      if (timePickerTarget.kind !== "extra") return;
      const idx = timePickerTarget.index;
      openTimePicker({
        target: timePickerTarget,
        inputEl: extraTimeInputRefs.current[idx] ?? null,
        anchorEl: extraTimeAnchorRefs.current[idx] ?? null,
      });
    };
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [timePickerOpen, timePickerTarget]);

  useEffect(() => {
    if (!timePickerOpen) return;
    const onPointerDown = (e: Event) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (timePickerAnchorRef.current?.contains(t)) return;
      if (timePickerPanelRef.current?.contains(t)) return;
      setTimePickerOpen(false);
      setTimePickerTarget(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [timePickerOpen]);

  return (
    <div>
      {timePickerOpen && timePickerPos
        ? createPortal(
            <div
              ref={timePickerPanelRef}
              className="fixed z-[220] w-[260px] rounded-xl border border-[var(--app-border)] bg-[var(--app-modal-bg)] p-2"
              style={{ left: timePickerPos.left, top: timePickerPos.top }}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="max-h-56 overflow-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-card)]">
                  {Array.from({ length: 24 }).map((_, i) => {
                    const h = String(i).padStart(2, "0");
                    const currentMinute =
                      typeof currentTimeForPicker === "string" && currentTimeForPicker.length >= 5
                        ? currentTimeForPicker.slice(3, 5)
                        : "00";
                    const disabled =
                      Boolean(currentPickerDate) &&
                      !isFutureScheduleDateTime({
                        date: currentPickerDate,
                        time: `${h}:${currentMinute}`,
                        timeZone: effectiveTimeZone,
                      });
                    const selected =
                      typeof currentTimeForPicker === "string" && currentTimeForPicker.slice(0, 2) === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setTimeForTarget(`${h}:${currentMinute}`);
                        }}
                        className={[
                          "flex w-full items-center justify-center px-3 py-2 text-sm font-semibold",
                          selected
                            ? "bg-[var(--app-active)] text-[var(--app-text-85)]"
                            : "text-[var(--app-text-80)] hover:bg-[var(--app-hover)]",
                          disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : "",
                        ].join(" ")}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
                <div className="max-h-56 overflow-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-card)]">
                  {Array.from({ length: 60 }).map((_, i) => {
                    const m = String(i).padStart(2, "0");
                    const currentHour =
                      typeof currentTimeForPicker === "string" && currentTimeForPicker.length >= 2
                        ? currentTimeForPicker.slice(0, 2)
                        : currentMinSchedule.time.slice(0, 2);
                    const disabled =
                      Boolean(currentPickerDate) &&
                      !isFutureScheduleDateTime({
                        date: currentPickerDate,
                        time: `${currentHour}:${m}`,
                        timeZone: effectiveTimeZone,
                      });
                    const selected =
                      typeof currentTimeForPicker === "string" && currentTimeForPicker.slice(3, 5) === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setTimeForTarget(`${currentHour}:${m}`, true);
                        }}
                        className={[
                          "flex w-full items-center justify-center px-3 py-2 text-sm font-semibold",
                          selected
                            ? "bg-[var(--app-active)] text-[var(--app-text-85)]"
                            : "text-[var(--app-text-80)] hover:bg-[var(--app-hover)]",
                          disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : "",
                        ].join(" ")}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
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
        <div className="min-[1201px]:hidden">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-white/55">
              Nenhum agendamento encontrado.
            </div>
          ) : (
            <div className="grid gap-3 p-3">
              {pagedRows.map((r) => (
                (() => {
                  const visualStatus = displayStatus(r);
                  const moments = displayMoments(r);
                  return (
                <div
                  key={r.id}
                  className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                        {r.debtor_nome}
                      </div>
                      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                        Agendamento
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${visualStatus.className}`}>
                        {visualStatus.label}
                      </span>
                      {visualStatus.subtitle ? (
                        <div className="mt-1 text-[10px] font-medium text-[var(--app-text-60)]">
                          {visualStatus.subtitle}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                        Template pendente
                      </div>
                      <div
                        className="mt-1 truncate text-sm font-semibold text-[var(--app-text-85)]"
                        title={r.template_pending_nome ?? "-"}
                      >
                        {r.template_pending_nome ?? "-"}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                        Template atrasado
                      </div>
                      <div
                        className="mt-1 truncate text-sm font-semibold text-[var(--app-text-85)]"
                        title={r.template_overdue_nome ?? "-"}
                      >
                        {r.template_overdue_nome ?? "-"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                        Vencimento
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[var(--app-text-85)]">
                        {moments.primaryDate}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                        Hora
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[var(--app-text-85)]">
                        {moments.primaryTime}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                      Agendado para
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[var(--app-text-85)]">
                      {moments.scheduledDate}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                      Ações
                    </div>
                    {renderActionButtons(r, "mobile")}
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </div>

        <div className="hidden min-[1201px]:block">
          <div className="overflow-x-auto">
            <div className="min-w-[1080px] min-[1201px]:min-w-0">
              <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1.15fr)_7rem_5rem_minmax(0,1fr)_8rem_11rem] gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-[var(--app-text-60)]">
                <div>Cliente</div>
                <div className="text-center">Templates</div>
                <div className="text-center">Vencimento</div>
                <div className="text-center">Hora</div>
                <div className="text-center">Agendado para</div>
                <div className="text-center">Status</div>
                <div className="text-right">Ações</div>
              </div>

              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-white/55">
                  Nenhum agendamento encontrado.
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {pagedRows.map((r) => (
                    (() => {
                      const visualStatus = displayStatus(r);
                      const moments = displayMoments(r);
                      return (
                      <div
                        key={r.id}
                        className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1.15fr)_7rem_5rem_minmax(0,1fr)_8rem_11rem] items-center gap-3 px-4 py-3 text-sm text-[var(--app-text-80)]"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--app-text-85)]" title={r.debtor_nome}>
                            {r.debtor_nome}
                          </div>
                        </div>
                        <div className="min-w-0 text-center text-[var(--app-text-70)]">
                          <div className="truncate font-semibold text-[var(--app-text-80)]">
                            {r.template_pending_nome ?? "-"}
                          </div>
                          <div className="truncate text-[11px] text-[var(--app-text-55)]">
                            {r.template_overdue_nome ?? "-"}
                          </div>
                        </div>
                        <div className="whitespace-nowrap text-center text-[var(--app-text-70)]">
                          {moments.primaryDate}
                        </div>
                        <div className="whitespace-nowrap text-center text-[var(--app-text-70)]">
                          {moments.primaryTime}
                        </div>
                        <div className="min-w-0 text-center text-[var(--app-text-70)]">
                          <div className="truncate font-semibold text-[var(--app-text-80)]">
                            {moments.scheduledDate}
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <div className="flex flex-col items-center">
                            <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${visualStatus.className}`}>
                              {visualStatus.label}
                            </span>
                            {visualStatus.subtitle ? (
                              <div className="mt-1 text-[10px] font-medium text-[var(--app-text-55)]">
                                {visualStatus.subtitle}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex justify-end">
                          {renderActionButtons(r, "desktop")}
                        </div>
                      </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
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

      <AppModal open={open} onClose={close} size="lg" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">
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
              <input type="hidden" {...register("status")} />
              <input type="hidden" {...register("charge_id")} />
              <div>
                <div className="text-xs font-semibold text-white/60">
                  Cliente
                </div>
                <select
                  className="mt-2 w-full truncate overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                  {...register("debtor_id", { required: true })}
                >
                  <option value="">Selecione...</option>
                  {selectableDebtors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-white/60">Template Agendado</div>
                  <select
                    className="mt-2 w-full truncate overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                    {...register("template_pending_id")}
                  >
                    <option value="">Selecione...</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-xs font-semibold text-white/60">Template Atrasado</div>
                  <select
                    className="mt-2 w-full truncate overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                    {...register("template_overdue_id")}
                  >
                    <option value="">Selecione...</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-white/60">
                  Recorrência
                </div>
                <select
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                  {...register("recurrence")}
                >
                  <option value="none">Uma vez</option>
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                </select>
              </div>

              <div className="grid gap-3">
                <div>
                  <div className="text-xs font-semibold text-white/60">
                    Data do cliente
                  </div>
                  {selectedDebtorReferenceOptions.length > 1 ? (
                    <select
                      className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                      value={selectedDebtorReferenceKey}
                      onChange={(e) => {
                        const option =
                          selectedDebtorReferenceOptions.find(
                            (item) => debtorReferenceOptionKey(item) === e.target.value,
                          ) ?? null;
                        setValue("data_envio_date", option?.value ?? "", {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                        setValue("charge_id", option?.chargeId ?? "", {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                      }}
                    >
                      {selectedDebtorReferenceOptions.map((option) => (
                        <option key={debtorReferenceOptionKey(option)} value={debtorReferenceOptionKey(option)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      className="mt-2 flex h-[42px] items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {selectedDebtorReferenceDate ? (
                        localDateBR(selectedDebtorReferenceDate)
                      ) : (
                        <span className="text-white/45">
                          {noAvailableReferenceDates
                            ? "Todas as datas deste cliente já estão em uso."
                            : "Selecione um cliente com data cadastrada."}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-white/60">
                    Hora
                  </div>
                  <div className="relative mt-2">
                    <input
                      type="time"
                      step={60}
                      disabled={!selectedDebtorReferenceDate}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:dark]"
                      onClick={(e) => {
                        if (!selectedDebtorReferenceDate) return;
                        e.currentTarget.showPicker?.();
                      }}
                      {...timeField}
                    />
                  </div>
                </div>
              </div>

              {hasRecurringSchedule ? (
                <div className="mt-1">
                  {isMonthlyRecurrence ? (
                    <>
                      {monthlyExtras.length > 0 ? (
                        <div className="mt-3 grid gap-3">
                          {monthlyExtras.map((c, idx) => (
                            <div
                              key={idx}
                              className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
                            >
                              <div>
                                <div className="text-xs font-semibold text-white/60">Data</div>
                                <div className="relative mt-2">
                                  <input
                                    type="date"
                                    min={scheduleDateMin}
                                    value={c.date}
                                    onChange={(e) =>
                                      setMonthlyExtras((prev) =>
                                        prev.map((x, i) => (i === idx ? { ...x, date: e.target.value } : x)),
                                      )
                                    }
                                    onFocus={() => openExtraDatePicker(idx)}
                                    onClick={() => openExtraDatePicker(idx)}
                                    ref={(el) => {
                                      extraDateInputRefs.current[idx] = el;
                                    }}
                                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => openExtraDatePicker(idx)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-white/80"
                                    aria-label="Selecionar data"
                                  >
                                    <Calendar className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              <div>
                                <div className="text-xs font-semibold text-white/60">Hora</div>
                                <div
                                  className="relative mt-2"
                                  ref={(el) => {
                                    extraTimeAnchorRefs.current[idx] = el;
                                  }}
                                >
                                  <input
                                    type="text"
                                    readOnly
                                    value={c.time}
                                    placeholder="--:--"
                                    onFocus={() =>
                                      openTimePicker({
                                        target: { kind: "extra", index: idx },
                                        inputEl: extraTimeInputRefs.current[idx] ?? null,
                                        anchorEl: extraTimeAnchorRefs.current[idx] ?? null,
                                      })
                                    }
                                    onClick={() =>
                                      openTimePicker({
                                        target: { kind: "extra", index: idx },
                                        inputEl: extraTimeInputRefs.current[idx] ?? null,
                                        anchorEl: extraTimeAnchorRefs.current[idx] ?? null,
                                      })
                                    }
                                    ref={(el) => {
                                      extraTimeInputRefs.current[idx] = el;
                                    }}
                                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openTimePicker({
                                        target: { kind: "extra", index: idx },
                                        inputEl: extraTimeInputRefs.current[idx] ?? null,
                                        anchorEl: extraTimeAnchorRefs.current[idx] ?? null,
                                      })
                                    }
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
                                    aria-label="Selecionar hora"
                                  >
                                    <Clock className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              <div className="flex justify-end md:pb-0.5">
                                <button
                                  type="button"
                                  onClick={() => setMonthlyExtras((prev) => prev.filter((_, i) => i !== idx))}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
                                  aria-label="Remover cobrança"
                                  title="Remover"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  <div>
                    <div className="text-xs font-semibold text-white/60">Encerrar em (Opcional)</div>
                    <div className="relative mt-2">
                      <input
                        type="date"
                        min={watch("data_envio_date") || undefined}
                        max={recurrenceUntilMax || undefined}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0"
                        {...recurrenceUntilField}
                        onFocus={openRecurrenceUntilDatePicker}
                        onClick={openRecurrenceUntilDatePicker}
                        ref={(el) => {
                          recurrenceUntilField.ref(el);
                          recurrenceUntilInputRef.current = el;
                        }}
                      />
                      <button
                        type="button"
                        onClick={openRecurrenceUntilDatePicker}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-white/80"
                        aria-label="Selecionar data final"
                      >
                        <Calendar className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xs font-semibold text-white/70">
                  Reenvio de cobrança em atraso
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
                  </div>
                  <input type="hidden" {...register("retry_interval_days", { valueAsNumber: true })} />
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
                {editing ? "Salvar alterações" : "Criar agendamento"}
              </button>
        </form>
      </AppModal>

    </div>
  );
}
