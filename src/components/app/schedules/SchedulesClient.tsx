"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { createPortal } from "react-dom";
import { Calendar, Check, Clock, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import { type BrazilTimeZone, zonedDateTimeToUtcIso } from "@/lib/timezone";
import {
  createScheduleAction,
  deleteScheduleAction,
  markSchedulePaidAction,
  triggerScheduleNowAction,
  updateScheduleRecurrenceUntilAction,
  updateScheduleAction,
} from "@/app/app/agenda/actions";

export type DebtorOption = { id: string; nome: string };
export type TemplateOption = { id: string; nome: string };

export type ScheduleRow = {
  id: string;
  debtor_id: string;
  template_id: string | null;
  data_envio: string;
  status: string;
  recurrence?: string | null;
  recurrence_until?: string | null;
  created_at: string;
  debtor_nome: string;
  template_nome: string | null;
};

type FormValues = {
  id?: string;
  debtor_id: string;
  template_id?: string;
  data_envio_date: string;
  data_envio_time: string;
  recurrence: "none" | "monthly";
  recurrence_until: string;
  status: string;
};

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

function dateOnlyBR(v: string) {
  if (!v) return "-";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
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
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ScheduleRow[]>(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [recurrenceLimitOpen, setRecurrenceLimitOpen] = useState(false);
  const [recurrenceLimitRow, setRecurrenceLimitRow] = useState<ScheduleRow | null>(null);
  const [recurrenceLimitValue, setRecurrenceLimitValue] = useState("");
  const [savingRecurrenceLimit, setSavingRecurrenceLimit] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timePickerRef = useRef<HTMLDivElement | null>(null);
  const timePickerPanelRef = useRef<HTMLDivElement | null>(null);
  const timeInputBoxRef = useRef<HTMLInputElement | null>(null);
  const [timePickerPos, setTimePickerPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const effectiveTimeZone: BrazilTimeZone = timeZone ?? "America/Sao_Paulo";
  const missingTimeZone = !timeZone;
  const missingWhatsApp = !whatsappConfigured;

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
    if (!q) return rows;
    return rows.filter((r) => r.debtor_nome.toLowerCase().includes(q));
  }, [query, rows]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      debtor_id: "",
      template_id: "",
      data_envio_date: "",
      data_envio_time: "",
      recurrence: "none",
      recurrence_until: "",
      status: "agendado",
    },
  });

  const timeValue = watch("data_envio_time");

  const close = () => {
    setOpen(false);
    setEditing(null);
    setTimePickerOpen(false);
    reset({
      debtor_id: "",
      template_id: "",
      data_envio_date: "",
      data_envio_time: "",
      recurrence: "none",
      recurrence_until: "",
      status: "agendado",
    });
  };

  const closeRecurrenceLimit = () => {
    setRecurrenceLimitOpen(false);
    setRecurrenceLimitRow(null);
    setRecurrenceLimitValue("");
    setSavingRecurrenceLimit(false);
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
    const dt = splitDateTimeForInput(row.data_envio, effectiveTimeZone);
    reset({
      id: row.id,
      debtor_id: row.debtor_id,
      template_id: row.template_id ?? "",
      data_envio_date: dt.date,
      data_envio_time: dt.time,
      recurrence: String((row as any).recurrence ?? "none") === "monthly" ? "monthly" : "none",
      recurrence_until: row.recurrence_until ?? "",
      status: row.status,
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
    if (!values.data_envio_date || !values.data_envio_time) {
      modalToast.warning("Selecione a data e a hora.");
      return;
    }

    const payload = {
      ...(values.id ? { id: values.id } : {}),
      debtor_id: values.debtor_id,
      template_id: values.template_id ? values.template_id : undefined,
      data_envio_date: values.data_envio_date,
      data_envio_time: values.data_envio_time,
      recurrence: values.recurrence,
      recurrence_until:
        values.recurrence === "monthly" && values.recurrence_until ? values.recurrence_until : undefined,
      status: values.status || "agendado",
    };

    if (
      values.recurrence === "monthly" &&
      values.recurrence_until &&
      values.recurrence_until < values.data_envio_date
    ) {
      modalToast.warning("A data final deve ser igual ou posterior à primeira cobrança.");
      return;
    }

    try {
      const iso = zonedDateTimeToUtcIso({
        date: values.data_envio_date,
        time: values.data_envio_time,
        timeZone: effectiveTimeZone,
      });
      if (new Date(iso).getTime() < Date.now() + 3 * 60 * 1000) {
        modalToast.error("Escolha um horário futuro válido (mínimo +3 minutos).");
        return;
      }
    } catch {
      modalToast.warning("Data/hora inválida.");
      return;
    }

    const res = editing
      ? await updateScheduleAction(payload)
      : await createScheduleAction(payload);

    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao salvar.");
      return;
    }

    modalToast.success(editing ? "Agendamento atualizado." : "Agendamento criado.");
    refresh();
    close();
  });

  const remove = async (row: ScheduleRow) => {
    const confirmed = await modalToast.confirm(
      `Tem certeza que deseja excluir o agendamento do cliente "${row.debtor_nome}"?`,
      { title: "Excluir agendamento", confirmText: "Excluir", cancelText: "Cancelar" },
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await deleteScheduleAction(row.id);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao excluir.");
        return;
      }
      modalToast.success("Agendamento excluído.");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    });
  };

  const triggerNow = (row: ScheduleRow) => {
    const msg = prereqMessage("disparar");
    if (msg) {
      modalToast.error(msg);
      return;
    }
    if (String(row.status ?? "") === "executado") {
      modalToast.info("Esse agendamento já foi executado.");
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
      modalToast.success("Disparo iniciado.");
      await refresh();
      setTriggeringId(null);
    });
  };

  const markAsPaid = async (row: ScheduleRow) => {
    if (String(row.recurrence ?? "none") !== "monthly") {
      modalToast.info("Essa opção está disponível apenas para agendamentos mensais.");
      return;
    }

    const confirmed = await modalToast.confirm(
      `Marcar a mensalidade atual de "${row.debtor_nome}" como quitada e avançar a cobrança para o próximo mês?`,
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
      modalToast.success("Mensalidade atual marcada como quitada.");
      await refresh();
      setMarkingPaidId(null);
    });
  };

  const openRecurrenceLimit = (row: ScheduleRow) => {
    if (String(row.recurrence ?? "none") !== "monthly") {
      modalToast.info("Essa opção está disponível apenas para agendamentos mensais.");
      return;
    }
    setRecurrenceLimitRow(row);
    setRecurrenceLimitValue(row.recurrence_until ?? "");
    setRecurrenceLimitOpen(true);
  };

  const saveRecurrenceLimit = async () => {
    if (!recurrenceLimitRow) return;
    const currentDate = splitDateTimeForInput(recurrenceLimitRow.data_envio, effectiveTimeZone).date;
    if (recurrenceLimitValue && recurrenceLimitValue < currentDate) {
      modalToast.warning("A data final deve ser igual ou posterior à cobrança atual.");
      return;
    }

    setSavingRecurrenceLimit(true);
    try {
      const res = await updateScheduleRecurrenceUntilAction({
        id: recurrenceLimitRow.id,
        recurrence_until: recurrenceLimitValue || null,
      });
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao salvar a data final.");
        return;
      }
      modalToast.success(
        recurrenceLimitValue
          ? "Data final da cobrança mensal salva."
          : "Data final da cobrança mensal removida.",
      );
      await refresh();
      closeRecurrenceLimit();
    } finally {
      setSavingRecurrenceLimit(false);
    }
  };

  const dateField = register("data_envio_date", { required: true });
  const timeField = register("data_envio_time", { required: true });
  const openDatePicker = () => {
    dateInputRef.current?.showPicker?.();
    dateInputRef.current?.focus();
  };
  const openTimePicker = () => {
    const rect = timeInputBoxRef.current?.getBoundingClientRect();
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
  };

  useLayoutEffect(() => {
    if (!timePickerOpen) return;
    const onUpdate = () => openTimePicker();
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [timePickerOpen]);

  useEffect(() => {
    if (!timePickerOpen) return;
    const onPointerDown = (e: Event) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (timePickerRef.current?.contains(t)) return;
      if (timePickerPanelRef.current?.contains(t)) return;
      setTimePickerOpen(false);
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
              className="fixed z-[220] w-[260px] rounded-xl border border-[var(--app-border)] bg-[var(--app-modal-bg)] p-2 shadow-xl"
              style={{ left: timePickerPos.left, top: timePickerPos.top }}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="max-h-56 overflow-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-card)]">
                  {Array.from({ length: 24 }).map((_, i) => {
                    const h = String(i).padStart(2, "0");
                    const selected =
                      typeof timeValue === "string" && timeValue.slice(0, 2) === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          const m =
                            typeof timeValue === "string" && timeValue.length >= 5
                              ? timeValue.slice(3, 5)
                              : "00";
                          setValue("data_envio_time", `${h}:${m}`, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                        }}
                        className={[
                          "flex w-full items-center justify-center px-3 py-2 text-sm font-semibold",
                          selected
                            ? "bg-[var(--app-active)] text-[var(--app-text-85)]"
                            : "text-[var(--app-text-80)] hover:bg-[var(--app-hover)]",
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
                    const selected =
                      typeof timeValue === "string" && timeValue.slice(3, 5) === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          const h =
                            typeof timeValue === "string" && timeValue.length >= 2
                              ? timeValue.slice(0, 2)
                              : "00";
                          setValue("data_envio_time", `${h}:${m}`, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                          setTimePickerOpen(false);
                        }}
                        className={[
                          "flex w-full items-center justify-center px-3 py-2 text-sm font-semibold",
                          selected
                            ? "bg-[var(--app-active)] text-[var(--app-text-85)]"
                            : "text-[var(--app-text-80)] hover:bg-[var(--app-hover)]",
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
        <div className="px-4 pt-3 text-center text-[11px] font-semibold text-white/45 min-[1201px]:hidden">
          Role para o lado.
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[980px] min-[1201px]:min-w-0">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold text-white/55">
              <div className="col-span-3">Cliente</div>
              <div className="col-span-2 text-center">Template</div>
              <div className="col-span-2 text-center">Data</div>
              <div className="col-span-1 text-center">Hora</div>
              <div className="col-span-1 text-center">Status</div>
              <div className="col-span-3 text-right">Ações</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/55">
                Nenhum agendamento encontrado.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="col-span-3 truncate font-semibold">{r.debtor_nome}</div>
                    <div className="col-span-2 truncate text-center text-white/60">
                      {r.template_nome ?? "-"}
                    </div>
                    <div className="col-span-2 whitespace-nowrap text-center text-white/60">
                      {dateBR(r.data_envio, effectiveTimeZone)}
                    </div>
                    <div className="col-span-1 whitespace-nowrap text-center text-white/60">
                      {timeBR(r.data_envio, effectiveTimeZone)}
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-white/70">
                        {r.status}
                      </span>
                    </div>
                    <div className="col-span-3 flex flex-nowrap justify-end gap-2">
                      <button
                        onClick={() => triggerNow(r)}
                        disabled={
                          isPending ||
                          triggeringId === r.id ||
                          markingPaidId === r.id ||
                          String(r.status ?? "") === "executado"
                        }
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
                        title="Disparar agora"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(r)}
                        disabled={isPending || markingPaidId === r.id || savingRecurrenceLimit}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06]"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {String(r.recurrence ?? "none") === "monthly" ? (
                        <button
                          onClick={() => markAsPaid(r)}
                          disabled={
                            isPending ||
                            triggeringId === r.id ||
                            markingPaidId === r.id ||
                            savingRecurrenceLimit
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06] disabled:opacity-60"
                          title="Pagamento Realizado"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      ) : null}
                      {String(r.recurrence ?? "none") === "monthly" ? (
                        <button
                          onClick={() => openRecurrenceLimit(r)}
                          disabled={
                            isPending ||
                            triggeringId === r.id ||
                            markingPaidId === r.id ||
                            savingRecurrenceLimit
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.06] disabled:opacity-60"
                          title="Definir data final"
                        >
                          <Calendar className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => remove(r)}
                        disabled={
                          isPending ||
                          triggeringId === r.id ||
                          markingPaidId === r.id ||
                          savingRecurrenceLimit
                        }
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
              <div>
                <div className="text-xs font-semibold text-white/60">
                  Cliente
                </div>
                <select
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
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
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
                  {...register("template_id")}
                >
                  <option value="">Sem template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
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
                </select>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-white/60">
                    Data
                  </div>
                  <div className="relative mt-2">
                    <input
                      type="date"
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0"
                      {...dateField}
                      onFocus={openDatePicker}
                      onClick={openDatePicker}
                      ref={(el) => {
                        dateField.ref(el);
                        dateInputRef.current = el;
                      }}
                    />
                    <button
                      type="button"
                      onClick={openDatePicker}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-white/80"
                      aria-label="Selecionar data"
                    >
                      <Calendar className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-white/60">
                    Hora
                  </div>
                  <div className="relative mt-2" ref={timePickerRef}>
                    <input type="hidden" {...timeField} />
                    <input
                      type="text"
                      readOnly
                      value={timeValue || ""}
                      placeholder="--:--"
                      onFocus={openTimePicker}
                      onClick={openTimePicker}
                      ref={timeInputBoxRef}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20"
                    />
                    <button
                      type="button"
                      onClick={openTimePicker}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
                      aria-label="Selecionar hora"
                    >
                      <Clock className="h-4 w-4" />
                    </button>
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

      <AppModal open={recurrenceLimitOpen} onClose={closeRecurrenceLimit} size="md" zIndexClass="z-[110]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">
              Cobrança mensal até
            </div>
            <div className="mt-1 text-xs text-white/55">
              Defina até quando a cobrança mensal de {recurrenceLimitRow?.debtor_nome ?? "este cliente"} deve continuar.
            </div>
          </div>
          <button
            onClick={closeRecurrenceLimit}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold text-white/60">
            Data final (opcional)
          </div>
          <div className="relative mt-2">
            <input
              type="date"
              value={recurrenceLimitValue}
              onChange={(e) => setRecurrenceLimitValue(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 pr-10 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/80">
              <Calendar className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 text-[11px] text-white/45">
            Se deixar em branco, a cobrança mensal continua sem limite.
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setRecurrenceLimitValue("")}
            disabled={savingRecurrenceLimit}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
          >
            Remover limite
          </button>
          <button
            type="button"
            onClick={saveRecurrenceLimit}
            disabled={savingRecurrenceLimit}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
          >
            {savingRecurrenceLimit ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </AppModal>
    </div>
  );
}
