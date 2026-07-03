import { localDateInTimeZone } from "@/lib/recurrence";

export type DebtorChargeStatus = "agendado" | "atrasado" | "pago";

type DebtorScheduleStatusRow = {
  debtor_id?: string | null;
  charge_id?: string | null;
  status?: string | null;
  recurrence?: string | null;
  data_envio?: string | null;
  charge_due_at?: string | null;
  first_sent_at?: string | null;
  last_sent_at?: string | null;
  payment_received_at?: string | null;
  schedule_timezone?: string | null;
  closed_at?: string | null;
};

type DebtorChargeRow = {
  id?: string | null;
  due_day?: number | null;
  recurrence_month?: number | null;
  recurrence_year?: number | null;
  created_at?: string | null;
};

function scheduleLocalDate(value: string | null | undefined, timeZone: string) {
  const iso = String(value ?? "").trim();
  if (!iso) return null;
  try {
    return localDateInTimeZone(iso, timeZone);
  } catch {
    return null;
  }
}

function diffDaysLocalDate(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd, 12, 0, 0);
  const to = Date.UTC(ty, tm - 1, td, 12, 0, 0);
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function compareChargeOrder(a: DebtorChargeRow, b: DebtorChargeRow) {
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

function buildChargeLocalDate(charge: DebtorChargeRow) {
  const year = Number(charge.recurrence_year ?? 0);
  const month = Number(charge.recurrence_month ?? 0);
  const day = Number(charge.due_day ?? 0);
  if (!Number.isInteger(year) || year < 2000) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1) return null;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function scheduleReferenceLocalDate(row: DebtorScheduleStatusRow, timeZone: string) {
  return scheduleLocalDate(
    row.charge_due_at ?? row.first_sent_at ?? row.last_sent_at ?? row.data_envio ?? null,
    timeZone,
  );
}

function isPaidSchedule(row: DebtorScheduleStatusRow, timeZone: string) {
  const status = String(row.status ?? "").trim().toLowerCase();
  return (
    status === "pago" ||
    Boolean(scheduleLocalDate(row.payment_received_at ?? null, timeZone)) ||
    (status === "pago" && Boolean(scheduleLocalDate(row.closed_at ?? null, timeZone)))
  );
}

function getMatchingSchedulesForCharge(params: {
  charge: DebtorChargeRow;
  schedules: DebtorScheduleStatusRow[];
  scheduleTimeZone: string;
  usedScheduleIndexes?: Set<number>;
}) {
  const chargeId = String(params.charge.id ?? "").trim();
  const dueLocalDate = buildChargeLocalDate(params.charge);
  const usedIndexes = params.usedScheduleIndexes ?? new Set<number>();

  const exactIndexes = params.schedules
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      if (usedIndexes.has(index)) return false;
      return chargeId && String(row.charge_id ?? "").trim() === chargeId;
    });
  if (exactIndexes.length) {
    for (const { index } of exactIndexes) usedIndexes.add(index);
    return exactIndexes.map(({ row }) => row);
  }

  if (!dueLocalDate) return [];

  const fallbackIndexes = params.schedules
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      if (usedIndexes.has(index)) return false;
      const timeZone = String(row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
      return scheduleReferenceLocalDate(row, timeZone) === dueLocalDate;
    });
  for (const { index } of fallbackIndexes) usedIndexes.add(index);
  return fallbackIndexes.map(({ row }) => row);
}

function countReferenceMonthPaidSchedules(params: {
  schedules: DebtorScheduleStatusRow[];
  referenceYearMonth: string;
  scheduleTimeZone: string;
}) {
  return params.schedules.filter((row) => {
    const timeZone = String(row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
    if (!isPaidSchedule(row, timeZone)) return false;
    const paymentLocalDate =
      scheduleLocalDate(row.payment_received_at ?? null, timeZone) ??
      scheduleLocalDate(row.closed_at ?? null, timeZone);
    return Boolean(paymentLocalDate && paymentLocalDate.slice(0, 7) === params.referenceYearMonth);
  }).length;
}

function getReferenceMonthSchedules(params: {
  schedules: DebtorScheduleStatusRow[];
  referenceYearMonth: string;
  scheduleTimeZone: string;
}) {
  return params.schedules.filter((row) => {
    const timeZone = String(row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
    const referenceLocalDate = scheduleReferenceLocalDate(row, timeZone);
    return Boolean(referenceLocalDate && referenceLocalDate.slice(0, 7) === params.referenceYearMonth);
  });
}

function hasOpenOverdueSchedule(params: {
  schedules: DebtorScheduleStatusRow[];
  currentLocalDate: string;
  scheduleTimeZone: string;
}) {
  return params.schedules.some((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    if (!status || status === "pago" || status === "pausado") return false;

    const timeZone = String(row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
    if (isPaidSchedule(row, timeZone)) return false;
    if (String(row.closed_at ?? "").trim()) return false;

    const referenceLocalDate = scheduleReferenceLocalDate(row, timeZone);
    return Boolean(referenceLocalDate && referenceLocalDate < params.currentLocalDate);
  });
}

function deriveReferenceMonthDebtorStatus(
  charges: DebtorChargeRow[],
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
): DebtorChargeStatus {
  const scheduleTimeZone = String(schedules[0]?.schedule_timezone ?? "") || "America/Sao_Paulo";
  const currentLocalDate = scheduleLocalDate(nowUtcIso, scheduleTimeZone);
  if (!currentLocalDate) return "agendado";
  const referenceYearMonth = currentLocalDate.slice(0, 7);

  if (
    hasOpenOverdueSchedule({
      schedules,
      currentLocalDate,
      scheduleTimeZone,
    })
  ) {
    return "atrasado";
  }

  const referenceCharges = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .filter((charge) => {
      const year = String(charge.recurrence_year ?? "").padStart(4, "0");
      const month = String(charge.recurrence_month ?? "").padStart(2, "0");
      return `${year}-${month}` === referenceYearMonth;
    })
    .sort(compareChargeOrder);

  if (!referenceCharges.length) {
    const referenceSchedules = getReferenceMonthSchedules({
      schedules,
      referenceYearMonth,
      scheduleTimeZone,
    });
    if (!referenceSchedules.length) return "agendado";

    const paidSchedulesInReferenceMonth = referenceSchedules.filter((row) => {
      const timeZone = String(row.schedule_timezone ?? "").trim() || scheduleTimeZone;
      return isPaidSchedule(row, timeZone);
    }).length;

    if (paidSchedulesInReferenceMonth >= referenceSchedules.length) return "pago";

    const hasReferenceMonthOverdue = referenceSchedules.some((row) => {
      const timeZone = String(row.schedule_timezone ?? "").trim() || scheduleTimeZone;
      if (isPaidSchedule(row, timeZone)) return false;
      if (String(row.closed_at ?? "").trim()) return false;
      const referenceLocalDate = scheduleReferenceLocalDate(row, timeZone);
      return Boolean(referenceLocalDate && referenceLocalDate < currentLocalDate);
    });

    if (hasReferenceMonthOverdue) return "atrasado";
    return "agendado";
  }

  let paidCount = 0;
  let hasOverdue = false;
  const usedScheduleIndexes = new Set<number>();

  for (const charge of referenceCharges) {
    const dueLocalDate = buildChargeLocalDate(charge);
    if (!dueLocalDate) continue;

    const matchingSchedules = getMatchingSchedulesForCharge({
      charge,
      schedules,
      scheduleTimeZone,
      usedScheduleIndexes,
    });
    const paid = matchingSchedules.some((row) => {
      const timeZone = String(row.schedule_timezone ?? "").trim() || scheduleTimeZone;
      return isPaidSchedule(row, timeZone);
    });

    if (paid) {
      paidCount += 1;
      continue;
    }

    if (dueLocalDate < currentLocalDate) {
      hasOverdue = true;
    }
  }

  if (paidCount >= referenceCharges.length) return "pago";
  if (hasOverdue) return "atrasado";
  return "agendado";
}

export function deriveDebtorChargeProgress(
  charges: DebtorChargeRow[],
  schedules: DebtorScheduleStatusRow[],
) {
  const normalizedCharges = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .map((charge) => String(charge.id ?? "").trim())
    .filter(Boolean);

  if (!normalizedCharges.length) return { paid: 0, total: 0 };

  const paidChargeIds = new Set(
    schedules
      .filter((row) => {
        const status = String(row.status ?? "").trim().toLowerCase();
        return status === "pago" || Boolean(String(row.payment_received_at ?? "").trim());
      })
      .map((row) => String(row.charge_id ?? "").trim())
      .filter(Boolean),
  );

  const paid = normalizedCharges.filter((chargeId) => paidChargeIds.has(chargeId)).length;
  return { paid, total: normalizedCharges.length };
}

export function deriveReferenceMonthDebtorChargeProgress(
  charges: DebtorChargeRow[],
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
) {
  const scheduleTimeZone = String(schedules[0]?.schedule_timezone ?? "") || "America/Sao_Paulo";
  const currentLocalDate = scheduleLocalDate(nowUtcIso, scheduleTimeZone);
  if (!currentLocalDate) return { paid: 0, total: 0 };
  const referenceYearMonth = currentLocalDate.slice(0, 7);

  const referenceChargeIds = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .filter((charge) => {
      const year = String(charge.recurrence_year ?? "").padStart(4, "0");
      const month = String(charge.recurrence_month ?? "").padStart(2, "0");
      return `${year}-${month}` === referenceYearMonth;
    })
    .sort(compareChargeOrder)
    .map((charge) => String(charge.id ?? "").trim())
    .filter(Boolean);

  if (!referenceChargeIds.length) {
    const referenceSchedules = getReferenceMonthSchedules({
      schedules,
      referenceYearMonth,
      scheduleTimeZone,
    });
    if (!referenceSchedules.length) return { paid: 0, total: 0 };

    const paidSchedulesInReferenceMonth = referenceSchedules.filter((row) => {
      const timeZone = String(row.schedule_timezone ?? "").trim() || scheduleTimeZone;
      return isPaidSchedule(row, timeZone);
    }).length;

    return { paid: paidSchedulesInReferenceMonth, total: referenceSchedules.length };
  }

  const referenceCharges = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .filter((charge) => {
      const year = String(charge.recurrence_year ?? "").padStart(4, "0");
      const month = String(charge.recurrence_month ?? "").padStart(2, "0");
      return `${year}-${month}` === referenceYearMonth;
    })
    .sort(compareChargeOrder);
  const usedScheduleIndexes = new Set<number>();
  const paid = referenceCharges.filter((charge) => {
    const matchingSchedules = getMatchingSchedulesForCharge({
      charge,
      schedules,
      scheduleTimeZone,
      usedScheduleIndexes,
    });
    return matchingSchedules.some((row) => {
      const timeZone = String(row.schedule_timezone ?? "").trim() || scheduleTimeZone;
      return isPaidSchedule(row, timeZone);
    });
  }).length;
  return { paid, total: referenceChargeIds.length };
}

export function applyCurrentMonthDebtorStatuses<
  T extends {
    id: string;
    status: string | null;
    charges?: DebtorChargeRow[] | null;
  },
>(params: {
  debtors: T[];
  schedules: DebtorScheduleStatusRow[];
  nowUtcIso?: string;
}) {
  const schedulesByDebtor = new Map<string, DebtorScheduleStatusRow[]>();

  for (const schedule of params.schedules) {
    const debtorId = String(schedule?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(schedule);
    schedulesByDebtor.set(debtorId, list);
  }

  return params.debtors.map((debtor) => ({
    ...debtor,
    status: (() => {
      const schedules = schedulesByDebtor.get(String(debtor.id)) ?? [];
      const openSchedules = schedules.filter((row) => !String(row.closed_at ?? "").trim());
      if (!openSchedules.length) return "-";
      return deriveReferenceMonthDebtorStatus(
        Array.isArray(debtor.charges) ? debtor.charges : [],
        openSchedules,
        params.nowUtcIso,
      );
    })(),
  }));
}

function statusPriority(status: string) {
  switch (status) {
    case "atrasado":
      return 5;
    case "suspeita_de_pagamento":
      return 4;
    case "agendado":
      return 2;
    case "pago":
      return 1;
    case "executado":
      return 1;
    default:
      return 0;
  }
}

function normalizeDebtorChargeStatus(status: string) {
  switch (status) {
    case "pago":
    case "atrasado":
    case "agendado":
      return status;
    case "pendente":
      return "atrasado";
    case "suspeita_de_pagamento":
      return "agendado";
    default:
      return "agendado";
  }
}

export async function syncDebtorChargeStatus(admin: any, userId: string, debtorId: string) {
  const [{ data: schedules }, { data: charges }] = await Promise.all([
    admin
      .from("schedules")
      .select(
        "charge_id, status, recurrence, data_envio, charge_due_at, first_sent_at, last_sent_at, payment_received_at, schedule_timezone, closed_at",
      )
      .eq("user_id", userId)
      .eq("debtor_id", debtorId)
      .order("data_envio", { ascending: false })
      .limit(200),
    admin
      .from("debtor_charges")
      .select("id, due_day, recurrence_month, recurrence_year, created_at")
      .eq("debtor_id", debtorId)
      .limit(20),
  ]);

  const nextStatus =
    deriveReferenceMonthDebtorStatus(
      (charges ?? []) as DebtorChargeRow[],
      (schedules ?? []) as DebtorScheduleStatusRow[],
    );

  await admin
    .from("debtors")
    .update({ status: normalizeDebtorChargeStatus(nextStatus) })
    .eq("user_id", userId)
    .eq("id", debtorId);
}
