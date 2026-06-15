import { zonedDateTimeToUtcIso } from "@/lib/timezone";

function partsToMap(parts: Intl.DateTimeFormatPart[]) {
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type === "literal") continue;
    m[p.type] = p.value;
  }
  return m;
}

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function shiftYearMonth(year: number, month: number, offset: number) {
  const totalMonths = year * 12 + (month - 1) + offset;
  return {
    year: Math.floor(totalMonths / 12),
    month: (totalMonths % 12) + 1,
  };
}

function localYearMonthInTimeZone(utcIso: string, timeZone: string) {
  const base = new Date(utcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const p = partsToMap(fmt.formatToParts(base));
  const year = Number(p.year);
  const month = Number(p.month);
  if (!year || !month) throw new Error("Data inválida");
  return { year, month };
}

function monthlyOccurrenceIsoForLocalMonth(params: {
  year: number;
  month: number;
  timeZone: string;
  day: number;
  time: string;
}) {
  const maxDay = lastDayOfMonth(params.year, params.month);
  const day = Math.max(1, Math.min(Number(params.day) || 1, maxDay));
  const date = `${String(params.year).padStart(4, "0")}-${String(params.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return zonedDateTimeToUtcIso({
    date,
    time: params.time,
    timeZone: params.timeZone,
  });
}

function subtractOneDayFromLocalDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Data inválida");
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

export function localDateInTimeZone(utcIso: string, timeZone: string) {
  const base = new Date(utcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(base);
}

export function shouldContinueMonthlyRecurrence(params: {
  nextUtcIso: string;
  recurrenceUntil?: string | null;
  timeZone: string;
}) {
  if (!params.recurrenceUntil) return true;
  const nextLocalDate = localDateInTimeZone(params.nextUtcIso, params.timeZone);
  return nextLocalDate <= params.recurrenceUntil;
}

export function nextMonthlyIso(params: {
  fromUtcIso: string;
  timeZone: string;
  day: number;
  time: string;
}) {
  const { year, month } = localYearMonthInTimeZone(params.fromUtcIso, params.timeZone);
  const next = shiftYearMonth(year, month, 1);
  return monthlyOccurrenceIsoForLocalMonth({
    year: next.year,
    month: next.month,
    timeZone: params.timeZone,
    day: params.day,
    time: params.time,
  });
}

export function nextScheduledOccurrenceIso(params: {
  afterUtcIso: string;
  timeZone: string;
  day: number;
  time: string;
}) {
  const base = new Date(params.afterUtcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");

  const currentMonth = localYearMonthInTimeZone(params.afterUtcIso, params.timeZone);
  const candidateThisMonth = monthlyOccurrenceIsoForLocalMonth({
    year: currentMonth.year,
    month: currentMonth.month,
    timeZone: params.timeZone,
    day: params.day,
    time: params.time,
  });
  if (new Date(candidateThisMonth).getTime() > base.getTime()) {
    return candidateThisMonth;
  }

  const nextMonth = shiftYearMonth(currentMonth.year, currentMonth.month, 1);
  return monthlyOccurrenceIsoForLocalMonth({
    year: nextMonth.year,
    month: nextMonth.month,
    timeZone: params.timeZone,
    day: params.day,
    time: params.time,
  });
}

export function monthlyRecurrenceLimitMaxDate(params: {
  currentUtcIso: string;
  timeZone: string;
  schedules: Array<{ day: number; time: string }>;
}) {
  if (params.schedules.length === 0) return null;

  let earliestNextIso: string | null = null;
  for (const schedule of params.schedules) {
    const nextIso = nextScheduledOccurrenceIso({
      afterUtcIso: params.currentUtcIso,
      timeZone: params.timeZone,
      day: schedule.day,
      time: schedule.time,
    });
    if (!earliestNextIso || new Date(nextIso).getTime() < new Date(earliestNextIso).getTime()) {
      earliestNextIso = nextIso;
    }
  }

  if (!earliestNextIso) return null;
  return subtractOneDayFromLocalDate(localDateInTimeZone(earliestNextIso, params.timeZone));
}
