"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, CalendarDays, X } from "lucide-react";
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
  placeholder = "Selecione o período",
  className,
  labelDe = "De",
  labelAte = "Até",
  showLabel = true,
  clearable = true,
  id,
}: AppDateRangePickerProps) {
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
    const fromDate = parseToDate(value.from);
    if (fromDate) return fromDate;
    return new Date();
  });

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

  // Estados para range selecao (hover preview between clicks)
  const [pickingFirst, setPickingFirst] = useState<boolean>(!value.from);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);

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

  function handleDayClick(day: Date) {
    if (pickingFirst || !fromDate) {
      onChange({ from: toISODate(day), to: null });
      setPickingFirst(false);
      return;
    }
    // Segundo clique: se vier ANTES do from, inverte
    if (isBefore(day, fromDate)) {
      onChange({ from: toISODate(day), to: toISODate(fromDate) });
      setPickingFirst(true);
      return;
    }
    onChange({ from: toISODate(fromDate), to: toISODate(day) });
    setPickingFirst(true);
  }

  function isInRangePreview(d: Date): boolean {
    if (!fromDate) return false;
    const end = toDate ?? hoverDay;
    if (!end) return false;
    const [a, b] = isBefore(fromDate, end) ? [fromDate, end] : [end, fromDate];
    return (isAfter(d, a) || isSameDay(d, a)) && (isBefore(d, b) || isSameDay(d, b));
  }
  function isStart(d: Date): boolean {
    if (!fromDate) return false;
    const realEnd = toDate ?? hoverDay;
    if (!realEnd) return isSameDay(d, fromDate);
    const [a] = isBefore(fromDate, realEnd) ? [fromDate, realEnd] : [realEnd, fromDate];
    return isSameDay(d, a);
  }
  function isEnd(d: Date): boolean {
    const end = toDate ?? hoverDay;
    if (!fromDate || !end) return false;
    const [, b] = isBefore(fromDate, end) ? [fromDate, end] : [end, fromDate];
    return isSameDay(d, b);
  }

  const summaryText = useMemo(() => {
    if (!value.from && !value.to) return placeholder;
    if (value.from && !value.to) {
      const d = parseToDate(value.from);
      return d ? `${labelDe}: ${format(d, "dd/MM/yyyy")}` : placeholder;
    }
    const d1 = parseToDate(value.from);
    const d2 = parseToDate(value.to);
    if (d1 && d2) return `${format(d1, "dd/MM")} — ${format(d2, "dd/MM/yyyy")}`;
    return placeholder;
  }, [value.from, value.to, placeholder, labelDe]);

  function clearAll() {
    onChange({ from: null, to: null });
    setPickingFirst(true);
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]"
              aria-label="Fechar"
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
            const inRange = isInRangePreview(d);
            const start = isStart(d);
            const end = isEnd(d);
            const picked = start || end;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleDayClick(d)}
                onMouseEnter={() => setHoverDay(d)}
                onMouseLeave={() => setHoverDay(null)}
                className={[
                  "relative inline-flex h-9 w-full items-center justify-center rounded-xl text-[12.5px] font-medium transition-colors select-none",
                  "focus:outline-none",
                  outMonth ? "text-[var(--app-text-35)]" : "text-[var(--app-text-80)]",
                  inRange && !picked ? "bg-[rgba(234,88,12,0.08)] text-[#9a3412] rounded-none" : "",
                  start ? "rounded-l-xl rounded-r-none" : "",
                  end ? "rounded-r-xl rounded-l-none" : "",
                  picked
                    ? [
                        "bg-[#ea580c] !text-white",
                        "hover:bg-[#c2410c]",
                        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]",
                      ].join(" ")
                    : !inRange
                      ? "hover:bg-[var(--app-solid-surface-2)]"
                      : "",
                  today && !picked
                    ? "ring-1 ring-inset ring-[rgba(234,88,12,0.45)] font-bold text-[#9a3412]"
                    : "",
                ].join(" ")}
              >
                <span className="relative z-10">{d.getDate()}</span>
              </button>
            );
          })}
        </div>

        {/* Barra inferior: Hoje + Selecionar + Limpar */}
        <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-[var(--app-border)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-55)]">
            {pickingFirst
              ? fromDate && !toDate
                ? "Selecione até"
                : "Selecione de"
              : "Selecione até"}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const hj = new Date();
                const hjStr = toISODate(hj);
                setViewDate(hj);
                onChange({ from: hjStr, to: hjStr });
                setPickingFirst(true);
              }}
              className="inline-flex h-8 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 text-[12px] font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 items-center justify-center rounded-xl px-4 text-[12px] font-bold !text-white shadow-none bg-[#ea580c] hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      </div>
  );

  return (
    <div ref={rootRef} className={twMerge("relative w-full", className)} id={id}>
      {/* Trigger Button (input fake, clica abre calendar) */}
      {showLabel && (
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--app-text-60)]">
            Período ({labelDe} / {labelAte})
          </div>
          {clearable && (value.from || value.to) ? (
            <button
              type="button"
              onClick={clearAll}
              className="flex h-6 items-center gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-2 text-[11px] font-medium text-[var(--app-text-60)] hover:bg-[var(--app-hover)]"
            >
              <X className="h-3 w-3" />
              Limpar
            </button>
          ) : null}
        </div>
      )}

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

      {/* POPOVER CALENDARIO: Portal fixed z-9999 (nunca mais overflow corta!) */}
      {open && rendered && typeof document !== "undefined" && document.body
        ? createPortal(pickerJSX, document.body)
        : null}
    </div>
  );
}

export default AppDateRangePicker;
