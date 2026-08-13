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
export const RECURRING_CLASS_ATTENDANT_START_REMINDER_MINUTES = 5;

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

function normalizeFlexibleDateSelection(value: string) {
  let s = normalizeSelectionText(value);
  if (!s) return null;

  const stopWords = [
    "pode ser", "pode",
    "entendeu", "entende",
    "ok", "beleza", "ta bom", "tudo bem",
    "obrigado", "obrigada", "valeu",
    "por favor", "por gentileza", "pfv", "pf",
    "quero", "queria", "gostaria", "desejo", "preciso", "vou querer",
    "vai ser", "sera o", "sera a", "ser o", "ser a",
    "e", "ou", "mas", "porque", "pois",
    "para", "pra", "pro",
    "do", "de", "da", "dos", "das", "dum", "duma", "duns", "dumas",
    "no", "na", "nos", "nas", "num", "numa", "nuns", "numas",
    "em",
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    "meu", "minha", "meus", "minhas", "teu", "tua", "teus", "tuas", "seu", "sua", "seus", "suas",
    "esse", "essa", "esses", "essas", "este", "esta", "estes", "estas", "aquele", "aquela", "aqueles", "aquelas", "isso", "isto", "aquilo",
    "dia", "dias", "data", "datas",
    "agendar", "marcar", "agendamento", "marcacao",
    "escolher", "escolho", "selecionar", "seleciono", "optar", "opto",
    "hoje", "amanha", "depois de amanha",
    "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo", "feira",
    "mes",
  ];

  const wordsToRegex = new RegExp(
    stopWords
      .map((w) => {
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const normalized = escaped
          .replace(/a/g, "[aáàâã]")
          .replace(/e/g, "[eéèê]")
          .replace(/i/g, "[iíìî]")
          .replace(/o/g, "[oóòôõ]")
          .replace(/u/g, "[uúùû]")
          .replace(/c/g, "[cç]");
        return `(?<![\\p{L}\\d])${normalized}(?![\\p{L}\\d])`;
      })
      .join("|"),
    "giu",
  );

  s = s.replace(wordsToRegex, " ").replace(/\s+/g, " ").trim();

  if (!s) return null;

  const firstDigits = s.match(/\d+/);
  if (!firstDigits) {
    return s;
  }
  const dayNum = Number(firstDigits[0]);
  if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) {
    return s;
  }
  return String(dayNum);
}

function normalizeFlexibleTimeSelection(value: string) {
  let s = normalizeSelectionText(value);
  if (!s) return null;

  s = s
    .replace(/(?:^|\s)(as?|as 0?|a 0?|as horas?|a horas?)(?=\s|$)/g, " ")
    .replace(/\b(as?\s+)?(\d{1,2}(?::\d{1,2}|h\d{0,2}))\s*(horas?|hrs?|h?)\b/g, (_m, _a, core) => ` ${core} `)
    .replace(/\bda (manha|tarde|noite|madrugada|meio dia|meio-dia)\b/g, (_m, period: string) => {
      const periodClean = period.replace(/\s+/g, "").replace(/\-/g, "");
      return ` ${periodClean} `;
    })
    .replace(/\b(d[eao]|no|na|pela|pelo|pro|pra|esse|essa|este|esta|horario|horario|horas|hora|hrs?|minutos?|mins?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const amPmMatch = s.match(/(\d{1,2})(?::(\d{1,2}))?\s*(?:h|h)?\s*(?:\s?[ap]\.?m\.?| [ap])/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = amPmMatch[2] ? Number(amPmMatch[2]) : 0;
    const suffix = s.toLowerCase().includes("p") ? "PM" : "AM";
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (suffix === "PM" && hour < 12) hour += 12;
    if (suffix === "AM" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const periodMatch = s.match(/manha|tarde|noite|madrugada|meiodia/i);
  const hasPeriodWord = Boolean(periodMatch);
  const periodWord = periodMatch ? periodMatch[0].toLowerCase() : "";

  function applyPeriodDefault(hour: number, minute: number): { hour: number; minute: number } | null {
    if (!hasPeriodWord) return { hour, minute };
    const h = Number(hour);
    const m = Number(minute);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    let adjusted = h;
    if (periodWord === "manha" || periodWord === "madrugada") {
      if (adjusted >= 12) adjusted = adjusted % 12;
      if (adjusted === 0 && periodWord === "manha") adjusted = 0;
    } else if (periodWord === "tarde" || periodWord === "noite") {
      if (adjusted < 12) adjusted += 12;
      if (adjusted === 12 && periodWord === "tarde") adjusted = 12;
      if (adjusted === 24) adjusted = 0;
    } else if (periodWord === "meiodia") {
      if (adjusted === 12 || adjusted === 0) adjusted = 12;
    }
    if (adjusted < 0 || adjusted > 23 || m < 0 || m > 59) return null;
    return { hour: adjusted, minute: m };
  }

  const compact = s
    .replace(/\s+/g, "")
    .replace(/horas?/g, "h")
    .replace(/hrs?/g, "h")
    .replace(/minutos?/g, "min")
    .replace(/mins?/g, "min")
    .replace(/manha|tarde|noite|madrugada|meiodia/g, "");

  const colonMatch = compact.match(/^(\d{1,2}):(\d{1,2})h?$/);
  if (colonMatch) {
    const hour = Number(colonMatch[1]);
    const minute = Number(colonMatch[2]);
    const final = hasPeriodWord ? applyPeriodDefault(hour, minute) : { hour, minute };
    if (!final || final.hour < 0 || final.hour > 23 || final.minute < 0 || final.minute > 59) return null;
    return `${String(final.hour).padStart(2, "0")}:${String(final.minute).padStart(2, "0")}`;
  }

  const hourMinuteMatch = compact.match(/^(\d{1,2})h(\d{1,2})(?:min)?$/);
  if (hourMinuteMatch) {
    const hour = Number(hourMinuteMatch[1]);
    const minute = Number(hourMinuteMatch[2]);
    const final = hasPeriodWord ? applyPeriodDefault(hour, minute) : { hour, minute };
    if (!final || final.hour < 0 || final.hour > 23 || final.minute < 0 || final.minute > 59) return null;
    return `${String(final.hour).padStart(2, "0")}:${String(final.minute).padStart(2, "0")}`;
  }

  const hourOnlyMatch = compact.match(/^(\d{1,2})h?$/);
  if (hourOnlyMatch) {
    const hour = Number(hourOnlyMatch[1]);
    const final = hasPeriodWord ? applyPeriodDefault(hour, 0) : { hour, minute: 0 };
    if (!final || final.hour < 0 || final.hour > 23) return null;
    return `${String(final.hour).padStart(2, "0")}:00`;
  }

  if (hasPeriodWord) {
    const periodDigitsMatch = s.match(/(\d{1,2})(?:\s*[:h]\s*(\d{1,2}))?/);
    if (periodDigitsMatch) {
      const hour = Number(periodDigitsMatch[1]);
      const minute = periodDigitsMatch[2] ? Number(periodDigitsMatch[2]) : 0;
      const final = applyPeriodDefault(hour, minute);
      if (final && final.hour >= 0 && final.hour <= 23 && final.minute >= 0 && final.minute <= 59) {
        return `${String(final.hour).padStart(2, "0")}:${String(final.minute).padStart(2, "0")}`;
      }
    }
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
    return ["No momento, não há dias disponíveis para aula experimental até o fim deste mês."];
  }

  const labels = options.map((option) => option.dayLabel);
  return [
    `Os dias disponíveis são:\n\n${joinWithFinalConjunction(labels)}.`,
    "Responda apenas com o dia desejado.",
  ];
}

export function buildExperimentalClassTimesMessages(params: {
  dayLabel: string;
  options: ExperimentalClassTimeOption[];
}) {
  if (!params.options.length) {
    return [`Não há horários livres para o dia ${params.dayLabel}. Escolha outro dia disponível.`];
  }

  const labels = params.options.map((option) => option.displayLabel);

  return [
    `Perfeito! E os horários disponíveis são:\n\n${joinWithFinalConjunction(labels)}.`,
    "Responda apenas com o horário desejado.",
  ];
}


export function buildExperimentalClassStudentWhatsAppMessages(name: string) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  return [
    `Show, ${safeFirst}! Vai ser um prazer conhecer você na aula. 😊`,
    `Agora é só aguardar. No dia agendado, vamos enviar o link da sua aula por aqui.`,
  ];
}

/** @deprecated Use buildExperimentalClassStudentWhatsAppMessages (mensagens separadas) — a mensagem unica concatenada NAO deve mais ser enviada. Mantida apenas para compilacao temporaria, retorna string vazia. */
export function buildExperimentalClassStudentWhatsAppMessage(_name: string) {
  return ``;
}

export function buildExperimentalClassAttendantWhatsAppMessage(name: string) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "o interessado";
  return `Você recebeu um novo agendamento de aula experimental para ${safeFirst}.

Acesse o link abaixo e adicione o link da aula ao interessado.

${EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK}`;
}

export function buildExperimentalClassStudentLessonReadyWhatsAppMessage(name: string, lessonLink: string) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  return `${safeFirst}, sua aula experimental já está disponível.

Link da aula: ${safeLessonLink}

O professor Lucas Brum já está te aguardando.

Lembrando que ele aguardará por até 10 minutos. Após esse período, a aula será encerrada para dar continuidade aos demais agendamentos.`;
}

export function buildExperimentalClassAttendantStartReminderWhatsAppMessage(name: string, lessonLink: string) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "o interessado";
  return `A aula experimental de ${safeFirst} está perto de começar!

Link da aula: ${safeLessonLink}`;
}

export function buildRecurringClassStudentLessonReadyWhatsAppMessage(name: string | null | undefined, lessonLink: string | null | undefined) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno";
  return `${safeFirst}, sua aula já está disponível.

Link da aula: ${safeLessonLink}

O professor Lucas Brum já está te aguardando.`;
}

export function buildRecurringClassAttendantStartReminderWhatsAppMessage(name: string | null | undefined, weekdayLabel: string | null | undefined, lessonLink: string | null | undefined) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "o aluno";
  const safeWeekday = String(weekdayLabel ?? "semanais").trim() || "semanais";
  return `A aula recorrente de ${safeFirst} (${safeWeekday}) está perto de começar!

Link da aula: ${safeLessonLink}`;
}

export function buildRecurringClassPostEnrollmentAttendantNotification(name: string | null | undefined, weekdayLabel: string | null | undefined, timeLabel: string | null | undefined) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Novo aluno";
  const safeWeekday = String(weekdayLabel ?? "").trim() || "horário fixo";
  const safeTime = String(timeLabel ?? "").trim() || "a confirmar";
  return `Novo aluno matriculado! 🎉

Aluno: ${safeFirst}
Dia: ${safeWeekday}
Horário: ${safeTime}

Acesse o painel para adicionar o link da aula recorrente:
${EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK}`;
}

export function buildExperimentalClassPostAttendanceWhatsAppMessages(name?: string | null) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "";
  const line1 = safeFirst
    ? `${safeFirst}, ficamos felizes pela sua participação na aula experimental!`
    : "Ficamos felizes pela sua participação na aula experimental!";
  return [
    [
      line1,
      "Agora é hora do próximo passo.",
      "Vamos confirmar sua matrícula e iniciar suas aulas?",
      "Responda com sim ou não.",
    ].join("\n\n"),
  ];
}

export function buildExperimentalClassNoShowRepescagemWhatsAppMessages(name?: string | null) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "";
  const line1 = safeFirst
    ? `${safeFirst}, notamos que você não compareceu à aula experimental.`
    : "Notamos que você não compareceu à aula experimental.";
  return [
    line1,
    `Mas não se preocupe, novas oportunidades estarão disponíveis.`,
    `Em breve nossa equipe entrará em contato.`,
  ];
}

export const EXPERIMENTAL_CLASS_FINAL_WAIT_MESSAGE =
  `Agora é só aguardar. No dia agendado, vamos enviar o link da sua aula por aqui.`;

export const EXPERIMENTAL_CLASS_FINAL_THIRD_MESSAGE =
  `Agora é só aguardar. No dia agendado, vamos enviar o link da sua aula por aqui.`;

export const EXPERIMENTAL_CLASS_POST_NOTIFICATION_WAIT_MESSAGE =
  `Por favor, aguarde. Em breve poderemos seguir para a próxima etapa.`;

export function buildExperimentalClassFinalChatMessages(name: string) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  return [
    `Show, ${safeFirst}! Vai ser um prazer conhecer você na aula. 😊`,
    `Agora é só aguardar. No dia agendado, vamos enviar o link da sua aula por aqui.`,
  ];
}

/** @deprecated Use buildExperimentalClassFinalChatMessages (mensagens separadas). Mantida apenas para compilacao temporaria, retorna string vazia. */
export function buildExperimentalClassFinalChatMessage(_name: string) {
  return ``;
}

export function buildExperimentalClassBookingChatMessages(name: string) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno";
  return [
    ...buildExperimentalClassFinalChatMessages(safeFirst),
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

  const shouldUseNextMonth = professorToday > professorMonthEnd;
  if (!shouldUseNextMonth) {
    collectDates(professorToday, professorMonthEnd);
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
  const normalizedFlexibleInput = normalizeFlexibleDateSelection(input);

  for (const option of options) {
    const normalizedDayLabel = normalizeSelectionText(option.dayLabel);
    if (normalizedInput === normalizedDayLabel) return option;
    if (normalizedInput === normalizeSelectionText(option.displayLabel)) return option;
    if (normalizedInput === normalizeSelectionText(option.leadDate)) return option;

    const dayNumFromLabel = Number(normalizedDayLabel);
    if (normalizedFlexibleInput && Number.isFinite(dayNumFromLabel) && dayNumFromLabel >= 1 && dayNumFromLabel <= 31) {
      if (String(dayNumFromLabel) === normalizedFlexibleInput) return option;
    }

    if (normalizedFlexibleInput && (normalizedFlexibleInput === normalizeSelectionText(option.displayLabel) || normalizedFlexibleInput === normalizeSelectionText(option.leadDate))) {
      return option;
    }
  }

  function extractSingleDayFromAnyText(raw: string): number | null {
    const digitsMatches = String(raw ?? "").match(/\d+/g);
    if (!digitsMatches || !digitsMatches.length) return null;
    for (const dig of digitsMatches) {
      const n = Number(dig);
      if (Number.isFinite(n) && n >= 1 && n <= 31) {
        const count = options.filter((opt) => Number(opt.dayLabel) === n).length;
        if (count === 1) return n;
      }
    }
    return null;
  }

  if (normalizedFlexibleInput && /^\d+$/.test(String(normalizedFlexibleInput))) {
    const fallbackDay = Number(normalizedFlexibleInput);
    const candidates = options.filter((option) => Number(option.dayLabel) === fallbackDay);
    if (candidates.length === 1) return candidates[0] as ExperimentalClassDateOption;
  }

  const anyExtractedDay = extractSingleDayFromAnyText(input);
  if (anyExtractedDay !== null) {
    const match = options.find((option) => Number(option.dayLabel) === anyExtractedDay);
    if (match) return match as ExperimentalClassDateOption;
  }

  const hasAnyLetter = /[a-zA-Záàâãéèêíìîóòôõúùûçüñ]/.test(String(input ?? "").normalize("NFD"));
  const hasDateSeparatorsOnlyNoLetters = /^[0-9\s./\-]+$/.test(String(input ?? "").trim());
  const seemsLikePureNumericDate = !hasAnyLetter && hasDateSeparatorsOnlyNoLetters;
  const relevantDateKeywords = [
    /(^|[\s.!,?:;\-])((segunda|terca|quarta|quinta|sexta|sabado|domingo)|(seg|ter|qua|qui|sex|sab|dom)|(feira|dia|dias|data|datas|hoje|amanha|depois de amanha|proximo|proxima|mes|agosto|janeiro|fevereiro|marco|abril|maio|junho|julho|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|as|a|o|os|as|pra|pro|para|no|na|nos|nas|de|do|da|dos|das|agendar|marcar|agendamento|marcacao|escolher|selecionar|optar|quero|queria|gostaria|desejo|preciso|obrigado|obrigada|valeu|beleza|entendeu|entende|pode|por favor|por gentileza))([\s.!,?:;\-]|$)/,
    /\bd\s*\+\s*\d+\b/,
    /(^|[\s.!,?:;\-])(pode(?:\s+ser)?|entendeu|entende|quero|queria|gostaria|desejo|preciso|vou querer|vai ser|sera(?:\s+[oa])?|por favor|pfv|pf)([\s.!,?:;\-]|$)/,
  ];
  const hasRelevantDateText = hasAnyLetter && relevantDateKeywords.some((rx) => rx.test(normalizedInput));
  const hasFlexibleExtractedDay = Boolean(normalizedFlexibleInput) && /^\d+$/.test(String(normalizedFlexibleInput));
  function cleanTextLooksReasonable(raw: string): boolean {
    const t = String(raw ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-záàâãéèêíìîóòôõúùûç]/g, "");
    if (t.length < 3) return true;
    const vowels = (t.match(/[aeiou]/g) || []).length;
    const ratio = vowels / t.length;
    if (ratio < 0.2) return false;
    const unique = new Set(Array.from(t)).size;
    if (unique / t.length < 0.55) return false;
    return true;
  }
  const canFallbackToDigitsOnly =
    seemsLikePureNumericDate ||
    !hasAnyLetter ||
    hasFlexibleExtractedDay ||
    hasRelevantDateText;

  if (!canFallbackToDigitsOnly) return null;

  if (hasFlexibleExtractedDay && normalizedFlexibleInput) {
    const fallbackDay = Number(normalizedFlexibleInput);
    if (Number.isFinite(fallbackDay) && fallbackDay >= 1 && fallbackDay <= 31) {
      const candidates = options.filter((option) => {
        const dayNum = Number(option.dayLabel);
        return Number.isFinite(dayNum) && dayNum === fallbackDay;
      });
      if (candidates.length === 1) return candidates[0] as ExperimentalClassDateOption;
    }
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
    if (normalizedInput === normalizeSelectionText(option.displayLabel)) return option;
    if (normalizedInput === normalizeSelectionText(option.leadTime)) return option;
    if (
      normalizedFlexibleInput &&
      (normalizedFlexibleInput === normalizeFlexibleTimeSelection(option.displayLabel) ||
        normalizedFlexibleInput === normalizeFlexibleTimeSelection(option.leadTime))
    ) {
      return option;
    }
  }

  const hasAnyLetter = /[a-zA-Záàâãéèêíìîóòôõúùûçüñ]/.test(String(input ?? "").normalize("NFD"));
  const hasTimeSeparatorsOnlyNoLetters = /^[0-9\s.:\-hH]+$/.test(String(input ?? "").trim());
  const relevantTimeKeywords = [
    /(^|[\s.!,?:;\-])((horas|hora|hrs|hr|minutos|minuto|mins|min|meio dia|meio-dia|manha|tarde|noite|almoco|jantar|agora|as 0?|a 0?|as|a|am|pm|a\.m|p\.m|periodo|da manha|da tarde|da noite|de manha|de tarde|de noite|madrugada)|([0-9]{1,2}h([0-9]{1,2}min?)?))([\s.!,?:;\-]|$)/,
  ];
  const hasRelevantTimeText = hasAnyLetter && relevantTimeKeywords.some((rx) => rx.test(normalizedInput));
  function cleanTextLooksReasonable(raw: string): boolean {
    const t = String(raw ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-záàâãéèêíìîóòôõúùûç]/g, "");
    if (t.length < 3) return true;
    const vowels = (t.match(/[aeiou]/g) || []).length;
    const ratio = vowels / t.length;
    if (ratio < 0.2) return false;
    const unique = new Set(Array.from(t)).size;
    if (unique / t.length < 0.55) return false;
    return true;
  }
  const canUseNumericFallback =
    !hasAnyLetter ||
    hasTimeSeparatorsOnlyNoLetters ||
    Boolean(normalizedFlexibleInput) ||
    (hasRelevantTimeText && cleanTextLooksReasonable(String(input ?? "")));

  if (!canUseNumericFallback) return null;

  if (normalizedFlexibleInput) {
    const wanted = normalizedFlexibleInput;
    for (const option of options) {
      if (normalizeSelectionText(option.displayLabel) === wanted) return option;
      if (normalizeSelectionText(option.leadTime) === wanted) return option;
    }
  }

  const digitsMatches = normalizedInput.match(/\d+/g);
  if (digitsMatches && digitsMatches.length) {
    const inputHour = Number(digitsMatches[0]);
    const inputMinute = digitsMatches[1] ? Number(digitsMatches[1]) : 0;
    if (Number.isFinite(inputHour) && inputHour >= 0 && inputHour <= 23 && Number.isFinite(inputMinute) && inputMinute >= 0 && inputMinute <= 59) {
      const wanted = `${String(inputHour).padStart(2, "0")}:${String(inputMinute).padStart(2, "0")}`;
      for (const option of options) {
        if (normalizeSelectionText(option.displayLabel) === wanted) return option;
        if (normalizeSelectionText(option.leadTime) === wanted) return option;
      }
    }
  }

  if (digitsMatches && digitsMatches.length === 1) {
    const pureHour = Number(digitsMatches[0]);
    if (Number.isFinite(pureHour) && pureHour >= 0 && pureHour <= 23) {
      for (const hPad of [String(pureHour).padStart(2, "0"), String(pureHour)]) {
        const wantedExactZero = `${hPad}:00`;
        const wantedNoZero = `${hPad}:00`;
        for (const option of options) {
          if (normalizeSelectionText(option.displayLabel) === wantedExactZero) return option;
          if (normalizeSelectionText(option.leadTime) === wantedExactZero) return option;
          if (normalizeSelectionText(option.displayLabel) === wantedNoZero) return option;
          if (normalizeSelectionText(option.leadTime) === wantedNoZero) return option;
        }
      }
      const candidates = options.filter((o) => {
        const raw = normalizeSelectionText(o.displayLabel) || normalizeSelectionText(o.leadTime);
        if (!raw) return false;
        const hMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (!hMatch) return false;
        const hh = Number(hMatch[1]);
        return hh === pureHour;
      });
      if (candidates.length === 1) return candidates[0] as ExperimentalClassTimeOption;
    }
  }

  return null;
}

export type RecurringWeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export const RECURRING_WEEKDAY_LABELS_PT_BR: Record<RecurringWeekdayKey, string> = {
  mon: "Segunda-feira",
  tue: "Terça-feira",
  wed: "Quarta-feira",
  thu: "Quinta-feira",
  fri: "Sexta-feira",
  sat: "Sábado",
};

export const RECURRING_WEEKDAY_SHORT_LABELS: Record<RecurringWeekdayKey, string> = {
  mon: "Seg",
  tue: "Ter",
  wed: "Qua",
  thu: "Qui",
  fri: "Sex",
  sat: "Sáb",
};

export type RecurringWeekdayOption = {
  id: RecurringWeekdayKey;
  weekday: RecurringWeekdayKey;
  label: string;
  shortLabel: string;
  displayLabel: string;
  slotCount: number;
};

export type RecurringWeekdayTimeOption = {
  id: string;
  weekday: RecurringWeekdayKey;
  professorTime: string;
  leadTime: string;
  displayLabel: string;
};

function firstOnlyNameForRecurring(full: string | null | undefined): string {
  const safe = String(full ?? "").trim();
  return safe.split(/\s+/)[0] || "";
}

export function buildRecurringPlanIntroMessages(name: string | null | undefined): string[] {
  const safeFirst = firstOnlyNameForRecurring(name) || "Aluno(a)";
  const msg1 = `${safeFirst}, o plano disponível é:`;
  const msg2 = [
    "Modelo Individual",
    "• 1 aula online ao vivo por semana",
    "• Ensino personalizado",
    "• Acompanhamento contínuo",
  ].join("\n");
  return [msg1, msg2];
}

export function buildRecurringSchedulePromptMessages(): string[] {
  return [
    "Antes de prosseguirmos com o contrato e o pagamento, qual dia e horário da semana você prefere reservar para suas aulas?",
  ];
}

export function buildRecurringCalendarDatesMessages(options: ExperimentalClassDateOption[]): string[] {
  if (!options.length) {
    return ["No momento, não há dias e horários recorrentes disponíveis até o fim deste mês. Nossa equipe entrará em contato para ajustar."];
  }
  const labels = options.map((option) => option.dayLabel);
  return [
    `Os dias disponíveis são:\n\n${joinWithFinalConjunction(labels)}.`,
    "Responda apenas com o dia desejado.",
  ];
}

export function buildRecurringWeekdayTimesMessages(params: {
  weekdayLabel: string;
  options: RecurringWeekdayTimeOption[];
}): string[] {
  if (!params.options.length) {
    return [`No momento, não há horários disponíveis para ${params.weekdayLabel}.`];
  }
  const lines = params.options
    .map((opt) => opt.displayLabel)
    .map((line, idx) => `${idx + 1}. ${line}`);
  return [`Horários disponíveis para ${params.weekdayLabel}:`, ...lines];
}

export function listRecurringWeekdayAvailability(params: {
  now?: Date;
  leadTimeZone?: string | null;
  bookedProfessorStartAts?: string[];
  lookAheadWeeks?: number;
}) {
  const now = params.now ?? new Date();
  const lookAheadWeeks = Number.isFinite(Number(params.lookAheadWeeks))
    ? Math.max(1, Number(params.lookAheadWeeks))
    : 4;
  const leadTimeZone = String(params.leadTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;

  const bookedProfessorStarts = (params.bookedProfessorStartAts ?? [])
    .map((value) => new Date(String(value ?? "")).toISOString())
    .filter(Boolean);
  const booked = bookedProfessorStarts
    .map((iso) => {
      const d = new Date(iso);
      const ms = d.getTime();
      if (!Number.isFinite(ms)) return null;
      const weekday = weekdayInTimeZone(d, ATENDIMENTO_PROFESSOR_TIME_ZONE).toLowerCase();
      const hh = new Intl.DateTimeFormat("en-GB", {
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(d);
      const hour = hh.find((p) => p.type === "hour")?.value ?? "";
      const minute = hh.find((p) => p.type === "minute")?.value ?? "";
      const timeKey = `${hour}:${minute}`;
      return { weekday, timeKey, ms };
    })
    .filter((x): x is { weekday: string; timeKey: string; ms: number } => Boolean(x));

  const blockedCombos = new Set<string>();
  for (const b of booked) {
    blockedCombos.add(`${b.weekday}|${b.timeKey}`);
    for (let w = 1; w < lookAheadWeeks; w++) {
      const futureMs = b.ms + w * 7 * 24 * 60 * 60 * 1000;
      if (futureMs > now.getTime() - 24 * 60 * 60 * 1000) {
        const future = new Date(futureMs);
        const weekdayF = weekdayInTimeZone(future, ATENDIMENTO_PROFESSOR_TIME_ZONE).toLowerCase();
        const hh = new Intl.DateTimeFormat("en-GB", {
          timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(future);
        const hourF = hh.find((p) => p.type === "hour")?.value ?? "";
        const minuteF = hh.find((p) => p.type === "minute")?.value ?? "";
        const timeKeyF = `${hourF}:${minuteF}`;
        blockedCombos.add(`${weekdayF}|${timeKeyF}`);
      }
    }
  }

  const weekdayOrder: RecurringWeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  const optionsByWeekday = new Map<RecurringWeekdayKey, RecurringWeekdayTimeOption[]>();

  for (const weekday of weekdayOrder) {
    const slots: RecurringWeekdayTimeOption[] = [];
    for (const professorTime of EXPERIMENTAL_CLASS_SLOT_TIMES) {
      const comboKey = `${weekday}|${professorTime}`;
      if (blockedCombos.has(comboKey)) continue;

      const nextMonday = (() => {
        const base = new Date(now);
        const dow = base.getUTCDay();
        const diff = (dow + 6) % 7;
        const d = new Date(base.getTime() - diff * 24 * 60 * 60 * 1000);
        return d;
      })();
      const weekdayOffset = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5 }[weekday];
      const sampleDate = new Date(nextMonday.getTime() + weekdayOffset * 24 * 60 * 60 * 1000);
      const localDate = localDateInTimeZone(sampleDate, ATENDIMENTO_PROFESSOR_TIME_ZONE);
      const sampleStartAt = zonedDateTimeToUtcIso({
        date: localDate,
        time: professorTime,
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      });
      slots.push({
        id: `${weekday}|${professorTime}`,
        weekday,
        professorTime,
        leadTime: formatTimeInTimeZone(sampleStartAt, leadTimeZone),
        displayLabel: formatTimeInTimeZone(sampleStartAt, leadTimeZone),
      });
    }
    if (slots.length > 0) {
      optionsByWeekday.set(weekday, slots);
    }
  }

  const dates: RecurringWeekdayOption[] = weekdayOrder
    .filter((wd) => (optionsByWeekday.get(wd) ?? []).length > 0)
    .map((wd) => ({
      id: wd,
      weekday: wd,
      label: RECURRING_WEEKDAY_LABELS_PT_BR[wd],
      shortLabel: RECURRING_WEEKDAY_SHORT_LABELS[wd],
      displayLabel: RECURRING_WEEKDAY_LABELS_PT_BR[wd],
      slotCount: (optionsByWeekday.get(wd) ?? []).length,
    }));

  return { dates, slotsByWeekday: optionsByWeekday };
}

export function findRecurringWeekdayOption(input: string, options: RecurringWeekdayOption[]): RecurringWeekdayOption | null {
  const normalized = normalizeSelectionText(input);
  if (!normalized) return null;
  const digitsOnly = (normalized.match(/\d+/) || [])[0] ?? "";

  for (const opt of options) {
    if (normalized === normalizeSelectionText(opt.displayLabel)) return opt;
    if (normalized === normalizeSelectionText(opt.label)) return opt;
    if (normalized === normalizeSelectionText(opt.shortLabel)) return opt;
    if (normalized === normalizeSelectionText(opt.weekday)) return opt;
  }

  if (digitsOnly) {
    const idx = Number(digitsOnly);
    if (Number.isFinite(idx) && idx >= 1 && idx <= options.length) {
      return options[idx - 1] ?? null;
    }
  }

  const keywordMap: Array<[RegExp, RecurringWeekdayKey]> = [
    [/(segunda|^seg)/i, "mon"],
    [/(terca|terça|^ter)/i, "tue"],
    [/(quarta|^qua)/i, "wed"],
    [/(quinta|^qui)/i, "thu"],
    [/(sexta|^sex)/i, "fri"],
    [/(sabado|sábado|^sab|^sáb)/i, "sat"],
  ];
  for (const [regex, key] of keywordMap) {
    if (regex.test(String(input ?? ""))) {
      return options.find((o) => o.weekday === key) ?? null;
    }
  }
  return null;
}

export function findRecurringWeekdayTimeOption(input: string, options: RecurringWeekdayTimeOption[]): RecurringWeekdayTimeOption | null {
  const normalized = normalizeSelectionText(input);
  if (!normalized) return null;
  for (const opt of options) {
    if (normalized === normalizeSelectionText(opt.displayLabel)) return opt;
    if (normalized === normalizeSelectionText(opt.leadTime)) return opt;
    if (normalized === normalizeSelectionText(opt.professorTime)) return opt;
  }
  const digitsMatches = normalized.match(/\d+/g);
  if (digitsMatches && digitsMatches.length) {
    const inputHour = Number(digitsMatches[0]);
    const inputMinute = digitsMatches[1] ? Number(digitsMatches[1]) : 0;
    if (Number.isFinite(inputHour) && inputHour >= 0 && inputHour <= 23 && Number.isFinite(inputMinute) && inputMinute >= 0 && inputMinute <= 59) {
      const wanted = `${String(inputHour).padStart(2, "0")}:${String(inputMinute).padStart(2, "0")}`;
      for (const option of options) {
        if (normalizeSelectionText(option.displayLabel) === wanted) return option;
        if (normalizeSelectionText(option.leadTime) === wanted) return option;
      }
    }
    const idx = Number(digitsMatches[0]);
    if (Number.isFinite(idx) && idx >= 1 && idx <= options.length) {
      return options[idx - 1] ?? null;
    }
  }
  return null;
}

export function calculateNextRecurringOccurrence(params: {
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  professorTimeHHMM: string;
  professorTimeZone?: string | null;
  leadTimeZone?: string | null;
  fromDate?: Date;
}) {
  const wantWeekday = String(params.weekday ?? "").trim().toLowerCase();
  if (!wantWeekday) return null;
  const time = String(params.professorTimeHHMM ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const profTz = String(params.professorTimeZone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const leadTz = String(params.leadTimeZone ?? "").trim() || profTz;
  const now = params.fromDate ?? new Date();

  const todayLocal = localDateInTimeZone(now, profTz);
  for (let dayOffset = 0; dayOffset < 40; dayOffset++) {
    const candidateLocal = addDaysToLocalDate(todayLocal, dayOffset);
    const noonUtc = zonedDateTimeToUtcIso({
      date: candidateLocal,
      time: "12:00",
      timeZone: profTz,
    });
    const candidateWeekday = weekdayInTimeZone(noonUtc, profTz).toLowerCase();
    if (candidateWeekday !== wantWeekday) continue;

    const startUtcIso = zonedDateTimeToUtcIso({
      date: candidateLocal,
      time,
      timeZone: profTz,
    });
    const startUtcMs = new Date(startUtcIso).getTime();
    if (!Number.isFinite(startUtcMs)) continue;
    if (dayOffset === 0 && startUtcMs <= now.getTime()) continue;

    const ptbrLabels: Record<string, string> = {
      mon: "Segunda-feira",
      tue: "Terça-feira",
      wed: "Quarta-feira",
      thu: "Quinta-feira",
      fri: "Sexta-feira",
      sat: "Sábado",
      sun: "Domingo",
    };

    return {
      professorDate: candidateLocal,
      professorTime: time,
      professorTimeZone: profTz,
      professorStartAt: startUtcIso,
      leadDate: localDateInTimeZone(new Date(startUtcMs), leadTz),
      leadTime: formatTimeInTimeZone(startUtcIso, leadTz),
      leadStartAt: startUtcIso,
      leadTimeZone: leadTz,
      weekdayLabel:
        (RECURRING_WEEKDAY_LABELS_PT_BR as Record<string, string>)?.[wantWeekday] ??
        ptbrLabels[wantWeekday] ??
        wantWeekday.toUpperCase(),
    };
  }
  return null;
}
