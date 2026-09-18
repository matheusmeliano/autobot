import { zonedDateTimeToUtcIso } from "@/lib/timezone";

export const MAX_MONTHLY_SCHEDULES_PER_DEBTOR = 27;
export const MAX_YEARLY_RECURRENCE_OCCURRENCES = 300;

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

function parseLocalDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Data inválida");
  return { year, month, day };
}

function formatLocalDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addMonthsToLocalDate(localDate: string, monthsToAdd: number) {
  const { year, month, day } = parseLocalDate(localDate);
  const monthIndex = year * 12 + (month - 1) + monthsToAdd;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = (monthIndex % 12) + 1;
  const safeDay = Math.max(1, Math.min(day, lastDayOfMonth(nextYear, nextMonth)));
  return formatLocalDate(nextYear, nextMonth, safeDay);
}

function addYearsToLocalDate(localDate: string, yearsToAdd: number) {
  const { year, month, day } = parseLocalDate(localDate);
  const nextYear = year + yearsToAdd;
  const safeDay = Math.max(1, Math.min(day, lastDayOfMonth(nextYear, month)));
  return formatLocalDate(nextYear, month, safeDay);
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

export function shouldContinueRecurringRecurrence(params: {
  nextUtcIso: string;
  recurrenceUntil?: string | null;
  timeZone: string;
}) {
  return shouldContinueMonthlyRecurrence(params);
}

export function nextMonthlyIso(params: {
  fromUtcIso: string;
  timeZone: string;
  day: number;
  time: string;
}) {
  const base = new Date(params.fromUtcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: params.timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const p = partsToMap(fmt.formatToParts(base));
  const y = Number(p.year);
  const m = Number(p.month);
  if (!y || !m) throw new Error("Data inválida");

  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const maxDay = lastDayOfMonth(nextY, nextM);
  const day = Math.max(1, Math.min(Number(params.day) || 1, maxDay));
  const date = `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return zonedDateTimeToUtcIso({
    date,
    time: params.time,
    timeZone: params.timeZone,
  });
}

export function nextYearlyIso(params: {
  fromUtcIso: string;
  timeZone: string;
  day: number;
  time: string;
}) {
  const base = new Date(params.fromUtcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: params.timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const p = partsToMap(fmt.formatToParts(base));
  const y = Number(p.year);
  const m = Number(p.month);
  if (!y || !m) throw new Error("Data inválida");

  const nextY = y + 1;
  const maxDay = lastDayOfMonth(nextY, m);
  const day = Math.max(1, Math.min(Number(params.day) || 1, maxDay));
  const date = `${String(nextY).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return zonedDateTimeToUtcIso({
    date,
    time: params.time,
    timeZone: params.timeZone,
  });
}

export function monthlyRecurrenceLimitMinDate(params: {
  currentUtcIso: string;
  timeZone: string;
}) {
  const base = new Date(params.currentUtcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: params.timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const p = partsToMap(fmt.formatToParts(base));
  const y = Number(p.year);
  const m = Number(p.month);
  if (!y || !m) throw new Error("Data inválida");

  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`;
}

export function recurrenceLimitMaxDateFromLocalDate(params: {
  recurrence: "none" | "monthly" | "yearly";
  currentDate: string;
}) {
  if (!params.currentDate) return null;
  if (params.recurrence === "yearly") {
    return addYearsToLocalDate(params.currentDate, MAX_YEARLY_RECURRENCE_OCCURRENCES - 1);
  }
  return null;
}

export function recurrenceLimitMaxDate(params: {
  recurrence: "none" | "monthly" | "yearly";
  currentUtcIso: string;
  timeZone: string;
}) {
  if (params.recurrence === "none") return null;
  const currentDate = localDateInTimeZone(params.currentUtcIso, params.timeZone);
  return recurrenceLimitMaxDateFromLocalDate({
    recurrence: params.recurrence,
    currentDate,
  });
}
