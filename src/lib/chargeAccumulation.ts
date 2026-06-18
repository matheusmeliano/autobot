import { localDateInTimeZone } from "@/lib/recurrence";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function parseLocalDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function monthIndex(localDate: string) {
  const parts = parseLocalDate(localDate);
  if (!parts) return null;
  return parts.year * 12 + (parts.month - 1);
}

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function resolveScheduleLocalDate(params: {
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
  timeZone: string;
}) {
  const raw = String(params.chargeDueAt ?? params.dataEnvio ?? "").trim();
  if (!raw) return null;
  try {
    return localDateInTimeZone(raw, params.timeZone);
  } catch {
    return null;
  }
}

export function getOpenMonthlyInstallments(params: {
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
  nowUtcIso: string;
  timeZone: string;
}) {
  const dueLocalDate = resolveScheduleLocalDate(params);
  if (!dueLocalDate) return 1;

  let currentLocalDate: string;
  try {
    currentLocalDate = localDateInTimeZone(params.nowUtcIso, params.timeZone);
  } catch {
    return 1;
  }

  const dueMonthIndex = monthIndex(dueLocalDate);
  const currentMonthIndex = monthIndex(currentLocalDate);
  if (dueMonthIndex === null || currentMonthIndex === null) return 1;

  return Math.max(1, currentMonthIndex - dueMonthIndex + 1);
}

export function getScheduleChargeAmount(params: {
  baseAmount: unknown;
  accumulateOpenMonthlyCharges?: boolean | null;
  recurrence?: string | null;
  status?: string | null;
  closedAt?: string | null;
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
  nowUtcIso: string;
  timeZone?: string | null;
}) {
  const baseAmount = toNumber(params.baseAmount);
  if (baseAmount === null) return null;

  const accumulate = Boolean(params.accumulateOpenMonthlyCharges);
  const recurrence = String(params.recurrence ?? "none").trim().toLowerCase();
  const status = String(params.status ?? "").trim().toLowerCase();
  const isClosed = Boolean(String(params.closedAt ?? "").trim());
  const timeZone = String(params.timeZone ?? "") || "America/Sao_Paulo";

  if (!accumulate || recurrence !== "monthly" || isClosed || status === "pago") {
    return baseAmount;
  }

  return (
    baseAmount *
    getOpenMonthlyInstallments({
      chargeDueAt: params.chargeDueAt,
      dataEnvio: params.dataEnvio,
      nowUtcIso: params.nowUtcIso,
      timeZone,
    })
  );
}

export function nextMonthlyIsoAfterSettlement(params: {
  accumulateOpenMonthlyCharges?: boolean | null;
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
  nowUtcIso: string;
  timeZone: string;
  day: number;
  time: string;
}) {
  const dueLocalDate = resolveScheduleLocalDate(params);
  if (!dueLocalDate) throw new Error("Data inválida");

  const accumulate = Boolean(params.accumulateOpenMonthlyCharges);
  const installments = getOpenMonthlyInstallments({
    chargeDueAt: params.chargeDueAt,
    dataEnvio: params.dataEnvio,
    nowUtcIso: params.nowUtcIso,
    timeZone: params.timeZone,
  });
  const baseMonthIndex = monthIndex(dueLocalDate);
  if (baseMonthIndex === null) throw new Error("Data inválida");

  const targetMonthIndex = baseMonthIndex + (accumulate ? installments : 1);
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const maxDay = lastDayOfMonth(targetYear, targetMonth);
  const safeDay = Math.max(1, Math.min(Number(params.day) || 1, maxDay));
  const date = `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;

  return zonedDateTimeToUtcIso({
    date,
    time: params.time,
    timeZone: params.timeZone,
  });
}
