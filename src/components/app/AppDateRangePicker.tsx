"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays, X, CalendarRange, CheckCircle2, Clock, Users, Ban, ArrowUpRight } from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale/pt-BR";
import { twMerge } from "tailwind-merge";

export type AppDateRange = {
  from: string | null; // ISO "YYYY-MM-DD"
  to: string | null;
};

type AppDateRangePickerProps = {
  value: AppDateRange;
  onChange: (next: AppDateRange) => void;
  placeholder?: string;
  className?: string;
  labelDe?: string;
  labelAte?: string;
  showLabel?: boolean;
  clearable?: boolean;
  id?: string;
  /** default: "full" (botão largo com label/texto). "icon": botão redondo pequeno h-10 w-10 só com ícone, igual os botões do header */
  size?: "full" | "icon";
  /** cor do anel ativador (padrão: cinza neutro igual refresh. Passar true para laranja quando há filtro ativo. Default: só se tiver from/to preenchido */
  iconActive?: boolean | "auto";
};

function parseToDate(s: string | null): Date | null {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}

function toISODate(d: Date | null): string | null {
  if (!d || !isValid(d)) return null;
  return format(d, "yyyy-MM-dd");
}

const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type PopoverCoords = {
  top: number;
  left: number;
  width: number;
  wMax: number;
};

export function AppDateRangePicker({
  value,
  onChange,
  placeholder = "Calendário",
  className,
  labelDe = "De",
  labelAte = "Até",
  showLabel = true,
  clearable = true,
  id,
  size = "full",
  iconActive = "auto",
}: AppDateRangePickerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords>({
    top: 0,
    left: 0,
    width: 320,
    wMax: 340,
  });
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    setRendered(typeof document !== "undefined");
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewDate, setViewDate] = useState<Date>(() => {
    const fromDateInit = parseToDate(value.from);
    if (fromDateInit) return fromDateInit;
    return new Date();
  });

  const fromDate = useMemo(() => parseToDate(value.from), [value.from]);
  const toDate = useMemo(() => parseToDate(value.to), [value.to]);

  // Dias do calendario (6 semanas = 42 dias)
  const days = useMemo<Date[]>(() => {
    const monthStart = startOfMonth(viewDate);
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    const monthEnd = endOfMonth(viewDate);
    const end = endOfWeek(monthEnd, { weekStartsOn: 0 });

    const out: Date[] = [];
    let cur = start;
    while (isBefore(cur, end) || isSameDay(cur, end)) {
      out.push(cur);
      cur = addDays(cur, 1);
    }
    return out;
  }, [viewDate]);

  // ============================================================
  // MODAL DE PROGRAMAÇÃO DO DIA (Professor por horário)
  // Abre em: desktop = clique SIMPLES no dia (número) | mobile = long-press ~450ms
  // ============================================================
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleData, setScheduleData] = useState<{
    ok: boolean;
    date: string;
    summary: {
      totalSlots: number;
      totalBookings: number;
      totalAvailable: number;
      totalScheduled: number;
      totalPast: number;
      totalCancelled: number;
      totalTeachers: number;
    } | null;
    teachers: Array<{
      name: string;
      phone: string;
      short: string;
      totalSlots: number;
      totalBookings: number;
      totalPast: number;
      totalScheduled: number;
      slots: Array<{
        professorTime: string;
        status: "disponivel" | "ocupado" | "passado" | "cancelado";
        bookingId?: string | null;
        bookingStatus?: string | null;
        classTypeLabel?: "Experimental" | "Recorrente" | null;
        badgeLabel?: string | null;
        badgeBg?: string | null;
        badgeText?: string | null;
        aluno?: { id: string; displayName: string; phone: string; status: string } | null;
      }>;
    }>;
  } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMovedRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const LONG_PRESS_MS = 450;

  // =============== BADGES MÊS INTEIRO (LB / NC / Pn) ===============
  const [badgeMap, setBadgeMap] = useState<Record<string, { LB: boolean; NC: boolean; PN: boolean }>>({});
  const [badgeLoading, setBadgeLoading] = useState(false);
  const fetchBadges = useCallback(async (daysArr: Date[]) => {
    if (!daysArr || daysArr.length === 0) return;
    const first = daysArr[0];
    const last = daysArr[daysArr.length - 1];
    const fromIso = format(first, "yyyy-MM-dd");
    const toIso = format(last, "yyyy-MM-dd");
    setBadgeLoading(true);
    try {
      const resp = await fetch(
        `/api/atendimento/programacao-diaria/badges?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
        { cache: "no-store" },
      );
      const payload = (await resp.json().catch(() => null)) as any;
      if (payload && payload.ok && payload.badgeMap && typeof payload.badgeMap === "object") {
        setBadgeMap(payload.badgeMap as Record<string, { LB: boolean; NC: boolean; PN: boolean }>);
      }
    } catch {
      // silently ignore (badge é opcional visual)
    } finally {
      setBadgeLoading(false);
    }
  }, []);
  // Recarrega badges sempre que a grade de dias mudar (mudança de mês / viewDate)
  useEffect(() => {
    if (!open) return; // só busca quando popover está aberto (economiza request)
    void fetchBadges(days);
  }, [days, open, fetchBadges]);

  const fetchScheduleFor = useCallback(async (isoDate: string) => {
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const resp = await fetch(`/api/atendimento/programacao-diaria?date=${encodeURIComponent(isoDate)}`);
      const payload = (await resp.json().catch(() => null)) as any;
      if (!payload || payload.ok !== true) {
        throw new Error(String(payload?.error ?? "Erro ao buscar programação"));
      }
      setScheduleData(payload);
    } catch (err: any) {
      setScheduleError(String(err?.message ?? err ?? "Erro"));
      setScheduleData(null);
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  const openScheduleModal = useCallback(
    (d: Date) => {
      const iso = format(d, "yyyy-MM-dd");
      setScheduleDate(iso);
      setScheduleModalOpen(true);
      void fetchScheduleFor(iso);
    },
    [fetchScheduleFor],
  );

  const closeScheduleModal = useCallback(() => {
    setScheduleModalOpen(false);
    setScheduleDate(null);
    setScheduleError(null);
    setScheduleData(null);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const longPressStart = useCallback(
    (d: Date) => (e: React.TouchEvent | React.MouseEvent) => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressMovedRef.current = false;
      longPressTriggeredRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        // Dispara o modal
        openScheduleModal(d);
        // Haptic feedback se existir
        if (typeof navigator !== "undefined" && (navigator as any)?.vibrate) {
          try { (navigator as any).vibrate(15); } catch {}
        }
      }, LONG_PRESS_MS);
      void e;
    },
    [openScheduleModal],
  );

  const longPressCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const longPressMove = useCallback(() => {
    longPressMovedRef.current = true;
    longPressCancel();
  }, [longPressCancel]);


  // 1) Posiciona popover NO CENTRO EXATO da viewport. Fixo, move nunca.
  // NÃO usa mais recalc em scroll/resize (isso causava a PISCADA FORTE bug!)
  useEffect(() => {
    if (!open) return;
    // Define coords FIXAS no CENTRO:
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const w = vw < 640 ? Math.min(320, vw - 16) : 360;
    setCoords({
      top: 0, // ignorado por style inline (usa 50vh + translate)
      left: 0,
      width: w,
      wMax: w,
    });
    // cleanup (nada) — events de scroll/resized REMOVIDOS para PARAR DE PISCAR
  }, [open]);

  // 2) Fechar popover ao clicar FORA ou ESC
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      // Tambem verifica se clicou DENTRO do portal do calendar
      const popover = document.getElementById("app-date-range-popover-inner");
      if (popover && popover.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Estados para range selecao (desativados — não há mais seleção De/Até)
  // const [pickingFirst, setPickingFirst] = useState<boolean>(!value.from);
  // const [hoverDay, setHoverDay] = useState<Date | null>(null);
  // fromDate/toDate/days já declarados ACIMA (antes useEffect badges)
  void 0;

  function handleDayClick(day: Date) {
    // Agenda NÃO MAIS faz seleção de período (De/Até).
    // Clique no dia (desktop) = abre o modal de programação do dia.
    void clearAll();
    openScheduleModal(day);
  }

  function isInRangePreview(d: Date): boolean {
    void d;
    return false;
  }
  function isStart(d: Date): boolean {
    void d;
    return false;
  }
  function isEnd(d: Date): boolean {
    void d;
    return false;
  }

  const summaryText = useMemo(() => {
    void value;
    return placeholder;
  }, [placeholder]);

  function clearAll() {
    onChange({ from: null, to: null });
    void 0;
  }

  const pickerJSX = (
    <div
      id="app-date-range-popover-inner"
      style={{
        top: "50vh",
        left: "50vw",
        width: coords.width,
        maxWidth: coords.wMax,
        transform: "translate(-50%, -50%)",
        // Reset vars CSS para tema LIGHT padrão do sistema (não herdar laranja do trigger iconActive)
        ["--app-solid-surface" as any]: "#ffffff",
        ["--app-solid-surface-2" as any]: "#f5f3f0",
        ["--app-solid-surface-3" as any]: "#e7e3dd",
        ["--app-border" as any]: "rgba(24, 24, 27, 0.085)",
        ["--app-border-strong" as any]: "rgba(24, 24, 27, 0.16)",
        ["--app-text-95" as any]: "#18181b",
        ["--app-text-90" as any]: "rgba(24, 24, 27, 0.92)",
        ["--app-text-85" as any]: "rgba(24, 24, 27, 0.92)",
        ["--app-text-80" as any]: "rgba(24, 24, 27, 0.82)",
        ["--app-text-75" as any]: "rgba(24, 24, 27, 0.78)",
        ["--app-text-70" as any]: "rgba(24, 24, 27, 0.72)",
        ["--app-text-65" as any]: "rgba(24, 24, 27, 0.66)",
        ["--app-text-60" as any]: "rgba(24, 24, 27, 0.60)",
        ["--app-text-55" as any]: "rgba(24, 24, 27, 0.56)",
        ["--app-text-50" as any]: "rgba(24, 24, 27, 0.50)",
        ["--app-text-45" as any]: "rgba(24, 24, 27, 0.45)",
        ["--app-text-35" as any]: "rgba(24, 24, 27, 0.35)",
        ["--app-hover" as any]: "rgba(24, 24, 27, 0.045)",
      }}
      className={[
        "fixed z-[9999]",
        "rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4",
        "shadow-[0_14px_44px_-8px_rgba(0,0,0,0.22)]",
      ].join(" ")}
      role="dialog"
      aria-label="Selecionar período"
    >
        {/* Header: mês/ano + setas + X fechar */}
        <div className="flex items-center justify-between gap-2 pb-3">
          <button
            type="button"
            onClick={() => setViewDate((v) => addMonths(v, -1))}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)]"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 text-center text-[14px] font-bold text-[var(--app-text-85)] tracking-tight">
            {format(viewDate, "MMMM 'de' yyyy", { locale: ptBR })}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setViewDate((v) => addMonths(v, 1))}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)]"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {/* X (close) → fecha popover E LIMPA filtro de data, voltando a mostrar todos (exatamente o que o usuário pediu) */}
            <button
              type="button"
              onClick={() => {
                clearAll();
                setOpen(false);
              }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]"
              aria-label="Fechar e limpar filtro"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Header dias semana */}
        <div className="mb-1 grid grid-cols-7 gap-1 px-1">
          {WEEKDAYS_SHORT.map((w) => (
            <div
              key={w}
              className="py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-55)]"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Grid de dias */}
        <div className="grid grid-cols-7 gap-1 px-1">
          {days.map((d, idx) => {
            const outMonth = !isSameMonth(d, viewDate);
            const today = isToday(d);
            const iso = format(d, "yyyy-MM-dd");
            const badges = (badgeMap as any)?.[iso] as { LB?: boolean; NC?: boolean; PN?: boolean } | undefined;
            const hasLB = Boolean(badges?.LB);
            const hasNC = Boolean(badges?.NC);
            const hasPN = Boolean(badges?.PN);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleDayClick(d)}
                onTouchStart={longPressStart(d)}
                onTouchEnd={longPressCancel}
                onTouchMove={longPressMove}
                onTouchCancel={longPressCancel}
                onContextMenu={(e) => {
                  e.preventDefault();
                }}
                className={[
                  "relative inline-flex w-full flex-col items-center justify-start gap-1 rounded-xl py-1.5 text-[12.5px] font-medium transition-colors select-none",
                  "focus:outline-none",
                  "touch-manipulation min-h-[72px]",
                  outMonth ? "text-[var(--app-text-35)]" : "text-[var(--app-text-80)]",
                  "hover:bg-[var(--app-solid-surface-2)] active:bg-[rgba(234,88,12,0.08)]",
                  today
                    ? "ring-1 ring-inset ring-[rgba(234,88,12,0.45)] font-bold text-[#9a3412]"
                    : "",
                ].join(" ")}
                style={{ WebkitTapHighlightColor: "rgba(234,88,12,0.18)" }}
              >
                <span className="relative z-10 leading-none">{d.getDate()}</span>
                {(hasLB || hasNC || hasPN) && (
                  <div className="flex items-center gap-1 flex-wrap justify-center z-10">
                    {hasLB && (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(234,88,12,0.20)] bg-[rgba(234,88,12,0.08)] text-[12px] font-bold uppercase text-[#c2410c]">
                        LB
                      </div>
                    )}
                    {hasNC && (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(234,88,12,0.20)] bg-[rgba(234,88,12,0.08)] text-[12px] font-bold uppercase text-[#c2410c]">
                        NC
                      </div>
                    )}
                    {hasPN && (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(234,88,12,0.20)] bg-[rgba(234,88,12,0.08)] text-[12px] font-bold uppercase text-[#c2410c]">
                        Pn
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

      </div>
  );

  return (
    <div ref={rootRef} className={twMerge("relative w-full", className)} id={id}>

      {/* SWITCH VISUAL DO TRIGGER (botão que abre calendario):
        - size="full" → botão largo default w-full com texto + chevron (usado em modal filtros etc)
        - size="icon" → botão redondo pequeno h-10 w-10 igual os outros botões do header (Refresh, +Adicionar etc)
      */}
      {size === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={placeholder}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={[
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            "border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)]",
            "hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 shadow-none",
            iconActive === true || (iconActive === "auto" && Boolean(value.from || value.to))
              ? "!border-[rgba(234,88,12,0.4)] !bg-[rgba(234,88,12,0.08)] !text-[#c2410c]"
              : "",
          ].join(" ")}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[
            "flex w-full items-center justify-between gap-2",
            "rounded-xl border border-[var(--app-border)] bg-white px-3.5 py-2.5 text-[13px] font-medium text-[var(--app-text-85)]",
            "focus:outline-none focus:border-[rgba(234,88,12,0.35)]",
            "hover:bg-[var(--app-solid-surface-2)]",
            "transition-colors shadow-none",
          ].join(" ")}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-2.5 text-left">
            <CalendarDays className="h-4 w-4 shrink-0 text-[var(--app-text-60)]" />
            <span className={twMerge("truncate", (!value.from && !value.to) ? "text-[var(--app-text-45)]" : "")}>
              {summaryText}
            </span>
          </span>
          <ChevronRight
            className={twMerge(
              "h-4 w-4 shrink-0 text-[var(--app-text-55)] transition-transform duration-150",
              open ? "rotate-90" : "",
            )}
          />
        </button>
      )}

      {/* POPOVER CALENDARIO: Portal fixed z-9999 (nunca mais overflow corta!) */}
      {open && rendered && typeof document !== "undefined" && document.body
        ? createPortal(pickerJSX, document.body)
        : null}

      {/* MODAL PROGRAMAÇÃO DO DIA: (abre em click desktop / long-press mobile) */}
      {scheduleModalOpen &&
      scheduleDate &&
      rendered &&
      typeof document !== "undefined" &&
      document.body
        ? createPortal(
            (() => {
              const dateObj = parseISO(scheduleDate);
              const hasData = scheduleData && scheduleData.ok;
              const sum = hasData ? scheduleData.summary : null;
              const teacherList = hasData ? (scheduleData.teachers ?? []) : [];
              return (
                <div
                  className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Programação do dia"
                >
                  {/* Backdrop */}
                  <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
                    onClick={closeScheduleModal}
                  />

                  {/* Container do modal */}
                  <div
                    className={[
                      "relative w-full sm:max-w-[560px] max-h-[92vh] overflow-hidden",
                      "rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)]",
                      "shadow-[0_25px_60px_-12px_rgba(0,0,0,0.30)]",
                      "flex flex-col animate-in zoom-in-95 duration-150",
                    ].join(" ")}
                    style={{
                      // Reset vars CSS para tema LIGHT padrão do sistema (não herdar laranja do trigger iconActive)
                      ["--app-solid-surface" as any]: "#ffffff",
                      ["--app-solid-surface-2" as any]: "#f5f3f0",
                      ["--app-solid-surface-3" as any]: "#e7e3dd",
                      ["--app-border" as any]: "rgba(24, 24, 27, 0.085)",
                      ["--app-border-strong" as any]: "rgba(24, 24, 27, 0.16)",
                      ["--app-text-95" as any]: "#18181b",
                      ["--app-text-90" as any]: "rgba(24, 24, 27, 0.92)",
                      ["--app-text-85" as any]: "rgba(24, 24, 27, 0.92)",
                      ["--app-text-80" as any]: "rgba(24, 24, 27, 0.82)",
                      ["--app-text-75" as any]: "rgba(24, 24, 27, 0.78)",
                      ["--app-text-70" as any]: "rgba(24, 24, 27, 0.72)",
                      ["--app-text-65" as any]: "rgba(24, 24, 27, 0.66)",
                      ["--app-text-60" as any]: "rgba(24, 24, 27, 0.60)",
                      ["--app-text-55" as any]: "rgba(24, 24, 27, 0.56)",
                      ["--app-text-50" as any]: "rgba(24, 24, 27, 0.50)",
                      ["--app-text-45" as any]: "rgba(24, 24, 27, 0.45)",
                      ["--app-text-35" as any]: "rgba(24, 24, 27, 0.35)",
                      ["--app-hover" as any]: "rgba(24, 24, 27, 0.045)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header (sticky, nunca some com scroll) */}
                    <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3 sm:px-5 sm:py-3.5">
                      {/* Botão VOLTAR = fecha o modal de programação E ABRE de volta o POPOVER CALENDÁRIO
                          (grade de dias com "setembro de 2026" no topo, exatamente o print do usuário). */}
                      <button
                        type="button"
                        aria-label="Voltar ao calendário"
                        onClick={(e) => {
                          e.stopPropagation();
                          // 1) Fecha o modal "Programação do Dia" (este)
                          closeScheduleModal();
                          // 2) ABRE de volta o popover do calendário (grade de dias)
                          //    usando o useState interno setOpen(true) do AppDateRangePicker.
                          //    É exatamente a interface do print: setembro/2026, setas < >, X.
                          try {
                            setOpen(true);
                          } catch {}
                          // 3) Garante foco visual no botão trigger do calendário (icon laranja CalendarDays)
                          //    para ter feedback visual claro que voltamos para a tela certa.
                          try {
                            const triggers = document.querySelectorAll<HTMLButtonElement>(
                              'button[aria-haspopup="dialog"][aria-label],button[data-app-calendar-trigger="true"]',
                            );
                            if (triggers?.length) {
                              const t = triggers[triggers.length - 1] as HTMLButtonElement;
                              t.focus({ preventScroll: true });
                            }
                          } catch {}
                        }}
                        className={[
                          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                          "bg-transparent text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)]",
                          "transition-colors",
                        ].join(" ")}
                      >
                        <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.25} />
                      </button>

                      <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center min-w-0">
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--app-text-55)]">
                          Programação do Dia
                        </div>
                        <div className="mt-1 truncate text-[15px] font-semibold text-[var(--app-text-95)] leading-tight max-w-[64vw]">
                          {isValid(dateObj)
                            ? format(dateObj, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                            : scheduleDate}
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label="Fechar programação do dia"
                        onClick={closeScheduleModal}
                        className={[
                          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                          "bg-transparent text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)]",
                          "transition-colors",
                        ].join(" ")}
                      >
                        <X className="h-[18px] w-[18px]" />
                      </button>
                    </div>

                    {/* Loading state */}
                    {scheduleLoading ? (
                      <div className="flex flex-col items-center justify-center gap-2 px-6 py-14">
                        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--app-border)] border-t-[#ea580c]" />
                        <div className="mt-2 text-[13px] font-medium text-[var(--app-text-65)]">
                          Carregando programação do dia…
                        </div>
                      </div>
                    ) : scheduleError ? (
                      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12">
                        <Ban className="h-8 w-8 text-rose-500" />
                        <div className="text-[13.5px] font-semibold text-[var(--app-text-90)]">
                          Não foi possível carregar a programação
                        </div>
                        <div className="text-[12px] text-[var(--app-text-55)]">
                          {String(scheduleError ?? "")}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (scheduleDate) void fetchScheduleFor(scheduleDate);
                          }}
                          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#ea580c] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#c2410c]"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5 sm:px-5 sm:py-4">
                        {/* Cards por professor */}
                        {teacherList.length === 0 ? (
                          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-5 py-10 text-center">
                            <CalendarDays className="h-8 w-8 text-[var(--app-text-45)]" />
                            <div className="text-[13.5px] font-semibold text-[var(--app-text-85)]">
                              Nenhuma aula programada
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2.5">
                            {teacherList.map((teacher, tIdx) => {
                              const ocupadosList = teacher.slots.filter(
                                (s) => s.status === "ocupado" || s.status === "cancelado",
                              );
                              const ocupados = teacher.slots.filter(
                                (s) => s.status === "ocupado",
                              ).length;
                              const livres = teacher.slots.filter(
                                (s) => s.status === "disponivel",
                              ).length;
                              const cancel = teacher.slots.filter(
                                (s) => s.status === "cancelado",
                              ).length;
                              const temAlgo = ocupadosList.length > 0;
                              // Botão "Ver" SÓ aparece se houver pelo menos 1 aula OCUPADA (com aluno) marcada
                              // para este professor neste dia. Se não há nada (tudo livre / "Sem aulas...") → não mostrar.
                              const showVerButton = ocupados > 0;
                              return (
                                <div
                                  key={tIdx}
                                  className={[
                                    "overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)]",
                                    "shadow-[0_1px_3px_rgba(15,23,42,0.04)]",
                                  ].join(" ")}
                                >
                                  {/* Card header professor */}
                                  <div className="flex items-center justify-between gap-3 px-3.5 py-3 sm:px-4">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <div
                                        className={[
                                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                          "border border-[rgba(234,88,12,0.20)] bg-[rgba(234,88,12,0.08)]",
                                          "text-[12px] font-bold uppercase text-[#c2410c]",
                                        ].join(" ")}
                                      >
                                        {teacher.name
                                          .split(" ")
                                          .map((x) => x[0])
                                          .filter(Boolean)
                                          .slice(0, 2)
                                          .join("")}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="truncate text-[13.5px] font-semibold text-[var(--app-text-95)] leading-tight">
                                          {teacher.name}
                                        </div>
                                        <div className="mt-0.5 truncate text-[11.5px] text-[var(--app-text-55)]">
                                          {String(teacher.phone ?? "").trim() === "__no_assigned_professor__"
                                            ? "Número indisponível"
                                            : teacher.phone}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Botão Ver = atalho para a lista de atendimento / registros.
                                        SÓ RENDERIZA se houver aulas ocupadas (com aluno) neste dia. */}
                                    {showVerButton && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          const params = new URLSearchParams();
                                          params.set("stage", "aula_experimental_agendada");
                                          if (teacher?.name) {
                                            params.set("bookingProfessor", String(teacher.name));
                                          }
                                          if (teacher?.phone) {
                                            params.set("bookingPhone", String(teacher.phone));
                                          }
                                          if (scheduleDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
                                            params.set("bookingFrom", scheduleDate);
                                            params.set("bookingTo", scheduleDate);
                                          }
                                          try {
                                            setScheduleModalOpen(false);
                                          } catch {}
                                          const dest = `/app/atendimento${params.toString() ? "?" + params.toString() : ""}`;
                                          window.location.assign(dest);
                                        }}
                                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[12px] bg-white px-3 text-[11.5px] font-bold uppercase tracking-[0.04em] text-[#0f172a] shadow-[inset_0_0_0_1px_var(--app-border)] transition-colors hover:bg-[var(--app-solid-surface-2)] active:bg-[var(--app-solid-surface-3)]"
                                      >
                                        Ver
                                        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.25} />
                                      </button>
                                    )}
                                  </div>

                                  {/* Apenas aulas marcadas / canceladas (horários livres NÃO listados — poluição) */}
                                  {temAlgo ? (
                                    <div className="flex flex-col gap-1.5 px-3.5 pb-3.5 sm:px-4 sm:pb-4">
                                      {ocupadosList.map((slot, sIdx) => {
                                        const ocupado = slot.status === "ocupado";
                                        return (
                                          <div
                                            key={sIdx}
                                            className={[
                                              "flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5",
                                              ocupado
                                                ? "border border-[var(--app-border)] bg-[var(--app-solid-surface-2)]"
                                                : "border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] opacity-80",
                                            ].join(" ")}
                                          >
                                            <div className="flex min-w-0 items-center gap-3">
                                              <div
                                                className={[
                                                  "flex h-9 w-[52px] shrink-0 items-center justify-center rounded-[12px] text-[12.5px] font-bold tabular-nums",
                                                  ocupado
                                                    ? "bg-[#ea580c] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
                                                    : "bg-[var(--app-solid-surface-3)] line-through",
                                                ].join(" ")}
                                                style={
                                                  ocupado
                                                    ? { color: "#ffffff", backgroundColor: "#ea580c", fontWeight: 700 }
                                                    : undefined
                                                }
                                              >
                                                {slot.professorTime}
                                              </div>
                                              <div className="min-w-0">
                                                {ocupado && slot.aluno ? (
                                                  <>
                                                    <div className="truncate text-[13px] font-semibold text-[var(--app-text-95)] leading-tight">
                                                      {slot.aluno.displayName}
                                                    </div>
                                                    {slot.aluno.phone ? (
                                                      <div className="mt-0.5 truncate text-[11px] text-[var(--app-text-55)] leading-tight">
                                                        {slot.aluno.phone}
                                                      </div>
                                                    ) : null}
                                                  </>
                                                ) : (
                                                  <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--app-text-55)]">
                                                    <Ban className="h-3.5 w-3.5" />
                                                    <span className="font-medium">
                                                      Cancelada
                                                    </span>
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                                              {ocupado && slot.classTypeLabel ? (
                                                <span className="shrink-0 px-2 py-[3px] text-[10px] uppercase tracking-[0.08em] text-[#0f172a]">
                                                  {String(slot.classTypeLabel ?? "")}
                                                </span>
                                              ) : null}
                                              {ocupado && slot.badgeLabel ? (
                                                <span
                                                  className={[
                                                    "shrink-0 rounded-[12px] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.06em]",
                                                    "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
                                                  ].join(" ")}
                                                  style={{
                                                    color: slot.badgeText || "#ffffff",
                                                    backgroundColor:
                                                      slot.badgeBg || "#0f172a",
                                                    fontWeight: 700,
                                                  }}
                                                >
                                                  {slot.badgeLabel}
                                                </span>
                                              ) : null}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
                                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 py-2.5 text-[11.5px] font-medium text-[var(--app-text-55)]">
                                        Sem aulas para {teacher.name.split(" ")[0]} neste dia
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })(),
            document.body,
          )
        : null}
    </div>
  );
}

export default AppDateRangePicker;
