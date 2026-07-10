import { localDateInTimeZone } from "@/lib/recurrence";

export type DebtorChargeStatus = "agendado" | "atrasado" | "pago";

type DebtorScheduleStatusRow = {
  id?: string | null;
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
  last_executed_scheduled_for?: string | null;
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

function yearMonthFromIso(value: string | null | undefined, timeZone: string) {
  const localDate = scheduleLocalDate(value, timeZone);
  return localDate ? localDate.slice(0, 7) : "";
}

function executedLocalDate(row: DebtorScheduleStatusRow, timeZone: string) {
  return (
    scheduleLocalDate(row.last_executed_scheduled_for ?? null, timeZone) ??
    scheduleLocalDate(row.last_sent_at ?? null, timeZone) ??
    scheduleLocalDate(row.first_sent_at ?? null, timeZone)
  );
}

function rolledForwardReferenceYearMonth(row: DebtorScheduleStatusRow, timeZone: string) {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status !== "agendado") return null;

  const nextReferenceLocalDate = scheduleReferenceLocalDate(row, timeZone);
  const lastExecutedLocalDate = scheduleLocalDate(row.last_executed_scheduled_for ?? null, timeZone);
  if (!nextReferenceLocalDate || !lastExecutedLocalDate) return null;

  const nextReferenceYearMonth = nextReferenceLocalDate.slice(0, 7);
  const lastExecutedYearMonth = lastExecutedLocalDate.slice(0, 7);
  if (!nextReferenceYearMonth || !lastExecutedYearMonth) return null;
  if (nextReferenceYearMonth <= lastExecutedYearMonth) return null;

  return lastExecutedYearMonth;
}

function isPaidSchedule(row: DebtorScheduleStatusRow, timeZone: string) {
  const status = String(row.status ?? "").trim().toLowerCase();
  return (
    status === "pago" ||
    Boolean(scheduleLocalDate(row.payment_received_at ?? null, timeZone)) ||
    (status === "pago" && Boolean(scheduleLocalDate(row.closed_at ?? null, timeZone)))
  );
}

function isAgendarExecutedPaidForReferenceMonth(params: {
  row: DebtorScheduleStatusRow;
  referenceYearMonth: string;
  scheduleTimeZone: string;
}) {
  const timeZone = String(params.row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
  const normalizedStatus = String(params.row.status ?? "").trim().toLowerCase();
  const lastExecutedYearMonth = yearMonthFromIso(params.row.last_executed_scheduled_for ?? null, timeZone);
  const paymentYearMonth = yearMonthFromIso(params.row.payment_received_at ?? null, timeZone);
  const scheduledCycleYearMonth = yearMonthFromIso(
    params.row.charge_due_at ?? params.row.data_envio ?? null,
    timeZone,
  );

  return (
    paymentYearMonth === params.referenceYearMonth ||
    normalizedStatus === "pago" ||
    ((normalizedStatus === "agendado" || normalizedStatus === "executado") &&
      lastExecutedYearMonth === params.referenceYearMonth &&
      Boolean(scheduledCycleYearMonth) &&
      scheduledCycleYearMonth !== params.referenceYearMonth)
  );
}

function isSchedulePaidForReferenceMonth(params: {
  row: DebtorScheduleStatusRow;
  referenceYearMonth: string;
  scheduleTimeZone: string;
}) {
  const timeZone = String(params.row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
  if (isPaidSchedule(params.row, timeZone)) {
    const paymentLocalDate =
      scheduleLocalDate(params.row.payment_received_at ?? null, timeZone) ??
      scheduleLocalDate(params.row.closed_at ?? null, timeZone);
    if (paymentLocalDate?.slice(0, 7) === params.referenceYearMonth) return true;

    const scheduleReferenceDate = scheduleReferenceLocalDate(params.row, timeZone);
    if (scheduleReferenceDate?.slice(0, 7) === params.referenceYearMonth) return true;
  }

  return rolledForwardReferenceYearMonth(params.row, timeZone) === params.referenceYearMonth;
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
  const fallbackIndexes =
    dueLocalDate == null
      ? []
      : params.schedules
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      if (usedIndexes.has(index)) return false;
      const timeZone = String(row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
      return scheduleReferenceLocalDate(row, timeZone) === dueLocalDate;
    });
  const combined = [...exactIndexes];
  for (const fallback of fallbackIndexes) {
    if (combined.some(({ index }) => index === fallback.index)) continue;
    combined.push(fallback);
  }
  for (const { index } of combined) usedIndexes.add(index);
  return combined.map(({ row }) => row);
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
    if (paymentLocalDate?.slice(0, 7) === params.referenceYearMonth) return true;

    const scheduleReferenceDate = scheduleReferenceLocalDate(row, timeZone);
    return Boolean(scheduleReferenceDate && scheduleReferenceDate.slice(0, 7) === params.referenceYearMonth);
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

function getReferenceMonthOperationalSchedules(params: {
  schedules: DebtorScheduleStatusRow[];
  referenceYearMonth: string;
  scheduleTimeZone: string;
}) {
  return params.schedules.filter((row) => {
    const timeZone = String(row.schedule_timezone ?? "").trim() || params.scheduleTimeZone;
    const referenceLocalDate = scheduleReferenceLocalDate(row, timeZone);
    if (referenceLocalDate?.slice(0, 7) === params.referenceYearMonth) return true;
    return rolledForwardReferenceYearMonth(row, timeZone) === params.referenceYearMonth;
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

    if (status === "executado") {
      const executedDate = executedLocalDate(row, timeZone);
      if (executedDate && diffDaysLocalDate(executedDate, params.currentLocalDate) >= 1) {
        return true;
      }
    }

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
  const openSchedules = schedules.filter((row) => !String(row.closed_at ?? "").trim());

  if (
    hasOpenOverdueSchedule({
      schedules: openSchedules,
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

  if (referenceCharges.length) {
    const usedScheduleIndexes = new Set<number>();
    const paidCharges = referenceCharges.filter((charge) => {
      const matchingSchedules = getMatchingSchedulesForCharge({
        charge,
        schedules: openSchedules,
        scheduleTimeZone,
        usedScheduleIndexes,
      });
      return matchingSchedules.some((row) =>
        isAgendarExecutedPaidForReferenceMonth({
          row,
          referenceYearMonth,
          scheduleTimeZone,
        }),
      );
    }).length;

    if (paidCharges >= referenceCharges.length) return "pago";

    const overdueCharges = referenceCharges.some((charge) => {
      const chargeLocalDate = buildChargeLocalDate(charge);
      if (!chargeLocalDate || chargeLocalDate >= currentLocalDate) return false;
      const matchingSchedules = getMatchingSchedulesForCharge({
        charge,
        schedules: openSchedules,
        scheduleTimeZone,
      });
      if (!matchingSchedules.length) return true;
      return !matchingSchedules.some((row) =>
        isAgendarExecutedPaidForReferenceMonth({
          row,
          referenceYearMonth,
          scheduleTimeZone,
        }),
      );
    });

    if (overdueCharges) return "atrasado";
    return "agendado";
  }

  const referenceSchedules = getReferenceMonthOperationalSchedules({
    schedules: openSchedules,
    referenceYearMonth,
    scheduleTimeZone,
  });
  if (!referenceSchedules.length) return "agendado";

  const paidSchedulesInReferenceMonth = referenceSchedules.filter((row) =>
    isAgendarExecutedPaidForReferenceMonth({
      row,
      referenceYearMonth,
      scheduleTimeZone,
    }),
  ).length;
  if (paidSchedulesInReferenceMonth >= referenceSchedules.length) return "pago";

  const hasReferenceMonthOverdue = referenceSchedules.some((row) => {
    const timeZone = String(row.schedule_timezone ?? "").trim() || scheduleTimeZone;
    if (isAgendarExecutedPaidForReferenceMonth({ row, referenceYearMonth, scheduleTimeZone })) {
      return false;
    }
    const referenceLocalDate = scheduleReferenceLocalDate(row, timeZone);
    return Boolean(
      referenceLocalDate &&
        referenceLocalDate.slice(0, 7) === referenceYearMonth &&
        referenceLocalDate < currentLocalDate,
    );
  });

  if (hasReferenceMonthOverdue) return "atrasado";
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

  const referenceCharges = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .filter((charge) => {
      const year = String(charge.recurrence_year ?? "").padStart(4, "0");
      const month = String(charge.recurrence_month ?? "").padStart(2, "0");
      return `${year}-${month}` === referenceYearMonth;
    })
    .sort(compareChargeOrder);

  if (referenceCharges.length) {
    const usedScheduleIndexes = new Set<number>();
    const paid = referenceCharges.filter((charge) => {
      const matchingSchedules = getMatchingSchedulesForCharge({
        charge,
        schedules,
        scheduleTimeZone,
        usedScheduleIndexes,
      });
      return matchingSchedules.some((row) =>
        isSchedulePaidForReferenceMonth({
          row,
          referenceYearMonth,
          scheduleTimeZone,
        }),
      );
    }).length;

    return { paid, total: referenceCharges.length };
  }

  const referenceSchedules = getReferenceMonthOperationalSchedules({
    schedules,
    referenceYearMonth,
    scheduleTimeZone,
  }).filter((row) => !String(row.closed_at ?? "").trim());
  if (!referenceSchedules.length) return { paid: 0, total: 0 };

  const paid = referenceSchedules.filter((row) =>
    isSchedulePaidForReferenceMonth({
      row,
      referenceYearMonth,
      scheduleTimeZone,
    }),
  ).length;
  return { paid, total: referenceSchedules.length };
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
      if (!schedules.length) return "-";
      const openSchedules = schedules.filter((row) => !String(row.closed_at ?? "").trim());
      const nextStatus = deriveReferenceMonthDebtorStatus(
        Array.isArray(debtor.charges) ? debtor.charges : [],
        schedules,
        params.nowUtcIso,
      );
      if (!openSchedules.length && nextStatus !== "pago") return "-";
      return nextStatus;
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
  const [{ data: schedules }, { data: charges }, { data: scheduleRuns }] = await Promise.all([
    admin
      .from("schedules")
      .select(
        "id, charge_id, status, recurrence, data_envio, charge_due_at, first_sent_at, last_sent_at, payment_received_at, schedule_timezone, closed_at",
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
    admin
      .from("schedule_runs")
      .select("schedule_id, scheduled_for")
      .eq("user_id", userId)
      .eq("status", "executado")
      .order("scheduled_for", { ascending: false })
      .limit(400),
  ]);

  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of (scheduleRuns ?? []) as any[]) {
    const scheduleId = String((run as any)?.schedule_id ?? "").trim();
    const scheduledFor = String((run as any)?.scheduled_for ?? "").trim();
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }

  const debtorSchedules = ((schedules ?? []) as DebtorScheduleStatusRow[]).map((row) => ({
    ...row,
    last_executed_scheduled_for: latestExecutedRunBySchedule.get(String(row.id ?? "").trim()) ?? null,
  }));
  const openSchedules = debtorSchedules.filter((row) => !String(row.closed_at ?? "").trim());
  const derivedStatus = !debtorSchedules.length
    ? "-"
    : deriveReferenceMonthDebtorStatus((charges ?? []) as DebtorChargeRow[], debtorSchedules);
  const nextStatus = !openSchedules.length && derivedStatus !== "pago" ? "-" : derivedStatus;

  await admin
    .from("debtors")
    .update({ status: nextStatus === "-" ? "-" : normalizeDebtorChargeStatus(nextStatus) })
    .eq("user_id", userId)
    .eq("id", debtorId);
}
