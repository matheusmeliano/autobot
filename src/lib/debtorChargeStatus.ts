import { localDateInTimeZone } from "@/lib/recurrence";

export type DebtorChargeStatus = "ativo" | "pendente" | "pago" | "atrasado";

type DebtorScheduleStatusRow = {
  debtor_id?: string | null;
  status?: string | null;
  data_envio?: string | null;
  charge_due_at?: string | null;
  payment_received_at?: string | null;
  schedule_timezone?: string | null;
  closed_at?: string | null;
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

export function deriveCurrentMonthDebtorStatus(
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
): DebtorChargeStatus {
  let hasPaidInCurrentMonth = false;
  let hasPendingInCurrentMonth = false;
  let hasAnyPaid = false;

  for (const row of schedules) {
    const timeZone = String(row?.schedule_timezone ?? "") || "America/Sao_Paulo";
    const currentLocalDate = scheduleLocalDate(nowUtcIso, timeZone);
    if (!currentLocalDate) continue;

    const currentMonth = currentLocalDate.slice(0, 7);
    const dueLocalDate = scheduleLocalDate(row?.charge_due_at ?? row?.data_envio ?? null, timeZone);
    const paymentLocalDate = scheduleLocalDate(row?.payment_received_at ?? null, timeZone);
    const currentStatus = String(row?.status ?? "").trim().toLowerCase();
    const isClosed = Boolean(String(row?.closed_at ?? "").trim());

    if (!isClosed && currentStatus !== "pago" && dueLocalDate) {
      if (currentLocalDate > dueLocalDate) {
        return "atrasado";
      }
      if (dueLocalDate.slice(0, 7) === currentMonth) {
        hasPendingInCurrentMonth = true;
      }
      continue;
    }

    if (currentStatus === "pago" || paymentLocalDate) {
      hasAnyPaid = true;
      if (paymentLocalDate && paymentLocalDate.slice(0, 7) === currentMonth) {
        hasPaidInCurrentMonth = true;
      }
    }
  }

  if (hasPaidInCurrentMonth) return "pago";
  if (hasPendingInCurrentMonth) return "pendente";
  if (hasAnyPaid) return "pago";
  return "pendente";
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
      return status;
    case "agendado":
    case "suspeita_de_pagamento":
      return "pendente";
    default:
      return "pendente";
  }
}

export async function syncDebtorChargeStatus(admin: any, userId: string, debtorId: string) {
  const { data: schedules } = await admin
    .from("schedules")
    .select("status, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at")
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
