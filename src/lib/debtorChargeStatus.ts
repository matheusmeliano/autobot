import { localDateInTimeZone } from "@/lib/recurrence";

export type DebtorChargeStatus = "agendado" | "pendente" | "pago" | "atrasado";

type DebtorScheduleStatusRow = {
  debtor_id?: string | null;
  status?: string | null;
  recurrence?: string | null;
  data_envio?: string | null;
  charge_due_at?: string | null;
  payment_received_at?: string | null;
  schedule_timezone?: string | null;
  closed_at?: string | null;
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

function deriveCurrentMonthDebtorSnapshot(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
) {
  let total = 0;
  let paid = 0;
  let hasPending = false;
  let hasOverdue = false;
  let hasScheduled = false;

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

    const dueMonth = dueLocalDate.slice(0, 7);
    const isMonthly = recurrence === "monthly";
    const isRelevant = isMonthly || dueMonth === currentMonth;
    if (!isRelevant) continue;

    total += 1;

    const paymentLocalDate = scheduleLocalDate(row?.payment_received_at ?? null, timeZone);
    const status = String(row?.status ?? "").trim().toLowerCase();

    const paidThisMonth = isMonthly
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

  return { total, paid, hasPending, hasOverdue, hasScheduled };
}

export function deriveCurrentMonthDebtorStatus(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
): DebtorChargeStatus {
  const snap = deriveCurrentMonthDebtorSnapshot(schedules, nowUtcIso);
  if (snap.total <= 0) return "pendente";
  if (snap.hasOverdue) return "atrasado";
  if (snap.hasPending) return "pendente";
  if (snap.paid >= snap.total) return "pago";
  if (snap.hasScheduled) return "agendado";
  return "pendente";
}

export function deriveCurrentMonthDebtorProgress(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
) {
  const snap = deriveCurrentMonthDebtorSnapshot(schedules, nowUtcIso);
  return { paid: snap.paid, total: snap.total };
}

export function applyCurrentMonthDebtorStatuses<
  T extends {
    id: string;
    status: string | null;
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
    status: deriveCurrentMonthDebtorStatus(
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
  const { data: schedules } = await admin
    .from("schedules")
    .select("status, recurrence, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at")
    .eq("user_id", userId)
    .eq("debtor_id", debtorId)
    .order("data_envio", { ascending: false })
    .limit(200);

  const nextStatus = deriveCurrentMonthDebtorStatus((schedules ?? []) as DebtorScheduleStatusRow[]);

  await admin
    .from("debtors")
    .update({ status: normalizeDebtorChargeStatus(nextStatus) })
    .eq("user_id", userId)
    .eq("id", debtorId);
}
