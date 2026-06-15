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
