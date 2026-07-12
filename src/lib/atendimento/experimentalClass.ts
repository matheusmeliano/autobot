import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "./constants";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

export const EXPERIMENTAL_CLASS_SLOT_TIMES = ["13:00", "14:00", "15:00", "16:00", "17:00"] as const;
export const EXPERIMENTAL_CLASS_BOOKING_SUCCESS_MESSAGE =
  "Sua aula experimental com o professor Lucas Brum foi agendada com sucesso.";
export const EXPERIMENTAL_CLASS_WHATSAPP_NOTICE_MESSAGE =
  "Agora você receberá uma mensagem no WhatsApp confirmando sua inscrição.";

export type ExperimentalClassDateOption = {
  id: string;
  index: number;
  professorDate: string;
  leadDate: string;
  displayLabel: string;
  slotCount: number;
};

export type ExperimentalClassTimeOption = {
  id: string;
  index: number;
  professorDate: string;
  professorTime: string;
  professorStartAt: string;
  leadDate: string;
  leadTime: string;
  displayLabel: string;
};

function partsToMap(parts: Intl.DateTimeFormatPart[]) {
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }
  return map;
}

function localDateInTimeZone(value: Date | string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = partsToMap(parts);
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function endOfMonthLocalDate(localDate: string) {
  const [year, month] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function weekdayInTimeZone(value: Date | string | number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(new Date(value));
}

function formatDateInTimeZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

function formatTimeInTimeZone(iso: string, timeZone: string) {
  const raw = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return raw.replace(":", "h");
}

function normalizeSelectionText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}:/ -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDisplayDateLabel(iso: string, timeZone: string) {
  const formatted = formatDateInTimeZone(iso, timeZone);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function buildExperimentalClassDatesMessage(options: ExperimentalClassDateOption[]) {
  if (!options.length) {
    return "No momento, não há datas disponíveis para aula experimental até o fim deste mês.";
  }

  return [
    "Datas disponíveis para agendamento:",
    ...options.map((option) => `${option.index}. ${option.displayLabel}`),
  ].join("\n");
}

export function buildExperimentalClassTimesMessage(params: {
  dateLabel: string;
  options: ExperimentalClassTimeOption[];
}) {
  if (!params.options.length) {
    return `No momento, não há horários livres para ${params.dateLabel}. Escolha outra data disponível.`;
  }

  return [
    `Horários disponíveis para ${params.dateLabel}:`,
    ...params.options.map((option) => `${option.index}. ${option.displayLabel}`),
  ].join("\n");
}

export function buildExperimentalClassStudentWhatsAppMessage(name: string) {
  const safeName = String(name ?? "").trim() || "Aluno";
  return `Parabéns, ${safeName}!

Ficamos muito felizes em receber você na sua primeira aula da Escola de Música Lucas Brum.

Agora é só aguardar. No dia e horário escolhidos, enviaremos o link da sua aula experimental.`;
}

export function buildExperimentalClassFinalChatMessage(name: string) {
  const safeName = String(name ?? "").trim() || "Aluno";
  return `${safeName}, tudo certo! Agora é só aguardar. Em breve enviaremos o link da sua aula. Até mais!`;
}

export function listExperimentalClassAvailability(params: {
  now?: Date;
  leadTimeZone?: string | null;
  bookedProfessorStartAts?: string[];
}) {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const leadTimeZone = String(params.leadTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const bookedProfessorStarts = new Set(
    (params.bookedProfessorStartAts ?? [])
      .map((value) => new Date(String(value ?? "")).toISOString())
      .filter(Boolean),
  );

  const professorToday = localDateInTimeZone(now, ATENDIMENTO_PROFESSOR_TIME_ZONE);
  const professorMonthEnd = endOfMonthLocalDate(professorToday);
  const dates: ExperimentalClassDateOption[] = [];
  const slotsByProfessorDate = new Map<string, ExperimentalClassTimeOption[]>();

  for (let currentDate = professorToday; currentDate <= professorMonthEnd; currentDate = addDaysToLocalDate(currentDate, 1)) {
    const middayIso = zonedDateTimeToUtcIso({
      date: currentDate,
      time: "12:00",
      timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
    });
    const weekday = weekdayInTimeZone(middayIso, ATENDIMENTO_PROFESSOR_TIME_ZONE).toLowerCase();
    if (weekday === "sun") continue;

    const daySlots: ExperimentalClassTimeOption[] = [];

    for (const professorTime of EXPERIMENTAL_CLASS_SLOT_TIMES) {
      const professorStartAt = zonedDateTimeToUtcIso({
        date: currentDate,
        time: professorTime,
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      });
      const professorStartMs = new Date(professorStartAt).getTime();
      if (!Number.isFinite(professorStartMs) || professorStartMs <= nowMs) continue;
      if (bookedProfessorStarts.has(new Date(professorStartAt).toISOString())) continue;

      const leadDate = localDateInTimeZone(professorStartAt, leadTimeZone);
      daySlots.push({
        id: `${currentDate}|${professorTime}`,
        index: daySlots.length + 1,
        professorDate: currentDate,
        professorTime,
        professorStartAt,
        leadDate,
        leadTime: formatTimeInTimeZone(professorStartAt, leadTimeZone),
        displayLabel: formatTimeInTimeZone(professorStartAt, leadTimeZone),
      });
    }

    if (!daySlots.length) continue;

    slotsByProfessorDate.set(currentDate, daySlots);
    const leadDate = daySlots[0]?.leadDate ?? currentDate;
    dates.push({
      id: currentDate,
      index: dates.length + 1,
      professorDate: currentDate,
      leadDate,
      displayLabel: buildDisplayDateLabel(daySlots[0]?.professorStartAt ?? middayIso, leadTimeZone),
      slotCount: daySlots.length,
    });
  }

  return {
    dates,
    slotsByProfessorDate,
  };
}

export function findExperimentalClassDateOption(
  input: string,
  options: ExperimentalClassDateOption[],
) {
  const normalizedInput = normalizeSelectionText(input);
  if (!normalizedInput) return null;

  for (const option of options) {
    if (normalizedInput === String(option.index)) return option;
    if (normalizedInput.includes(option.professorDate)) return option;
    if (normalizedInput.includes(option.leadDate)) return option;

    const displayDate = normalizeSelectionText(option.displayLabel);
    if (displayDate && normalizedInput.includes(displayDate)) return option;

    const shortLeadDate = option.leadDate.slice(8, 10) + "/" + option.leadDate.slice(5, 7);
    if (normalizedInput.includes(shortLeadDate)) return option;
  }

  return null;
}

export function findExperimentalClassTimeOption(
  input: string,
  options: ExperimentalClassTimeOption[],
) {
  const normalizedInput = normalizeSelectionText(input);
  if (!normalizedInput) return null;

  for (const option of options) {
    if (normalizedInput === String(option.index)) return option;
    if (normalizedInput.includes(option.professorTime)) return option;
    if (normalizedInput.includes(option.displayLabel.replace("h", ":"))) return option;
    if (normalizedInput.includes(normalizeSelectionText(option.displayLabel))) return option;
  }

  return null;
}
