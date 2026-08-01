import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "./constants";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

export const EXPERIMENTAL_CLASS_SLOT_TIMES = [
  "08:00",
  "09:30",
  "11:00",
  "12:30",
  "14:00",
  "15:30",
  "17:00",
  "18:30",
  "20:00",
] as const;
export const EXPERIMENTAL_CLASS_DURATION_MINUTES = 90;
export const EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE = "+55 65 9807-9407";
export const EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK = "https://www.autobot.business/app/atendimento";
export const EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES = 5;

export type ExperimentalClassDateOption = {
  id: string;
  professorDate: string;
  leadDate: string;
  dayLabel: string;
  displayLabel: string;
  slotCount: number;
};

export type ExperimentalClassTimeOption = {
  id: string;
  professorDate: string;
  professorTime: string;
  professorStartAt: string;
  leadDate: string;
  leadTime: string;
  displayLabel: string;
};

export type ExperimentalClassBookingDisplayStatus =
  | "incomplete"
  | "scheduled"
  | "cancelled"
  | "in_progress"
  | "no_show"
  | "completed";

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

function startOfNextMonthLocalDate(localDate: string) {
  const [year, month] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}-01`;
}

function maxLocalDate(left: string, right: string) {
  return left >= right ? left : right;
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
    day: "2-digit",
  }).format(new Date(iso));
}

function formatTimeInTimeZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
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

function normalizeFlexibleTimeSelection(value: string) {
  const normalized = normalizeSelectionText(value);
  if (!normalized) return null;

  const compact = normalized
    .replace(/\s+/g, "")
    .replace(/horas?/g, "h")
    .replace(/hrs?/g, "h")
    .replace(/minutos?/g, "min")
    .replace(/mins?/g, "min")
    .replace(/^(\d{1,2}:\d{1,2})h$/, "$1");

  const colonMatch = compact.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const hour = Number(colonMatch[1]);
    const minute = Number(colonMatch[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const hourMinuteMatch = compact.match(/^(\d{1,2})h(\d{1,2})(?:min)?$/);
  if (hourMinuteMatch) {
    const hour = Number(hourMinuteMatch[1]);
    const minute = Number(hourMinuteMatch[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const hourOnlyMatch = compact.match(/^(\d{1,2})h$/);
  if (hourOnlyMatch) {
    const hour = Number(hourOnlyMatch[1]);
    if (hour < 0 || hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:00`;
  }

  return null;
}

function buildDisplayDateLabel(iso: string, timeZone: string) {
  return formatDateInTimeZone(iso, timeZone);
}

function joinWithFinalConjunction(values: string[]) {
  if (!values.length) return "";
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} e ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`;
}

export function deriveExperimentalClassBookingDisplayStatus(params: {
  bookingStatus?: string | null;
  studentStartNotificationSentAt?: string | null;
  attendantStartNotificationSentAt?: string | null;
  attendanceStatus?: string | null;
  hasSchedulingProgress?: boolean;
  hasLead?: boolean;
}) {
  const bookingStatus = String(params.bookingStatus ?? "").trim().toLowerCase();
  const attendanceStatus = String(params.attendanceStatus ?? "").trim().toLowerCase();
  const studentStartNotificationSentAt = String(params.studentStartNotificationSentAt ?? "").trim();
  const attendantStartNotificationSentAt = String(params.attendantStartNotificationSentAt ?? "").trim();

  if (attendanceStatus === "no_show") return "no_show" as const;
  if (attendanceStatus === "attended") return "completed" as const;
  if (bookingStatus === "cancelled") return "cancelled" as const;
  if (bookingStatus === "completed") return "completed" as const;
  if (studentStartNotificationSentAt && attendantStartNotificationSentAt) return "in_progress" as const;
  if (bookingStatus === "scheduled") return "scheduled" as const;
  if (params.hasSchedulingProgress || params.hasLead) return "incomplete" as const;
  return null;
}

export function experimentalClassBookingDisplayStatusLabel(status: ExperimentalClassBookingDisplayStatus | null | undefined) {
  if (status === "incomplete") return "Incompleto";
  if (status === "scheduled") return "Agendado";
  if (status === "cancelled") return "Cancelado";
  if (status === "in_progress") return "Em andamento";
  if (status === "no_show") return "Não compareceu";
  if (status === "completed") return "Concluído";
  return "-";
}

export function buildExperimentalClassDatesMessages(options: ExperimentalClassDateOption[]) {
  if (!options.length) {
    return ["No momento, não há datas disponíveis para aula experimental até o fim deste mês."];
  }

  const labels = options.map((option) => option.dayLabel);
  return [
    `As datas disponíveis são:\n\n${joinWithFinalConjunction(labels)}.`,
    "Responda apenas com o dia desejado.",
  ];
}

export function buildExperimentalClassTimesMessages(params: {
  dayLabel: string;
  options: ExperimentalClassTimeOption[];
}) {
  if (!params.options.length) {
    return [`Não há horários livres para o dia ${params.dayLabel}. Escolha outra data disponível.`];
  }

  return [
    `Perfeito! E os horários disponíveis são:\n\n${params.options.map((option) => option.displayLabel).join(", ")}`,
    "Responda apenas com o horário desejado.",
  ];
}

export function buildExperimentalClassStudentWhatsAppMessages(_name: string) {
  return [
    `Parabéns!`,
    `É uma satisfação receber você para a sua primeira aula em Lucas Brum Online Music USA.`,
    EXPERIMENTAL_CLASS_FINAL_WAIT_MESSAGE,
  ];
}

/** @deprecated Use buildExperimentalClassStudentWhatsAppMessages (3 mensagens separadas) — a mensagem unica concatenada NAO deve mais ser enviada. Mantida apenas para compilacao temporaria, retorna string vazia. */
export function buildExperimentalClassStudentWhatsAppMessage(_name: string) {
  return ``;
}

export function buildExperimentalClassAttendantWhatsAppMessage() {
  return `Você recebeu um novo agendamento de aula experimental.

Acesse o link abaixo e adicione o link da aula ao interessado.

${EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK}`;
}

export function buildExperimentalClassStudentLessonReadyWhatsAppMessage(name: string, lessonLink: string) {
  const safeName = String(name ?? "").trim() || "Aluno";
  const safeLessonLink = String(lessonLink ?? "").trim();
  return `Olá, ${safeName}! 👋

Sua aula experimental já está disponível.

Link da aula: ${safeLessonLink}

O professor Lucas Brum já está te aguardando.

Lembrando que ele aguardará por até 10 minutos. Após esse período, a aula será encerrada para dar continuidade aos demais agendamentos.`;
}

export function buildExperimentalClassAttendantStartReminderWhatsAppMessage(name: string, lessonLink: string) {
  const safeName = String(name ?? "").trim() || "Aluno";
  const safeLessonLink = String(lessonLink ?? "").trim();
  return `A aula experimental do(a) aluno(a) ${safeName} está perto de começar!

Link da aula: ${safeLessonLink}

Aguarde o(a) aluno(a) acessar a sala.`;
}

export function buildExperimentalClassPostAttendanceWhatsAppMessage(name: string) {
  const safeName = String(name ?? "").trim() || "Aluno";
  return `Show, ${safeName}! 😄

Ficamos felizes por você ter participado da aula experimental com o professor Lucas Brum.

Agora é hora de dar o próximo passo!

Vamos confirmar sua matrícula e realizar o pagamento da primeira mensalidade para iniciar suas aulas?`;
}

export const EXPERIMENTAL_CLASS_FINAL_WAIT_MESSAGE =
  `Agora é só aguardar. No dia e horário escolhidos, enviaremos o link da sua aula experimental.`;

export function buildExperimentalClassFinalChatMessages() {
  return [
    `Parabéns!`,
    `É uma satisfação receber você para a sua primeira aula em Lucas Brum Online Music USA.`,
    EXPERIMENTAL_CLASS_FINAL_WAIT_MESSAGE,
  ];
}

/** @deprecated Use buildExperimentalClassFinalChatMessages (3 mensagens separadas). Mantida apenas para compilacao temporaria, retorna string vazia. */
export function buildExperimentalClassFinalChatMessage(_name: string) {
  return ``;
}

export function buildExperimentalClassBookingChatMessages(name: string) {
  const safeName = String(name ?? "").trim() || "Aluno";
  return [
    ...buildExperimentalClassFinalChatMessages(),
  ];
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
  const bookedProfessorStartMs = Array.from(bookedProfessorStarts)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  const professorToday = localDateInTimeZone(now, ATENDIMENTO_PROFESSOR_TIME_ZONE);
  const professorMonthEnd = endOfMonthLocalDate(professorToday);
  const dates: ExperimentalClassDateOption[] = [];
  const slotsByProfessorDate = new Map<string, ExperimentalClassTimeOption[]>();
  const collectDates = (startDate: string, endDate: string) => {
    for (let currentDate = startDate; currentDate <= endDate; currentDate = addDaysToLocalDate(currentDate, 1)) {
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
        const professorEndMs = professorStartMs + EXPERIMENTAL_CLASS_DURATION_MINUTES * 60 * 1000;
        const overlapsExistingBooking = bookedProfessorStartMs.some((bookedStartMs) => {
          const bookedEndMs = bookedStartMs + EXPERIMENTAL_CLASS_DURATION_MINUTES * 60 * 1000;
          return professorStartMs < bookedEndMs && bookedStartMs < professorEndMs;
        });
        if (overlapsExistingBooking) continue;

        const leadDate = localDateInTimeZone(professorStartAt, leadTimeZone);
        daySlots.push({
          id: `${currentDate}|${professorTime}`,
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
      const dayLabel = leadDate.slice(8, 10);
      dates.push({
        id: currentDate,
        professorDate: currentDate,
        leadDate,
        dayLabel,
        displayLabel: buildDisplayDateLabel(daySlots[0]?.professorStartAt ?? middayIso, leadTimeZone),
        slotCount: daySlots.length,
      });
    }
  };

  const professorMonthStartAtDay24 = `${professorToday.slice(0, 8)}24`;
  const shouldUseNextMonth = professorToday >= professorMonthEnd;
  if (!shouldUseNextMonth) {
    const professorWindowStart = maxLocalDate(professorToday, professorMonthStartAtDay24);
    collectDates(professorWindowStart, professorMonthEnd);
  }

  if (!dates.length) {
    const nextMonthStart = startOfNextMonthLocalDate(professorToday);
    const nextMonthEnd = endOfMonthLocalDate(nextMonthStart);
    collectDates(nextMonthStart, nextMonthEnd);
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
    const normalizedDayLabel = normalizeSelectionText(option.dayLabel);
    if (normalizedInput === normalizedDayLabel) return option;
    if (normalizedInput === normalizeSelectionText(option.displayLabel)) return option;
    if (normalizedInput === normalizeSelectionText(option.leadDate)) return option;
  }

  const digitsMatches = normalizedInput.match(/\d+/g);
  if (digitsMatches && digitsMatches.length) {
    const inputDay = Number(digitsMatches[0]);
    if (Number.isFinite(inputDay) && inputDay >= 1 && inputDay <= 31) {
      const candidates = options.filter((option) => {
        const dayNum = Number(option.dayLabel);
        return Number.isFinite(dayNum) && dayNum === inputDay;
      });
      if (candidates.length === 1) return candidates[0] as ExperimentalClassDateOption;
    }
  }

  return null;
}

export function findExperimentalClassTimeOption(
  input: string,
  options: ExperimentalClassTimeOption[],
) {
  const normalizedInput = normalizeSelectionText(input);
  if (!normalizedInput) return null;
  const normalizedFlexibleInput = normalizeFlexibleTimeSelection(input);

  for (const option of options) {
    if (normalizedInput === normalizeSelectionText(option.professorTime)) return option;
    if (normalizedInput === normalizeSelectionText(option.displayLabel)) return option;
    if (
      normalizedFlexibleInput &&
      (normalizedFlexibleInput === normalizeFlexibleTimeSelection(option.professorTime) ||
        normalizedFlexibleInput === normalizeFlexibleTimeSelection(option.displayLabel))
    ) {
      return option;
    }
  }

  return null;
}
