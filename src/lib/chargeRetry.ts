import { localDateInTimeZone } from "@/lib/recurrence";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

export const DEFAULT_RETRY_WEEKDAYS = [1, 2, 3, 4, 5];
export const DEFAULT_RETRY_TIME = "09:00";
export const DEFAULT_RETRY_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_INTERVAL_DAYS = 1;
export const DEFAULT_RETRY_AUTO_CLOSE_DAYS = 30;

export type RetryConfig = {
  weekdays: number[];
  time: string;
  maxAttempts: number;
  intervalDays: number;
  autoCloseDays: number;
};

function validTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function addDaysToLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function diffDaysLocalDate(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd, 12, 0, 0);
  const to = Date.UTC(ty, tm - 1, td, 12, 0, 0);
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function weekdayFromLocalDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = base.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function localDateTimeParts(utcIso: string, timeZone: string) {
  const base = new Date(utcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(base);
  return parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
}

export function normalizeRetryWeekdays(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const unique = Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7),
    ),
  ).sort((a, b) => a - b);
  return unique.length ? unique : DEFAULT_RETRY_WEEKDAYS;
}

export function normalizeRetryConfig(input: any): RetryConfig {
  return {
    weekdays: normalizeRetryWeekdays(input?.retry_weekdays),
    time: validTime(String(input?.retry_time ?? "")) ? String(input.retry_time) : DEFAULT_RETRY_TIME,
    maxAttempts: Math.max(1, Number(input?.retry_max_attempts ?? DEFAULT_RETRY_MAX_ATTEMPTS) || DEFAULT_RETRY_MAX_ATTEMPTS),
    intervalDays: Math.max(1, Number(input?.retry_interval_days ?? DEFAULT_RETRY_INTERVAL_DAYS) || DEFAULT_RETRY_INTERVAL_DAYS),
    autoCloseDays: Math.max(
      1,
      Number(input?.retry_auto_close_days ?? DEFAULT_RETRY_AUTO_CLOSE_DAYS) || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    ),
  };
}

export function isPastLocalDay(params: {
  referenceUtcIso: string;
  nowUtcIso: string;
  timeZone: string;
}) {
  return localDateInTimeZone(params.nowUtcIso, params.timeZone) > localDateInTimeZone(params.referenceUtcIso, params.timeZone);
}

export function hasAutoCloseExpired(params: {
  firstSentAt?: string | null;
  nowUtcIso: string;
  timeZone: string;
  autoCloseDays: number;
}) {
  if (!params.firstSentAt) return false;
  const firstLocal = localDateInTimeZone(params.firstSentAt, params.timeZone);
  const nowLocal = localDateInTimeZone(params.nowUtcIso, params.timeZone);
  return diffDaysLocalDate(firstLocal, nowLocal) >= Math.max(1, params.autoCloseDays);
}

export function nextRetryUtcIso(params: {
  fromUtcIso: string;
  timeZone: string;
  weekdays: number[];
  time: string;
  intervalDays: number;
}) {
  const weekdays = normalizeRetryWeekdays(params.weekdays);
  let localDate = addDaysToLocalDate(
    localDateInTimeZone(params.fromUtcIso, params.timeZone),
    Math.max(1, params.intervalDays),
  );

  for (let i = 0; i < 21; i++) {
    if (weekdays.includes(weekdayFromLocalDate(localDate))) {
      return zonedDateTimeToUtcIso({
        date: localDate,
        time: validTime(params.time) ? params.time : DEFAULT_RETRY_TIME,
        timeZone: params.timeZone,
      });
    }
    localDate = addDaysToLocalDate(localDate, 1);
  }

  return zonedDateTimeToUtcIso({
    date: localDate,
    time: validTime(params.time) ? params.time : DEFAULT_RETRY_TIME,
    timeZone: params.timeZone,
  });
}

export function shiftFirstChargeFromWeekendUtcIso(params: {
  utcIso: string;
  timeZone: string;
  enabled: boolean;
}) {
  if (!params.enabled) return params.utcIso;
  const localParts = localDateTimeParts(params.utcIso, params.timeZone);
  const originalLocalDate = `${localParts.year}-${localParts.month}-${localParts.day}`;
  const localTime = `${localParts.hour ?? "00"}:${localParts.minute ?? "00"}`;
  let nextLocalDate = originalLocalDate;

  while (true) {
    const weekday = weekdayFromLocalDate(nextLocalDate);
    if (weekday >= 1 && weekday <= 5) break;
    nextLocalDate = addDaysToLocalDate(nextLocalDate, 1);
  }

  if (nextLocalDate === originalLocalDate) return params.utcIso;

  return zonedDateTimeToUtcIso({
    date: nextLocalDate,
    time: validTime(localTime) ? localTime : DEFAULT_RETRY_TIME,
    timeZone: params.timeZone,
  });
}

export function getResumeStatusAfterSuspicion(params: {
  status?: string | null;
  firstSentAt?: string | null;
  lastSentAt?: string | null;
  nowUtcIso: string;
  timeZone: string;
}) {
  const current = String(params.status ?? "").toLowerCase();
  if (current === "agendado") return "agendado";
  const ref = params.lastSentAt || params.firstSentAt;
  if (!ref) return "agendado";
  return isPastLocalDay({ referenceUtcIso: ref, nowUtcIso: params.nowUtcIso, timeZone: params.timeZone })
    ? "atrasado"
    : "pendente";
}
