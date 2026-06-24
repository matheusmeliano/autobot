import { localDateInTimeZone } from "@/lib/recurrence";

export type DebtorChargeStatus = "agendado" | "atrasado" | "pago";

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

function deriveReferenceMonthDebtorStatus(
  charges: DebtorChargeRow[],
  schedules: DebtorScheduleStatusRow[],
  nowUtcIso = new Date().toISOString(),
): DebtorChargeStatus {
  const scheduleTimeZone = String(schedules[0]?.schedule_timezone ?? "") || "America/Sao_Paulo";
  const currentLocalDate = scheduleLocalDate(nowUtcIso, scheduleTimeZone);
  if (!currentLocalDate) return "agendado";
  const referenceYearMonth = currentLocalDate.slice(0, 7);

  const referenceCharges = charges
    .filter((charge) => buildChargeLocalDate(charge))
    .filter((charge) => {
      const year = String(charge.recurrence_year ?? "").padStart(4, "0");
      const month = String(charge.recurrence_month ?? "").padStart(2, "0");
      return `${year}-${month}` === referenceYearMonth;
    })
    .sort(compareChargeOrder);

  if (!referenceCharges.length) return "agendado";

  let paidCount = 0;
  let hasOverdue = false;

  for (const charge of referenceCharges) {
    const chargeId = String(charge.id ?? "").trim();
    const dueLocalDate = buildChargeLocalDate(charge);
    if (!dueLocalDate) continue;

    const matchingSchedules = chargeId
      ? schedules.filter((row) => String(row.charge_id ?? "").trim() === chargeId)
      : [];
    const timeZone = String(matchingSchedules[0]?.schedule_timezone ?? "") || scheduleTimeZone;
    const paid = matchingSchedules.some((row) => {
      const status = String(row.status ?? "").trim().toLowerCase();
      return (
        status === "pago" ||
        status === "executado" ||
        Boolean(scheduleLocalDate(row.payment_received_at ?? null, timeZone))
      );
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
    status: deriveReferenceMonthDebtorStatus(
      Array.isArray(debtor.charges) ? debtor.charges : [],
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
