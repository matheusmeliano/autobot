import { type BrazilTimeZone } from "@/lib/timezone";

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

export function getAgendarDisplayReferenceMoment(
  row: AgendarStatusRow,
  timeZone: BrazilTimeZone,
  operationalMonthKey = agendarYearMonthKey(new Date().toISOString(), timeZone),
) {
  const operationalMoment = String(row.operational_due_at ?? "").trim();
  const dueMoment = String(row.charge_due_at ?? row.data_envio ?? "").trim();
  const lastExecutedMoment = String(row.last_executed_scheduled_for ?? "").trim();
  const dueYearMonth = dueMoment ? agendarYearMonthKey(dueMoment, timeZone) : "";
  const executedYearMonth = lastExecutedMoment ? agendarYearMonthKey(lastExecutedMoment, timeZone) : "";
  let selectedMoment = operationalMoment || dueMoment || lastExecutedMoment;

  if (!operationalMoment && executedYearMonth && executedYearMonth === operationalMonthKey && dueYearMonth !== operationalMonthKey) {
    selectedMoment = lastExecutedMoment;
  }

  return selectedMoment;
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
  const referenceMoment = String(
    getAgendarStatusReferenceMoment(row, timeZone, operationalMonthKey) ?? "",
  ).trim();

  if (scheduleUnavailable || !referenceMoment) {
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
  const currentCycleMoment = String(
    row.operational_due_at ?? row.charge_due_at ?? row.data_envio ?? "",
  ).trim();
  const currentCycleMonthKey = currentCycleMoment
    ? agendarYearMonthKey(currentCycleMoment, timeZone)
    : "";
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
