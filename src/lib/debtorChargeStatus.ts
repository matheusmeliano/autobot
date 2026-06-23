import { localDateInTimeZone } from "@/lib/recurrence";

export type DebtorChargeStatus = "agendado" | "pendente" | "pago" | "atrasado";

type DebtorScheduleStatusRow = {
  debtor_id?: string | null;
  charge_id?: string | null;
  status?: string | null;
  recurrence?: string | null;
  data_envio?: string | null;
  charge_due_at?: string | null;
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

const OVERDUE_GRACE_DAYS = 3;

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

function deriveFirstChargeDebtorStatus(
  charges: DebtorChargeRow[],
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
): DebtorChargeStatus | null {
  const firstCharge = [...charges]
    .sort(compareChargeOrder)
    .find((charge) => buildChargeLocalDate(charge));

  if (!firstCharge) return null;

  const firstChargeId = String(firstCharge.id ?? "").trim();
  const matchingSchedules = firstChargeId
    ? schedules.filter((row) => String(row.charge_id ?? "").trim() === firstChargeId)
    : [];
  const timeZone = String(matchingSchedules[0]?.schedule_timezone ?? "") || "America/Sao_Paulo";
  const currentLocalDate = scheduleLocalDate(nowUtcIso, timeZone);
  const dueLocalDate = buildChargeLocalDate(firstCharge);
  if (!currentLocalDate || !dueLocalDate) return null;

  const paid = matchingSchedules.some((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    return (
      status === "pago" ||
      status === "executado" ||
      Boolean(scheduleLocalDate(row.payment_received_at ?? null, timeZone))
    );
  });
  if (paid) return "pago";

  const daysSinceDue = diffDaysLocalDate(dueLocalDate, currentLocalDate);
  if (daysSinceDue >= OVERDUE_GRACE_DAYS) return "atrasado";
  if (daysSinceDue >= 1) return "pendente";
  return "agendado";
}

function deriveCurrentMonthDebtorSnapshot(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
) {
  let total = 0;
  let paid = 0;
  let hasPending = false;
  let hasOverdue = false;
  let hasScheduled = false;
  let hasFutureScheduled = false;

  for (const row of schedules) {
    const timeZone = String(row?.schedule_timezone ?? "") || "America/Sao_Paulo";
    const currentLocalDate = scheduleLocalDate(nowUtcIso, timeZone);
    if (!currentLocalDate) continue;
    const currentMonth = currentLocalDate.slice(0, 7);

    const isClosed = Boolean(String(row?.closed_at ?? "").trim());
    if (isClosed) continue;

    const recurrence = String(row?.recurrence ?? "").trim().toLowerCase();
    const dueLocalDate = scheduleLocalDate(row?.charge_due_at ?? row?.data_envio ?? null, timeZone);
    if (!dueLocalDate) continue;
    const paymentLocalDate = scheduleLocalDate(row?.payment_received_at ?? null, timeZone);

    const dueMonth = dueLocalDate.slice(0, 7);
    const isRecurring = recurrence === "monthly" || recurrence === "yearly";
    const paymentInCurrentMonth = Boolean(paymentLocalDate && paymentLocalDate.slice(0, 7) === currentMonth);
    if (dueMonth > currentMonth && !(isRecurring && paymentInCurrentMonth)) {
      hasFutureScheduled = true;
      continue;
    }
    const isRelevant = dueMonth === currentMonth || (isRecurring && paymentInCurrentMonth && dueMonth > currentMonth);
    if (!isRelevant) continue;

    total += 1;

    const status = String(row?.status ?? "").trim().toLowerCase();

    const paidThisMonth = isRecurring
      ? Boolean(paymentLocalDate && paymentLocalDate.slice(0, 7) === currentMonth && dueMonth > currentMonth)
      : status === "pago" || Boolean(paymentLocalDate);

    if (paidThisMonth) {
      paid += 1;
      continue;
    }

    const daysSinceDue = diffDaysLocalDate(dueLocalDate, currentLocalDate);
    if (daysSinceDue >= OVERDUE_GRACE_DAYS) {
      hasOverdue = true;
      continue;
    }
    if (daysSinceDue >= 0) {
      hasPending = true;
      continue;
    }
    hasScheduled = true;
  }

  return { total, paid, hasPending, hasOverdue, hasScheduled, hasFutureScheduled };
}

export function deriveCurrentMonthDebtorStatus(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
): DebtorChargeStatus {
  const snap = deriveCurrentMonthDebtorSnapshot(schedules, nowUtcIso);
  if (snap.total <= 0) return snap.hasFutureScheduled ? "agendado" : "pendente";
  if (snap.hasOverdue) return "atrasado";
  if (snap.hasPending) return "pendente";
  if (snap.paid >= snap.total) return "pago";
  if (snap.hasScheduled || snap.hasFutureScheduled) return "agendado";
  return "pendente";
}

export function deriveCurrentMonthDebtorProgress(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
) {
  const snap = deriveCurrentMonthDebtorSnapshot(schedules, nowUtcIso);
  return { paid: snap.paid, total: snap.total };
}

export function deriveDebtorChargeProgress(
  charges: DebtorChargeRow[],
  schedules: DebtorScheduleStatusRow[],
) {
  const normalizedCharges = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .map((charge) => String(charge.id ?? "").trim())
    .filter(Boolean);

  if (!normalizedCharges.length) {
    return deriveCurrentMonthDebtorProgress(schedules);
  }

  const paidChargeIds = new Set(
    schedules
      .filter((row) => {
        const status = String(row.status ?? "").trim().toLowerCase();
        return (
          status === "pago" ||
          status === "executado" ||
          Boolean(String(row.payment_received_at ?? "").trim())
        );
      })
      .map((row) => String(row.charge_id ?? "").trim())
      .filter(Boolean),
  );

  const paid = normalizedCharges.filter((chargeId) => paidChargeIds.has(chargeId)).length;
  return { paid, total: normalizedCharges.length };
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
    status:
      deriveFirstChargeDebtorStatus(
        Array.isArray(debtor.charges) ? debtor.charges : [],
        schedulesByDebtor.get(String(debtor.id)) ?? [],
        params.nowUtcIso,
      ) ??
      deriveCurrentMonthDebtorStatus(
        schedulesByDebtor.get(String(debtor.id)) ?? [],
        params.nowUtcIso,
      ),
  }));
}

function statusPriority(status: string) {
  switch (status) {
    case "atrasado":
      return 5;
    case "suspeita_de_pagamento":
      return 4;
    case "pendente":
      return 3;
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
    case "pendente":
    case "pago":
    case "atrasado":
    case "agendado":
      return status;
    case "suspeita_de_pagamento":
      return "agendado";
    default:
      return "pendente";
  }
}

export async function syncDebtorChargeStatus(admin: any, userId: string, debtorId: string) {
  const [{ data: schedules }, { data: charges }] = await Promise.all([
    admin
      .from("schedules")
      .select("charge_id, status, recurrence, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at")
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
    deriveFirstChargeDebtorStatus(
      (charges ?? []) as DebtorChargeRow[],
      (schedules ?? []) as DebtorScheduleStatusRow[],
    ) ?? deriveCurrentMonthDebtorStatus((schedules ?? []) as DebtorScheduleStatusRow[]);

  await admin
    .from("debtors")
    .update({ status: normalizeDebtorChargeStatus(nextStatus) })
    .eq("user_id", userId)
    .eq("id", debtorId);
}
