import { type BrazilTimeZone, zonedDateTimeToUtcIso } from "@/lib/timezone";

export type AgendarStatusRow = {
  id?: string | null;
  source_kind?: string | null;
  schedule_missing?: boolean | null;
  status?: string | null;
  data_envio?: string | null;
  charge_due_at?: string | null;
  operational_due_at?: string | null;
  payment_received_at?: string | null;
  last_executed_scheduled_for?: string | null;
};

export type AgendarVisualStatus = {
  label: "-" | "Agendado" | "Executado";
  subtitle: "Não pago" | "Pago" | null;
  isExecuted: boolean;
  isPaid: boolean;
  referenceMoment: string | null;
  referenceMonthKey: string;
  isCurrentMonth: boolean;
  scheduleUnavailable: boolean;
};

export function agendarYearMonthKey(value: string, timeZone: BrazilTimeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }
  return `${map.year}-${map.month}`;
}

function agendarLocalDateParts(value: string, timeZone: BrazilTimeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }
  if (!map.year || !map.month || !map.day) return null;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function agendarLocalTime(value: string, timeZone: BrazilTimeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }
  return map.hour && map.minute ? `${map.hour}:${map.minute}` : null;
}

function agendarLastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function buildAgendarOperationalMonthMoment(
  row: AgendarStatusRow,
  timeZone: BrazilTimeZone,
  operationalMonthKey: string,
) {
  const sourceMoment = String(row.operational_due_at ?? row.charge_due_at ?? row.data_envio ?? "").trim();
  if (!sourceMoment || !/^\d{4}-\d{2}$/.test(operationalMonthKey)) return "";

  const localDate = agendarLocalDateParts(sourceMoment, timeZone);
  const localTime = agendarLocalTime(sourceMoment, timeZone);
  if (!localDate || !localTime) return sourceMoment;

  const [yearRaw, monthRaw] = operationalMonthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return sourceMoment;

  const safeDay = Math.max(1, Math.min(localDate.day, agendarLastDayOfMonth(year, month)));
  return zonedDateTimeToUtcIso({
    date: `${yearRaw}-${monthRaw}-${String(safeDay).padStart(2, "0")}`,
    time: localTime,
    timeZone,
  });
}

export function getAgendarDisplayReferenceMoment(
  row: AgendarStatusRow,
  timeZone: BrazilTimeZone,
  operationalMonthKey = agendarYearMonthKey(new Date().toISOString(), timeZone),
) {
  const operationalMoment = String(row.operational_due_at ?? "").trim();
  const dueMoment = String(row.charge_due_at ?? row.data_envio ?? "").trim();
  const lastExecutedMoment = String(row.last_executed_scheduled_for ?? "").trim();
  const operationalYearMonth = operationalMoment ? agendarYearMonthKey(operationalMoment, timeZone) : "";
  const dueYearMonth = dueMoment ? agendarYearMonthKey(dueMoment, timeZone) : "";
  const executedYearMonth = lastExecutedMoment ? agendarYearMonthKey(lastExecutedMoment, timeZone) : "";
  const projectedCurrentMonthMoment = buildAgendarOperationalMonthMoment(
    row,
    timeZone,
    operationalMonthKey,
  );

  if (operationalYearMonth && operationalYearMonth === operationalMonthKey) {
    return operationalMoment;
  }

  if (
    executedYearMonth &&
    executedYearMonth === operationalMonthKey &&
    dueYearMonth !== operationalMonthKey
  ) {
    return lastExecutedMoment;
  }

  if (projectedCurrentMonthMoment) {
    return projectedCurrentMonthMoment;
  }

  return operationalMoment || dueMoment || lastExecutedMoment;
}

function getAgendarStatusReferenceMoment(
  row: AgendarStatusRow,
  timeZone: BrazilTimeZone,
  operationalMonthKey: string,
) {
  const operationalMoment = String(row.operational_due_at ?? "").trim();
  const dueMoment = String(row.charge_due_at ?? row.data_envio ?? "").trim();
  const lastExecutedMoment = String(row.last_executed_scheduled_for ?? "").trim();
  const operationalYearMonth = operationalMoment ? agendarYearMonthKey(operationalMoment, timeZone) : "";
  const dueYearMonth = dueMoment ? agendarYearMonthKey(dueMoment, timeZone) : "";
  const executedYearMonth = lastExecutedMoment ? agendarYearMonthKey(lastExecutedMoment, timeZone) : "";

  if (operationalYearMonth && operationalYearMonth === operationalMonthKey) {
    return operationalMoment;
  }

  if (
    executedYearMonth &&
    executedYearMonth === operationalMonthKey &&
    dueYearMonth !== operationalMonthKey
  ) {
    return lastExecutedMoment;
  }

  return dueMoment || lastExecutedMoment;
}

export function deriveAgendarVisualStatus(
  row: AgendarStatusRow,
  timeZone: BrazilTimeZone,
  operationalMonthKey = agendarYearMonthKey(new Date().toISOString(), timeZone),
): AgendarVisualStatus {
  const sourceKind = String(row.source_kind ?? "").trim().toLowerCase();
  const scheduleUnavailable =
    sourceKind === "charge" ||
    Boolean(row.schedule_missing) ||
    String(row.id ?? "").startsWith("charge:");
  const currentCycleMoment = String(
    row.operational_due_at ?? row.charge_due_at ?? row.data_envio ?? "",
  ).trim();
  const currentCycleMonthKey = currentCycleMoment
    ? agendarYearMonthKey(currentCycleMoment, timeZone)
    : "";

  if (scheduleUnavailable || !currentCycleMoment || currentCycleMonthKey !== operationalMonthKey) {
    return {
      label: "-",
      subtitle: null,
      isExecuted: false,
      isPaid: false,
      referenceMoment: null,
      referenceMonthKey: currentCycleMonthKey,
      isCurrentMonth: false,
      scheduleUnavailable,
    };
  }

  const referenceMoment = String(
    getAgendarStatusReferenceMoment(row, timeZone, operationalMonthKey) ?? "",
  ).trim();

  if (!referenceMoment) {
    return {
      label: "-",
      subtitle: null,
      isExecuted: false,
      isPaid: false,
      referenceMoment: null,
      referenceMonthKey: "",
      isCurrentMonth: false,
      scheduleUnavailable,
    };
  }

  const referenceMonthKey = agendarYearMonthKey(referenceMoment, timeZone);
  const scheduledCycleMoment = String(row.charge_due_at ?? row.data_envio ?? "").trim();
  const scheduledCycleMonthKey = scheduledCycleMoment
    ? agendarYearMonthKey(scheduledCycleMoment, timeZone)
    : "";
  const lastExecutedMoment = String(row.last_executed_scheduled_for ?? "").trim();
  const lastExecutedMonthKey = lastExecutedMoment
    ? agendarYearMonthKey(lastExecutedMoment, timeZone)
    : "";
  const paymentMoment = String(row.payment_received_at ?? "").trim();
  const paymentMonthKey = paymentMoment ? agendarYearMonthKey(paymentMoment, timeZone) : "";
  const normalizedStatus = String(row.status ?? "").trim().toLowerCase();
  const isCurrentMonth = referenceMonthKey === operationalMonthKey;
  const isExecuted =
    Boolean(referenceMonthKey) &&
    ((Boolean(lastExecutedMoment) && lastExecutedMonthKey === referenceMonthKey) ||
      normalizedStatus === "executado" ||
      normalizedStatus === "pago" ||
      (Boolean(paymentMoment) && paymentMonthKey === referenceMonthKey));
  const isPaid =
    Boolean(referenceMonthKey) &&
    ((Boolean(paymentMoment) && paymentMonthKey === referenceMonthKey) ||
      (normalizedStatus === "pago" && isCurrentMonth) ||
      (isCurrentMonth &&
        normalizedStatus === "agendado" &&
        Boolean(lastExecutedMoment) &&
        lastExecutedMonthKey === operationalMonthKey &&
        ((Boolean(scheduledCycleMonthKey) && scheduledCycleMonthKey !== operationalMonthKey) ||
          (Boolean(currentCycleMonthKey) && currentCycleMonthKey !== operationalMonthKey))));

  if (!isCurrentMonth || !isExecuted) {
    return {
      label: "Agendado",
      subtitle: null,
      isExecuted: false,
      isPaid: false,
      referenceMoment: isCurrentMonth ? referenceMoment : null,
      referenceMonthKey,
      isCurrentMonth,
      scheduleUnavailable,
    };
  }

  return {
    label: "Executado",
    subtitle: isPaid ? "Pago" : "Não pago",
    isExecuted: true,
    isPaid,
    referenceMoment,
    referenceMonthKey,
    isCurrentMonth,
    scheduleUnavailable,
  };
}
