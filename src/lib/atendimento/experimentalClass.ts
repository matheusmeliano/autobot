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

export const PROFESSOR_SATURDAY_CUTOFF_TIME = "12:00";
function professorTimeIsAllowed({ weekdayShort, professorTimeHHMM }: { weekdayShort: string; professorTimeHHMM: string }): boolean {
  if (weekdayShort !== "sat") return true;
  const cutoff = PROFESSOR_SATURDAY_CUTOFF_TIME.split(":").map(Number);
  const slot = String(professorTimeHHMM ?? "").split(":").map(Number);
  if (cutoff.length !== 2 || slot.length !== 2) return true;
  const [cutHH, cutMM] = cutoff;
  const [slotHH, slotMM] = slot;
  if (!Number.isFinite(cutHH) || !Number.isFinite(cutMM) || !Number.isFinite(slotHH) || !Number.isFinite(slotMM)) return true;
  const slotTotal = slotHH * 60 + slotMM;
  const cutTotal = cutHH * 60 + cutMM;
  return slotTotal <= cutTotal;
}

export const EXPERIMENTAL_CLASS_DURATION_MINUTES = 90;
export const EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE = "+55 65 9807-9407";
export const EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE = "+55 65 9949-5594";
export const EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST = [
  { name: "Lucas Brum", phone: "+55 65 9807-9407", short: "9807-9407" },
  { name: "Nathan Camargo", phone: "+55 65 9952-0166", short: "9952-0166" },
] as const;

export function getExperimentalClassInternalStaffPhoneNumbers(): string[] {
  return [
    EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
    EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
    ...EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST.map((p) => p.phone),
  ];
}

export function resolveExperimentalClassAssignedProfessorPhone(input: {
  bookingAssignedPhone?: string | null;
  bookingAssignedName?: string | null;
  flatAssignedPhone?: string | null;
  flatAssignedName?: string | null;
}): { name: string; phone: string } | null {
  const candidates: Array<{ name?: string | null; phone?: string | null }> = [
    { name: input.bookingAssignedName, phone: input.bookingAssignedPhone },
    { name: input.flatAssignedName, phone: input.flatAssignedPhone },
  ];
  for (const c of candidates) {
    const name = String(c.name ?? "").trim();
    const phone = String(c.phone ?? "").trim();
    if (!name || !phone) continue;
    const match = EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST.find(
      (p) => String(p.phone) === phone && String(p.name) === name,
    );
    if (match) return { name: match.name, phone: match.phone };
  }
  for (const c of candidates) {
    const phone = String(c.phone ?? "").trim();
    if (!phone) continue;
    const match = EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST.find((p) => String(p.phone) === phone);
    if (match) return { name: match.name, phone: match.phone };
  }
  return null;
}

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
  | "completed"
  | "skipped";

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
  hasRecurringClassScheduled?: boolean;
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
  if (params.hasSchedulingProgress || params.hasLead) {
    if (params.hasRecurringClassScheduled) return "skipped" as const;
    return "incomplete" as const;
  }
  return null;
}

export function experimentalClassBookingDisplayStatusLabel(status: ExperimentalClassBookingDisplayStatus | null | undefined) {
  if (status === "incomplete") return "Incompleto";
  if (status === "scheduled") return "Agendado";
  if (status === "cancelled") return "Cancelado";
  if (status === "in_progress") return "Em andamento";
  if (status === "no_show") return "Não compareceu";
  if (status === "completed") return "Concluído";
  if (status === "skipped") return "Etapa pulada";
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

Ana já está adicionando o link da aula ao interessado.`;
}

export function buildExperimentalClassRegisteredAttendantWhatsAppMessage(name: string) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "o interessado";
  return `Novo agendamento de aula experimental confirmado para ${safeFirst}.

Acesse o link abaixo e adicione o link da aula ao interessado.

${EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK}`;
}

export function buildExperimentalClassStudentLessonReadyWhatsAppMessage(name: string, lessonLink: string) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  return `${safeFirst}, sua aula experimental já está disponível.

Link da aula: ${safeLessonLink}

O professor já está te aguardando.

Lembrando que ele aguardará por até 10 minutos. Após esse período, a aula será encerrada para dar continuidade aos demais agendamentos.`;
}

export function buildExperimentalClassAttendantStartReminderWhatsAppMessage(name: string, lessonLink: string) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  return `Aviso: aula experimental de ${safeFirst} inicia em 5 minutos.

Link da aula: ${safeLessonLink}

Entre na sala e aguarde a entrada do aluno.`;
}

export function buildExperimentalClassRegisteredAttendantStartReminderWhatsAppMessage(name: string, lessonLink: string) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  return `Aviso: aula experimental de ${safeFirst} inicia em 5 minutos.

Link da aula: ${safeLessonLink}

Acompanhe o atendimento e certifique-se de que tudo ocorra bem.`;
}

export function buildRecurringClassStudentLessonReadyWhatsAppMessage(name: string | null | undefined, lessonLink: string | null | undefined) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno";
  return `${safeFirst}, sua aula recorrente já está disponível.

Link da aula: ${safeLessonLink}

O professor já está te aguardando.

Lembrando que ele aguardará por até 10 minutos. Após esse período, a aula será encerrada para dar continuidade aos demais agendamentos.`;
}

export function buildRecurringClassAttendantStartReminderWhatsAppMessage(name: string | null | undefined, weekdayLabel: string | null | undefined, lessonLink: string | null | undefined) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "o aluno";
  const safeWeekday = String(weekdayLabel ?? "").trim() || "hoje";
  return `Aviso: aula recorrente de ${safeFirst} (${safeWeekday}) inicia em 5 minutos.

Link da aula: ${safeLessonLink}

Entre na sala e aguarde a entrada do aluno.`;
}

export function buildRecurringClassRegisteredAttendantStartReminderWhatsAppMessage(name: string | null | undefined, weekdayLabel: string | null | undefined, lessonLink: string | null | undefined) {
  const safeLessonLink = String(lessonLink ?? "").trim();
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno";
  const safeWeekday = String(weekdayLabel ?? "").trim() || "hoje";
  return `Aviso: aula recorrente de ${safeFirst} (${safeWeekday}) inicia em 5 minutos.

Link da aula: ${safeLessonLink}

Acompanhe o atendimento e certifique-se de que tudo ocorra bem.`;
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

export function buildRecurringClassPostEnrollmentRegisteredAttendantNotification(name: string | null | undefined, weekdayLabel: string | null | undefined, timeLabel: string | null | undefined) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Novo aluno";
  const safeWeekday = String(weekdayLabel ?? "").trim() || "horário fixo";
  const safeTime = String(timeLabel ?? "").trim() || "a confirmar";
  return `Nova matrícula confirmada — aula recorrente cadastrada.

Aluno: ${safeFirst}
Dia: ${safeWeekday}
Horário: ${safeTime}

Acesse o painel para conferir:
${EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK}`;
}

export function buildRecurringPaymentPendingConfirmationAttendantNotification(
  name: string | null | undefined,
  enrollmentNumber: string | null | undefined,
) {
  const safeFull = String(name ?? "").trim() || "Novo aluno";
  const safeEnrollment =
    String(enrollmentNumber ?? "").trim() || "Nº de matrícula";
  return `Alerta: Pagamento pendente de confirmação 🔔

Um aluno avançou para a etapa de pagamento!

Confira no aplicativo se o pagamento foi recebido e, em seguida, registre na plataforma a confirmação, marcando Sim ou Não.

Aluno: ${safeFull}
Matrícula: ${safeEnrollment}

Acesse o painel:
${EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_LINK}`;
}

export function buildRecurringPaymentConfirmedStudentWelcomeMessage(
  name: string | null | undefined,
  dashboardLink: string | null | undefined,
) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno(a)";
  const safeDashboard =
    String(dashboardLink ?? "").trim() || "https://www.autobot.business/aluno";
  return `Parabéns, ${safeFirst}! 🎉

Seu pagamento foi confirmado e sua matrícula está oficialmente concluída na Lucas Brum Online Music USA.

A partir de agora, você já pode acessar o seu Painel do Aluno, onde poderá consultar seus dados de matrícula e acompanhar as informações das suas aulas.

Acesse seu painel:
${safeDashboard}

Para entrar, utilize o WhatsApp/e-mail e a senha cadastrados durante a matrícula.`;
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
    [
      line1,
      `Mas não se preocupe, novas oportunidades estarão disponíveis.`,
      `Em breve nossa equipe entrará em contato.`,
    ].join("\n\n"),
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
        if (!professorTimeIsAllowed({ weekdayShort: weekday, professorTimeHHMM: professorTime })) continue;
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
  id: string;
  weekday: RecurringWeekdayKey;
  label: string;
  shortLabel: string;
  displayLabel: string;
  slotCount: number;
  professorDate: string;
  weekIndex: 0 | 1;
  weekLabel: string;
};

export type RecurringWeekdayTimeOption = {
  id: string;
  weekday: RecurringWeekdayKey;
  professorTime: string;
  leadTime: string;
  displayLabel: string;
  professorDate: string;
  professorStartAtIso: string;
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
    ? Math.max(2, Number(params.lookAheadWeeks))
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
      return { dateIso: iso, ms };
    })
    .filter((x): x is { dateIso: string; ms: number } => Boolean(x));
  const blockedExactStarts = new Set<string>(booked.map((b) => b.dateIso));

  const weekdayOrder: RecurringWeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  const optionsByWeekdayDate = new Map<string, RecurringWeekdayTimeOption[]>();
  const metaByWeekdayDate = new Map<
    string,
    { weekday: RecurringWeekdayKey; professorDate: string; weekIndex: 0 | 1; weekLabel: string }
  >();

  function startOfProfessorWeek(d: Date): string {
    const todayLocal = localDateInTimeZone(d, ATENDIMENTO_PROFESSOR_TIME_ZONE);
    const todayNoonUtc = zonedDateTimeToUtcIso({
      date: todayLocal,
      time: "12:00",
      timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
    });
    const todayWeekday = weekdayInTimeZone(todayNoonUtc, ATENDIMENTO_PROFESSOR_TIME_ZONE).toLowerCase();
    const order: Array<RecurringWeekdayKey | "sun"> = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const todayIdx = order.indexOf(todayWeekday as any);
    const monLocal = addDaysToLocalDate(todayLocal, -Math.max(0, todayIdx));
    return monLocal;
  }

  const mondayThisWeek = startOfProfessorWeek(now);
  const weeksToEmit: Array<{ mondayLocal: string; index: 0 | 1; label: string }> = [
    { mondayLocal: mondayThisWeek, index: 0, label: "Semana atual" },
    { mondayLocal: addDaysToLocalDate(mondayThisWeek, 7), index: 1, label: "Próxima semana" },
  ];
  const orderIdx: Array<RecurringWeekdayKey | "sun"> = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  for (const week of weeksToEmit) {
    for (const weekday of weekdayOrder) {
      const wdIdx = orderIdx.indexOf(weekday);
      const professorDate = addDaysToLocalDate(week.mondayLocal, wdIdx);
      const slots: RecurringWeekdayTimeOption[] = [];
      for (const professorTime of EXPERIMENTAL_CLASS_SLOT_TIMES) {
        if (!professorTimeIsAllowed({ weekdayShort: weekday, professorTimeHHMM: professorTime })) continue;
        const professorStartAt = zonedDateTimeToUtcIso({
          date: professorDate,
          time: professorTime,
          timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
        });
        const startMs = new Date(professorStartAt).getTime();
        if (!Number.isFinite(startMs) || startMs <= now.getTime()) continue;
        if (blockedExactStarts.has(professorStartAt)) continue;

        slots.push({
          id: `${professorDate}|${weekday}|${professorTime}`,
          weekday,
          professorTime,
          professorDate,
          professorStartAtIso: professorStartAt,
          leadTime: formatTimeInTimeZone(professorStartAt, leadTimeZone),
          displayLabel: formatTimeInTimeZone(professorStartAt, leadTimeZone),
        });
      }
      if (slots.length > 0) {
        const key = `${professorDate}|${weekday}`;
        optionsByWeekdayDate.set(key, slots);
        metaByWeekdayDate.set(key, {
          weekday,
          professorDate,
          weekIndex: week.index,
          weekLabel: week.label,
        });
      }
    }
  }

  const entries = Array.from(metaByWeekdayDate.entries())
    .map(([key, meta]) => ({ key, meta }))
    .sort((a, b) => {
      const wa = a.meta.weekIndex;
      const wb = b.meta.weekIndex;
      if (wa !== wb) return wa - wb;
      const da = new Date(zonedDateTimeToUtcIso({ date: a.meta.professorDate, time: "12:00", timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE })).getTime();
      const db = new Date(zonedDateTimeToUtcIso({ date: b.meta.professorDate, time: "12:00", timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE })).getTime();
      return da - db;
    });

  const dates: RecurringWeekdayOption[] = entries.map(({ key, meta }) => {
    const slots = optionsByWeekdayDate.get(key) ?? [];
    const formattedDate = (() => {
      const noonUtc = zonedDateTimeToUtcIso({
        date: meta.professorDate,
        time: "12:00",
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      });
      const pt = new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      }).format(new Date(noonUtc));
      return pt;
    })();
    return {
      id: key,
      weekday: meta.weekday,
      professorDate: meta.professorDate,
      weekIndex: meta.weekIndex,
      weekLabel: meta.weekLabel,
      label: RECURRING_WEEKDAY_LABELS_PT_BR[meta.weekday],
      shortLabel: RECURRING_WEEKDAY_SHORT_LABELS[meta.weekday],
      displayLabel: `${RECURRING_WEEKDAY_LABELS_PT_BR[meta.weekday]} (${formattedDate})`,
      slotCount: slots.length,
    };
  });

  const slotsByWeekdayDate: Record<string, RecurringWeekdayTimeOption[]> = {};
  for (const [key, value] of optionsByWeekdayDate.entries()) {
    slotsByWeekdayDate[key] = value;
  }

  return { dates, slotsByWeekdayDate, slotsByWeekday: slotsByWeekdayDate };
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

export function calculatePastRecurringOccurrences(params: {
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  professorTimeHHMM: string;
  professorTimeZone?: string | null;
  leadTimeZone?: string | null;
  fromDate?: Date | string | null;
  toDate?: Date;
}) {
  const wantWeekday = String(params.weekday ?? "").trim().toLowerCase();
  if (!wantWeekday) return [];
  const time = String(params.professorTimeHHMM ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) return [];
  const profTz = String(params.professorTimeZone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const leadTz = String(params.leadTimeZone ?? "").trim() || profTz;
  const to = params.toDate ?? new Date();

  let fromMs: number;
  if (params.fromDate && String(params.fromDate).trim()) {
    const rawMs = new Date(params.fromDate).getTime();
    fromMs = Number.isFinite(rawMs) ? rawMs : to.getTime() - 365 * 24 * 60 * 60 * 1000;
  } else {
    fromMs = to.getTime() - 365 * 24 * 60 * 60 * 1000;
  }

  const toLocal = localDateInTimeZone(to, profTz);
  let scanLocal = localDateInTimeZone(new Date(fromMs), profTz);

  const ptbrLabels: Record<string, string> = {
    mon: "Segunda-feira",
    tue: "Terça-feira",
    wed: "Quarta-feira",
    thu: "Quinta-feira",
    fri: "Sexta-feira",
    sat: "Sábado",
    sun: "Domingo",
  };

  const results: Array<{
    professorDate: string;
    professorTime: string;
    professorTimeZone: string;
    professorStartAt: string;
    leadDate: string;
    leadTime: string;
    leadStartAt: string;
    leadTimeZone: string;
    weekdayLabel: string;
  }> = [];

  for (let safety = 0; safety < 1200; safety++) {
    if (scanLocal > toLocal) break;
    const noonUtc = zonedDateTimeToUtcIso({
      date: scanLocal,
      time: "12:00",
      timeZone: profTz,
    });
    const candidateWeekday = weekdayInTimeZone(noonUtc, profTz).toLowerCase();
    if (candidateWeekday === wantWeekday) {
      const startUtcIso = zonedDateTimeToUtcIso({
        date: scanLocal,
        time,
        timeZone: profTz,
      });
      const startUtcMs = new Date(startUtcIso).getTime();
      if (Number.isFinite(startUtcMs) && startUtcMs < to.getTime()) {
        results.push({
          professorDate: scanLocal,
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
        });
      }
    }
    scanLocal = addDaysToLocalDate(scanLocal, 1);
  }

  results.sort((a, b) => new Date(b.professorStartAt).getTime() - new Date(a.professorStartAt).getTime());
  return results;
}

const BRAZILIAN_STATE_KEYWORDS = new Set<string>([
  "acre", "alagoas", "amapa", "amapá", "amazonas", "bahia", "ceara", "ceará",
  "distrito federal", "espirito santo", "espírito santo", "goias", "goiás",
  "maranhao", "maranhão", "mato grosso do sul", "mato grosso", "minas gerais",
  "para", "pará", "paraiba", "paraíba", "parana", "paraná", "pernambuco",
  "piaui", "piauí", "rio de janeiro", "rio grande do norte", "rio grande do sul",
  "rondonia", "roraima", "santa catarina", "sao paulo", "são paulo",
  "sergipe", "tocantins",
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms",
  "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc",
  "sp", "se", "to",
]);

export function inferCountry(
  rawState: string | null | undefined,
  rawCity: string | null | undefined,
  rawTimezone: string | null | undefined
): string | null {
  const state = (rawState ?? "").trim();
  const city = (rawCity ?? "").trim();
  const timezone = (rawTimezone ?? "").trim();
  const stateLow = state.toLowerCase();
  const cityLow = city.toLowerCase();

  if (!stateLow && !cityLow) return null;
  if (!stateLow && !cityLow && !timezone) return null;

  // 0) BLOCO DE PROTECAO HARDCODED (MAIOR PRIORIDADE DE TODAS):
  //    Evita falsos positivos de substring em paises exoticos (ex: "island" dentro de
  //    "Rhode Island" bater no Sudão). Estados / cidades dos EUA com nomes que contem
  //    palavras de conflito SEMPRE retornam EUA imediatamente, sem passar pelo loop.
  const usHardcodedState =
    stateLow === "rhode island" || stateLow === "rhode" ||
    stateLow === "rhode island and providence plantations";
  const usHardcodedCityRI =
    /\b(pawtucket|providence|newport|warwick|cranston|woonsocket|east providence|central falls|westerly|pawtucket|johnston|north providence|cumberland|lincoln|smithfield|coventry|east greenwich|barrington|north kingstown|west warwick|bristol|tiverton|middletown|narragansett|scituate|exeter|richmond|charlestown|little compton|hopkinton|exeter|foster|glocester|burrillville|north smithfield|jamaica plain)\b/i.test(cityLow);
  const usHardcodedCompound =
    /\b(rhode island|new york city|long island|staten island|coney island|ellis island| Governors island|block island|aquidneck island|conanicut|prudence island)\b/i.test(stateLow + " " + cityLow);
  if (usHardcodedState || usHardcodedCityRI || usHardcodedCompound) return "Estados Unidos";

  // 0b) Timezones AMERICANOS MAIS COMUNS tambem batem ANTES do loop de keywordMap
  //     (evita que um erro no regex do Sudao / Omã faca fallback errado).
  if (timezone) {
    const tzLow = timezone;
    if ([
      "America/New_York","America/Chicago","America/Denver","America/Phoenix",
      "America/Los_Angeles","America/Anchorage","America/Honolulu",
      "America/Detroit","America/Indiana/Indianapolis","America/Kentucky/Louisville",
      "America/Menominee","America/Marquette","America/Nome","America/Juneau",
      "America/Sitka","America/Yakutat","America/Metlakatla","America/Petersburg",
      "America/Ketchikan","America/Adak","America/Boise"
    ].includes(tzLow)) {
      return "Estados Unidos";
    }
    if ([
      "America/Sao_Paulo","America/Cuiaba","America/Porto_Velho","America/Boa_Vista",
      "America/Manaus","America/Eirunepe","America/Rio_Branco","America/Recife",
      "America/Bahia","America/Santarem","America/Campo_Grande","Brazil/East",
      "Brazil/West","Brazil/Acre","Brazil/DeNoronha"
    ].includes(tzLow)) {
      return "Brasil";
    }
  }

  // 1) PRIORIDADE MAXIMA: keywords explicitas de estado/cidade que o usuario digitou.
  //    Isso vence de timezone default/professor (ex: Florida/Tampa deve ser EUA
  //    mesmo se o timezone padrao do sistema for America/Cuiaba).
  const keywordMap: Array<[RegExp, string]> = [
    [/\b(florida|california|texas|new york|califórnia|nova york|rhode island|pawtucket|providence|newport|washington|oregon|illinois|pennsylvania|nova jersey|georgia|ohio|michigan|carolina do norte|arizona|colorado|massachusetts|tennessee|nevada|virgínia|maryland|carolina do sul|kentucky|indiana|wisconsin|minnesota|missouri|iowa|arkansas|mississippi|nova hampshire|nebraska|virgínia ocidental|idaho|maine|montana|delaware|dakota do sul|dakota do norte|alasca|wyoming|vermont|hawai|hawaii|alabama|alaska|connecticut|flórida|kansas|louisiana|mississípi|montana|nebraska|nevada|nova iorque|oklahoma|oregon|pensilvânia|rhode|carolina do sul|dakota do sul|tennessee|texas|utah|vermont|virgínia|virgínia ocidental|wisconsin|wyoming|los angeles|san francisco|san diego|san jose|austin|houston|philadelphia|phoenix|san antonio|dallas|fort worth|columbus|indianapolis|charlotte|san francisco|seattle|denver|washington dc|nashville|oklahoma city|el paso|boston|portland|las vegas|memphis|louisville|baltimore|milwaukee|albuquerque|tucson|fresno|sacramento|long beach|kansas city|mesa|atlanta|virginia beach|colorado springs|raleigh|omaha|miami|oakland|minneapolis|tulsa|arlington|new orleans|wichita|cleveland|tampa|bakersfield|aurora|honolulu|anaheim|santa ana|st louis|pittsburgh|riverside|cincinnati|lexington|anchorage|stockton|newark|toledo|fort wayne|jersey city|st paul| buffalo|chandler|glendale|scottsdale|greensboro|norfolk|winston|durham|north las vegas|irvine|chesapeake|plano|newark|fort wayne|lincoln|tallahassee|mobile|chula vista|orlando|greensboro|new haven|huntsville|fremont|baton rouge|richmond|boise|san bernardino|spokane|des moines|modesto|fayetteville|shreveport|akron|tacoma|aurora|oxnard|fontana|worcester|amarillo|glendale|salt lake city|huntington beach|montgomery|miami gardens|ontario|little rock|augusta|moreno valley|tampa|sioux falls|oakland|salem|corona|overland park|grand rapids|cary|fort collins|hayward|garden grove|salinas|killeen|paterson|mcallen|fullerton|odessa|newton|visalia|concord|thousand oaks|savannah|roseville|warren|surprise|denton|mckinney|scranton|sterling heights|clovis|jersey|santa clara|simi valley|murfreesboro|vallejo|peoria|lansing|elfin cove|rockford|ann arbor|waco|chattanooga|bellevue|fargo|cambridge|green bay|costa mesa|beaumont|west valley|west jordan|garland|downey|burbank|pueblo|norman|atlantic city|aspen|boulder|paso robles|santa cruz|palmdale|salem|barnstable|lowell|manchester|santa rosa|evansville|waterbury|greeley|dover|sugar land|lafayette|kennesaw|olathe|kenosha|ontario|inglewood|santa maria|santee|elgin|naperville|trenton|flint|ventura|fairfield|clearwater|carrollton|carlsbad|wichita falls|san mateo|south bend|springdale|eugene|mesquite|peoria|springfield|jackson|madison|fort smith|athens|hickory|paducah|yonkers|concord|reading|boulder|rio rancho|des peres|galveston|wheeling|macon|port st lucie|west covina|cedar rapids|mobile|pompano beach|brea|garden grove|irving|redwood|poway|redlands|alhambra|napa|vacaville|rio rancho|tustin|dublin|petaluma|hampton|hanford|san fernando|burlingame|monterey|sausalito|pasadena|berkeley|compton|sacramento|hayward|napa|modesto|stockton|bakersfield|fresno|anaheim|irvine|glendale|rancho cucamonga|ontario|lancaster|palmdale|salinas|pomona|hayward|napa|rohnert park|livermore|sunnyvale|milpitas|mountain view|san rafael|novato|daly city|redwood city|san bruno|south san francisco|union city|foster city|menlo park|east palo alto|campbell|saratoga|los gatos|morgan hill|gilroy|watsonville|hollister|san luis obispo|santa barbara|oxnard|thousand oaks|simi valley|valencia|santa clarita|antelope|sacramento|eldorado hills|roseville|rocklin|folsom|elk grove|citrus heights|tracy|manteca|lodi|stockton|modesto|turlock|merced|fresno|clovis|bakersfield|visalia|porterville|hanford|santa maria|lompoc|santa barbara|san luis obispo|salinas|monterey|santa cruz|watsonville|hollister|gilroy|morgan hill|los gatos|saratoga|campbell|menlo park|foster city|union city|south san francisco|san bruno|redwood city|daly city|novato|san rafael|mountain view|milpitas|sunnyvale|livermore|rohnert park|napa|petaluma|santa rosa|fairfield|vallejo|antioch|richmond|san pablo|concord|walnut creek|pleasant hill|martinez|pittsburg|san ramon|dublin|pleasanton|livermore|fremont|union city|hayward|san leandro|alameda|oakland|berkeley|emeryville|piedmont|el cerrito|albany|san mateo|redwood city|menlo park|palo alto|mountain view|sunnyvale|santa clara|campbell|los gatos|morgan hill|gilroy|hollister|santa cruz|monterey|salinas|watsonville|san luis obispo|santa barbara|lompoc|santa maria|bakersfield|fresno|clovis|visalia|porterville|tulare|hanford|merced|turlock|modesto|stockton|lodi|manteca|tracy|elk grove|folsom|roseville|rocklin|citrus heights|antelope|sacramento|eldorado hills|santa clarita|valencia|thousand oaks|simi valley|oxnard|ventura|santa paula| camarillo|moorpark|simi valley|agoura hills|westlake village|newbury park|thousand oaks|moorpark| camarillo|oxnard|port hueneme|santa paula|fillmore|ojai|santa barbara|goleta|isla vista|lompoc|santa maria|orcutt|nuevo|san luis obispo|atascadero|paso robles|san miguel|temple|morro bay|cayucos|cambria|san simeon|big sur|monterey|pacific grove|seaside|marina|salinas|watsonville|gilroy|hollister|santa cruz|capitola|scotts valley|felton|boulder creek|ben lomond|scotts valley|san jose|santa clara|campbell|los gatos|morgan hill|cupertino|sunnyvale|mountain view|palo alto|menlo park|redwood city|san mateo|daly city|south san francisco|san bruno|san rafael|novato|petaluma|santa rosa|napa|vallejo|fairfield|vacaville|suisun|benicia|martinez|concord|walnut creek|pleasant hill|antioch|pittsburg|san ramon|dublin|pleasanton|livermore|fremont|hayward|union city|san leandro|alameda|oakland|berkeley|richmond|el cerrito|albany|emeryville|piedmont|san francisco|daly city|south san francisco|san bruno|pacifica|south san francisco|san mateo|redwood city|menlo park|palo alto|mountain view|sunnyvale|santa clara|milpitas|fremont|newark|union city|hayward|oakland|alameda|richmond|berkeley|san leandro|pleasanton|dublin|san ramon|livermore|martinez|walnut creek|concord|antioch|fairfield|vacaville|suisun|benicia|vallejo|napa|santa rosa|petaluma|novato|san rafael|mill valley|san anselmo|fairfax|larkspur|corte madera|sausalito|belvedere tiburon|marin city|stinson beach|point reyes|novatob|santa cruz|monterey|carmel|pacific grove|seaside|marina|salinas|watsonville|hollister|gilroy|morgan hill|los gatos|saratoga|campbell|cupertino|san jose|milpitas|fremont|union city|hayward|oakland|alameda|richmond|berkeley|san leandro|pleasanton|dublin|san ramon|livermore|martinez|walnut creek|concord|antioch|fairfield|vacaville|suisun|benicia|vallejo|napa|santa rosa|petaluma|novato|san rafael|san francisco|daly city|south san francisco|san bruno|pacifica|san mateo|redwood city|menlo park|palo alto|mountain view|sunnyvale|santa clara|san jose|campbell|los gatos|morgan hill|gilroy|hollister|santa cruz|watsonville|monterey|salinas|santa barbara|lompoc|santa maria|santa luis obispo|paso robles|bakersfield|fresno|clovis|visalia|porterville|tulare|hanford|merced|turlock|modesto|stockton|lodi|manteca|tracy|elk grove|folsom|roseville|rocklin|citrus heights|antelope|sacramento|eldorado hills|santa clarita|valencia|thousand oaks|simi valley|oxnard|ventura|santa paula| camarillo|moorpark|agoura hills|westlake village|newbury park|port hueneme|fillmore|ojai|santa barbara|goleta|isla vista|atascadero|san miguel|temple|morro bay|cayucos|cambria|san simeon|big sur|carmel|pacific grove|seaside|marina|capitola|scotts valley|felton|boulder creek|ben lomond|cupertino|milpitas|newark|san jose|santa clara|palo alto|menlo park|redwood city|san mateo|daly city|san bruno|south san francisco|pacifica|san rafael|novato|mill valley|san anselmo|fairfax|larkspur|corte madera|sausalito|belvedere tiburon|marin city|stinson beach|point reyes|petaluma|santa rosa|napa|vallejo|fairfield|vacaville|benicia|suisun|martinez|concord|walnut creek|pleasant hill|martinez|pittsburg|antioch|san ramon|dublin|pleasanton|livermore|fremont|union city|hayward|san leandro|alameda|oakland|richmond|berkeley|emeryville|piedmont|el cerrito|albany|san francisco|santa cruz|monterey|carmel|salinas|watsonville|hollister|gilroy|morgan hill|los gatos|saratoga|campbell|cupertino|san jose|milpitas|fremont|santa clara|palo alto|mountain view|sunnyvale|menlo park|redwood city|san mateo|daly city|south san francisco|san bruno|san rafael|novato|petaluma|santa rosa|napa|vallejo|fairfield|vacaville|benicia|suisun|martinez|concord|walnut creek|pleasant hill|pittsburg|antioch|san ramon|dublin|pleasanton|livermore|fremont|union city|hayward|san leandro|alameda|oakland|richmond|berkeley|san francisco|chula vista|vista|san diego|oceanside|escondido|carlsbad|el cajon|la mesa|santee|poway|encinitas|national city|chula vista|coronado|san marcos|san diego|vista|oceanside|escondido|carlsbad|el cajon|la mesa|santee|poway|encinitas|national city|imperial beach|la jolla|del mar|solana beach|rancho santa fe|san clemente|dana point|san juan capistrano|mission viejo|lake forest|irvine|tustin|santa ana|anaheim|huntington beach|fullerton|buena park|fountain valley|westminster|garden grove|stanton|cypress|cerritos|bellflower|norwalk|downey|paramount|lakewood|bell gardens|compton|hawthorne|inglewood|lawndale|lennox|hawthorne|redondo beach|hermosa beach|manhattan beach|el segundo|culver city|santa monica|beverly hills|west hollywood|burbank|glendale|pasadena|alhambra|monterey park|arcadia|temple city|san gabriel|rosemead|el monte|west covina|pomona|chino|ontario|rancho cucamonga|fontana|rialto|colton|san bernardino|redlands|mentone|yucaipa|beaumont|hedge|palm springs|cathedral city|indio|coachella|desert hot springs|palm desert|la quinta|rancho mirage|twentynine palms|barstow|apple valley|hesperia|victorville|adelanto|chino hills|diamond bar|walnut|rowland heights|hacienda heights|west puente valley|valinda|la puente|baldwin park|glendora|azusa|monrovia|arcadia|san dimas|la verne|claremont|upland|montclair|ontario|rancho cucamonga|fontana|jurupa valley|eastvale|corona|norco|lake elsinore|menifee|wildomar|murrieta|temecula|san jacinto|hemet|perris|moreno valley|riverside|grand terrace|colton|rialto|fontana|rancho cucamonga|upland|montclair|chino|ontario|pomona|west covina|la puente|baldwin park|el monte|rosemead|san gabriel|monterey park|arcadia|temple city|alhambra|pasadena|glendale|burbank|north hollywood|van nuys|sherman oaks|studio city|encino|tarzana|reseda|canoga park|winnetka|woodland hills|west hills|chatsworth|northridge|porter ranch|granada hills|sylmar|san fernando|glendale|burbank|universal city|hollywood|los feliz|silver lake|echo park|koreatown|westlake|los angeles|downtown|venice|marina del rey|playa vista|playa del rey|westchester|inglewood|hawthorne|lawndale|redondo beach|hermosa beach|manhattan beach|el segundo|torrance|carson|long beach|san pedro|wilmington|harbor city|lakewood|bellflower|paramount|downey|norwalk|bell gardens|compton|south gate|lynwood|huntington park|maywood|cudahy|bell|commerce|vernon|montebello|pico rivera|santa fe springs|whittier|la habra|brea|fullerton|placentia|yorba linda|anaheim hills|orange|tustin|irvine|lake forest|mission viejo|rancho santa margarita|aliso viejo|laguna niguel|dana point|san clemente|san juan capistrano|laguna beach|newport beach|huntington beach|seal beach|sunset beach|los alamitos|cerritos|la palma|buena park|cypress|stanton|fountain valley|westminster|garden grove|santa ana|anaheim|irvine|tustin|orange|yorba linda|placentia|fullerton|brea|la habra|whittier|pico rivera|montebello|santa fe springs|maywood|huntington park|south gate|lynwood|compton|bell gardens|downey|norwalk|lakewood|bellflower|paramount|carson|long beach|san pedro|wilmington|harbor city|torrance|redondo beach|hermosa beach|manhattan beach|el segundo|playa del rey|playa vista|marina del rey|venice|westchester|inglewood|hawthorne|lawndale|lennox|los angeles|beverly hills|santa monica|culver city|west hollywood|burbank|glendale|pasadena|alhambra|monterey park|arcadia|temple city|san gabriel|rosemead|el monte|west covina|pomona|chino|ontario|rancho cucamonga|fontana|rialto|colton|san bernardino|redlands|mentone|yucaipa|beaumont|palm springs|cathedral city|indio|coachella|desert hot springs|palm desert|la quinta|rancho mirage|twentynine palms|barstow|apple valley|hesperia|victorville|adelanto|chino hills|diamond bar|walnut|rowland heights|hacienda heights|glendora|azusa|monrovia|san dimas|La Verne|claremont|upland|montclair|jurupa valley|eastvale|corona|norco|lake elsinore|menifee|wildomar|murrieta|temecula|san jacinto|hemet|perris|moreno valley|riverside|grand terrace|visalia|fresno|clovis|bakersfield|modesto|stockton|turlock|merced|tracy|manteca|lodi|hanford|porterville|tulare|santa maria|lompoc|santa barbara|san luis obispo|paso robles|salinas|monterey|santa cruz|watsonville|hollister|gilroy|morgan hill|los gatos|saratoga|campbell|cupertino|san jose|santa clara|milpitas|fremont|union city|hayward|oakland|alameda|richmond|berkeley|san leandro|pleasanton|dublin|san ramon|livermore|martinez|walnut creek|concord|antioch|fairfield|vacaville|benicia|suisun|vallejo|napa|santa rosa|petaluma|novato|san rafael|san francisco|daly city|south san francisco|san bruno|pacifica|san mateo|redwood city|menlo park|palo alto|mountain view|sunnyvale)\b/i, "Estados Unidos"],
    [/\b(fl|ca|tx|ny|wa|il|pa|nj|ga|oh|mi|nc|az|co|ma|tn|nv|va|md|sc|al|ky|or|ok|ct|ks|ut|ia|ar|ms|nh|ne|wv|id|me|mt|ri|de|sd|nd|ak|wy|vt|hi)\b/i, "Estados Unidos"],
    [/(ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|prince edward island|newfoundland|labrador|nunavut|northwest territories|yukon|canadá|canada)/i, "Canadá"],
    [/(london|londres|england|inglaterra|scotland|escócia|wales|país de gales|northern ireland|irlanda do norte|united kingdom|reino unido|birmingham|manchester|liverpool|leeds|glasgow|edinburgh|bristol|sheffield|cardiff|belfast)/i, "Reino Unido"],
    [/(dublin|ireland|irlanda|cork|galway|limerick)/i, "Irlanda"],
    [/(lisboa|lisbon|oporto|porto|coimbra|aveiro|braga|faro|madeira|açores|portugal)/i, "Portugal"],
    [/(paris|parís|lyon|marseille|nice|toulouse|bordeaux|lille|strasbourg|montpellier|grenoble|frança)/i, "França"],
    [/(madrid|barcelona|valencia|valência|sevilla|sevilha|espanha|españa|malaga|bilbao|granada|zaragoza|palma|alicante|cordoba)/i, "Espanha"],
    [/(roma|rome|milano|milan|napoli|florence|firenze|venezia|venice|turin|torino|bologna|palermo|genova|itália)/i, "Itália"],
    [/(berlin|berlim|munich|munique|hamburg|hamburgo|frankfurt|cologne|colônia|düsseldorf|stuttgart|leipzig|dresden|alemanha|deutschland)/i, "Alemanha"],
    [/(zurich|zurique|geneva|genebra|bern|basel|lausanne|switzerland|suíça|suiça)/i, "Suíça"],
    [/(amsterdam|rotterdam|the hague|den haag|netherlands|países baixos|holanda|holland|utrecht|eindhoven|groningen)/i, "Países Baixos"],
    [/(brussels|bruxelas|antwerp|belgium|bélgica|belgica|ghent|charleroi|liege)/i, "Bélgica"],
    [/(stockholm|gothenburg|sweden|suécia|suecia|uppsala|malmo|linkoping)/i, "Suécia"],
    [/(oslo|bergen|norway|noruega|trondheim|stavanger|tromso)/i, "Noruega"],
    [/(copenhagen|copenhague|denmark|dinamarca|aarhus|odense|aalborg)/i, "Dinamarca"],
    [/(helsinki|finland|finlândia|tampere|turku|oulu)/i, "Finlândia"],
    [/(moscow|moscou|saint petersburg|são petersburgo|russia|rússia|novosibirsk|yekaterinburg|nizhny novgorod|kazan|chelyabinsk|omsk|samara|rostov-on-don|ufa|krasnoyarsk|voronezh|perm|volgograd)/i, "Rússia"],
    [/(mexico city|cidade do méxico|guadalajara|monterrey|cancun|méxico|mexico|puebla|tijuana|ciudad juarez|leon|queretaro|zapopan|monterrey|chihuahua)/i, "México"],
    [/(buenos aires|cordoba|rosario|argentina|mendoza|tucuman|la plata|mar del plata|salta)/i, "Argentina"],
    [/(santiago|valparaiso|concepción|chile|puente alto|antofagasta|la serena|temuco|iquique|punta arenas)/i, "Chile"],
    [/(bogotá|medellín|cali|barranquilla|colômbia|cartagena|cúcuta|soledad|ibagué|bucaramanga)/i, "Colômbia"],
    [/(lima|cusco|peru|arequipa|trujillo|chiclayo|piura|iquitos|huancayo|tacna)/i, "Peru"],
    [/(la paz|santa cruz|cochabamba|bolívia|bolivia|oruro|potosi|sucre|tarija|beni)/i, "Bolívia"],
    [/(caracas|maracaibo|venezuela|valencia|barquisimeto|ciudad guayana|san cristobal|maturin|barcelona|maracay)/i, "Venezuela"],
    [/(asunción|paraguay|paraguai|ciudad del este|san lorenzo|luque|fernando de la mora|limpio|ñemby|encarnación)/i, "Paraguai"],
    [/(montevideo|uruguay|uruguai|salto|ciudad de la costa|las piedras|durazno|florida|maldonado|rivera|tacuarembó)/i, "Uruguai"],
    [/(tokyo|tóquio|osaka|kyoto|japan|japão|yokohama|nagoya|sapporo|fukuoka|kobe|kawasaki|saitama|hiroshima|sendai|chiba|kitakyushu|sakai|niigata|hamamatsu|kumamoto|sagamihara|okayama|kyoto|okinawa)/i, "Japão"],
    [/(beijing|pequim|shanghai|hong kong|china|guangzhou|shenzhen|chengdu|wuhan|xian|nanjing|chongqing|tianjin|macau|taipei|kaohsiung|taichung|tainan)/i, "China"],
    [/(seoul|seul|busan|daegu|incheon|gwangju|daejeon|ulsan|suwon|korea|coreia do sul)/i, "Coreia do Sul"],
    [/(pyongyang|coreia do norte|north korea)/i, "Coreia do Norte"],
    [/(mumbai|bombaim|new delhi|nova déli|índia|india|delhi|bangalore|chennai|hyderabad|ahmedabad|pune|surat|jaipur|lucknow|kanpur|nagpur|patna|indore|thiruvananthapuram|bhopal|vadodara|coimbatore|kochi|ludhiana|visakhapatnam|agra|varanasi|madurai|meerut|nashik|jodhpur|rajkot|gwalior|vijayawada|chandigarh|jamshedpur|bhubaneswar|amritsar|allahabad|ranchi|srinagar|raipur|kota|aurangabad)/i, "Índia"],
    [/(dubai|abu dhabi|sharjah|al ain|ajman|ras al-khaimah|fujairah|umm al-quwain|emirados árabes unidos|uae)/i, "Emirados Árabes Unidos"],
    [/(istanbul|ankara|izmir|turkey|turquia|bursa|adana|gaziantep|konya|antalya|mersin|diyarbakir|kayseri|eskisehir|denizli|sanliurfa|malatya|samsun|kahramanmaras|trabzon)/i, "Turquia"],
    [/(cape town|cidade do cabo|johannesburg|pretoria|durban|port elizabeth|bloemfontein|áfrica do sul|south africa|boksburg|benoni|potchefstroom|nelspruit|kimberley|polokwane|george|richards bay|upington|mossel bay|stellenbosch)/i, "África do Sul"],
    [/(cairo|el cairo|egypt|egito|alexandria|giza|luxor|aswan|port said|suez|sharm el-sheikh|hurghada|mansoura|tanta|faiyum|ismailia|zagazig|damietta|asyut)/i, "Egito"],
    [/(tel aviv|jerusalem|jerusalém|israel|haifa|rishon lezion|petah tikva|ashdod|netanya|beer sheva|bnei brak|holon|ramat gan|bat yam|herzliya|kfar saba|modi'in|nahariya|ramla|lod|nahariya|eilat)/i, "Israel"],
    [/(riyadh|riade|jeddah|mecca|medina|dammam|khobar|taif|tabuk|buraydah|abha|jazan|najran|saudi|arábia saudita)/i, "Arábia Saudita"],
    [/(sydney|melbourne|brisbane|perth|adelaide|gold coast|newcastle|canberra|sunshine coast|wollongong|geelong|hobart|townsville|cairns|darwin|toowoomba|ballarat|bendigo|albury wodonga|launceston|mackay|rockhampton|bunbury|bundaberg|hervey bay|wagga wagga|australia)/i, "Austrália"],
    [/(auckland|wellington|christchurch|dunedin|hamilton|tauranga|lower hutt|palmerston north|napier hastings|porirua|invercargill|whangarei|new plymouth|whanganui|gisborne|blenheim|timaru|nelson|rotorua|new zealand|nova zelândia)/i, "Nova Zelândia"],
    [/(singapore|singapura|woodlands|yishun|jurong|tampines|bedok|pasir ris|hougang|sengkang|punggol|serangoon|bishan|ang mo kio|kallang|toapayoh|marine parade|queenstown|buangkok|sembawang|canberra)/i, "Singapura"],
    [/(bangkok|nonthaburi|pak kret|hat yai|chiang mai|si racha|phuket|thailand|tailândia|udon thani|nakhon ratchasima|chiang rai|khon kaen|surat thani|nakhon si thammarat|pattaya|samut prakan|ayutthaya|rayong|songkhla|trang)/i, "Tailândia"],
    [/(ho chi minh|hanoi|hai phong|da nang|can tho|hai duong|thanh pho bien|vietnam|vietnã|bien hoa|long xuyen|hai phong|haiphong|nam dinh|nha trang|tuy hoa|qui nhon|da lat|vung tau|phan thiet|kon tum|buon ma thuot|pleiku|tuyen quang|lao cai|lang son|cao bang|bac giang|thai nguyen|quang ninh|hai duong|hung yen|bac ninh|phu tho|vinh|thanh hoa|ha tinh|quang binh|quang tri|thua thien hue|da nang|quang nam|quang ngai|binh dinh|phu yen|khanh hoa|ninh thuan|binh thuan|lam dong|binh phuoc|tay ninh|binh duong|dong nai|ba ria vung tau|an giang|dong thap|tien giang|kien giang|can tho|vinh long|ben tre|tra vinh|soc trang|bac lieu|ca mau|long an|tay ninh)/i, "Vietnã"],
    [/(kuala lumpur|petaling jaya|ipoh|shah alam|klang|melaka|malacca|george town|penang|johor bahru|kuching|malaysia|kotakinabalu|seremban|kuantan|alor setar|sungai petani|terengganu|kelantan|pahang|perak|negeri sembilan|johor|kedah|penang|perlis|sabah|sarawak)/i, "Malásia"],
    [/(jakarta|surabaya|bandung|medan|bekasi|palembang|tangerang|semarang|depok|makassar|indonesia|padang|batam|bandar lampung|pekanbaru|bogor|malang|denpasar|tangerang selatan|serang|yogyakarta|surakarta|solo|samarinda|tegal|cirebon|manado|pekalongan|balikpapan|mataram|pontianak|purwokerto|jambi|palembang|bengkulu|ambon|kupang|pematangsiantar|bitung|banjarmasin|papua|aceh|sulawesi|kalimantan|sumatra|jawa|bali|nusa tenggara|maluku)/i, "Indonésia"],
    [/(manila|quezon city|davao|cebu|zinamboanga|taguig|antipolo|cagayan de oro|paranaque|dasmariñas|valenzuela|bacoor|general santos|las piñas|makati|san jose del monte|mandaluyong|muntinlupa|caloocan|mandaue|tacloban|butuan|angeles|iloilo|batangas|baguio|bacolod|santa rosa|san fernando|cabanatuan|tarlac|legazpi|dumaguete|surigao|calbayog|pasig|marikina|navotas|pateros|malabon|tagaytay|olongapo|vigan|candon|laoag|tuguegarao|santiago|cabanatuan|san jose|urdaneta|dagupan|san fernando la union|bangued|virac|lucena|gumaca|masbate|catbalogan|calapan|gasan|kalibo|roxas|san carlos|passi|iloilo|tagbilaran|dipolog|pagadian|zamboanga|cagayan de oro|valencia|malaybalay|kidapawan|koronadal|sultan kudarat|tacurong|isulan|digos|mati|surigao del sur|tandag|bislig|san francisco|agusan|butuan|surigao|bayugan|cabadbaran|tandag|san jose|baganga|cateel|manay|caraga|surigao del norte|dinagat islands|siargao|philippines|filipinas)/i, "Filipinas"],
    [/(tehran|isfahan|mashhad|shiraz|tabriz|karaj|qom|ahvaz|kermanshah|urmia|rasht|zahedan|kerman|araks|hamadan|khorramabad|sanandaj|bandar abbas|arak|ilam|bushehr|yazd|sari|semnan|zanjan|gorgan|shahr-e kord|birjand|bojnurd|torbat-e jam|kashan|qazvin|ghorveh|sepidan|mahabad|bukan|sardasht|urmia|maragheh|miandoab|naqadeh|oshnavieh|piranshahr|salmas|chaldoran|mahshahr|omadiyeh|andimeshk|khorramshahr|abadan|ahvaz|susangerd|hendijan|deylam|ganaveh|asaluyeh|lar|bastak|kish|qeshm|bandar abbas|minab|jask|chabahar|konarak|zabol|zahedan|iranshahr|saravan|nikshahr|peshwar|quetta|iran)/i, "Irã"],
    [/(baghdad|basra|erbil|mosul|najaf|karbala|sulaymaniyah|fallujah|nasiriyah|kirkuk|ramadi|tiqrit|babil|an najaf|karbala|samawah|diwaniyah|kut|amarah|badra|mandali|khanaqin|mandali|balad|dukhul|samarra|ad dawr|tikrit|beiji|mosul|zumar|tal afar|sinjar|al-qaim|rawah|anah|hadithah|hit|baghdadi|fallujah|abu ghraib|yusufiyah|mahmudiyah|iskandariyah|kufa|hillah|musayyib|faluja|iraq|iraque)/i, "Iraque"],
    [/(doha|al-rayyan|al wakrah|al khor|umm salal mohammed|al daayen|qatar|al-shahaniya|al wakrah|al khor|umm salal ali|al jumayliyah|al shahaniya|doha|qatar|catar)/i, "Qatar"],
    [/(kuwait|al farwaniyah|hawalli|al ahmadi|al jahra|mubarak al-kabeer|farwaniya|jleeb al-shuyoukh|sulaibikhat|sabah al-salem|qurain|abdullah al-mubarak|mahboula|fintas|abu al hasaniya|al abdali|kuwait city|salmiya|hadiyah|qortuba|jabriya|sharq|kuwait|cidade do kuwait|kuwait city)/i, "Kuwait"],
    [/(muscat|salalah|suhar|bawshar|seeb|al buraimi|nizwa|ibri|sur|ruwi|mutrah|wadi al maawal|oman|omã|sohar|ibra|barka|rustaq|nakhal|bahla|al hamra|izki|al mudhaibi|samail|bidbid|al khuwair|al ansab|al seeb|bawshar|al amerat|mabela|maabela|sohar|shinas|liwa|saham|khabourah|al suwaiq|al masnaah|barka|musannah|nakhal|al rustaq|bidbid|samail|al mudhaibi|izki|al hamra|bahla|nizwa|adam|al hamra|manah|bahla|izki|al jabal al akhdar|sur|tiwi|al ashkharah|ras al hadd|masirah|duqm|jiddat il harasis|dhofar|salalah|taqah|mirbat|thumrait|rakhyut|dhalkut|muqshin|al mazyona|al wusta|mahout|duqm|jalan bani bu ali|jalan bani hasan|bidiya|al kamil wadi al wafi|hawiyat najm|sinkar|jiddat il harasis|al wusta governorate|al sharqiyah north|al sharqiyah south|al batinah north|al batinah south|al dahirah|al dhahirah|al buraimi|muscat governorate|muscat|oman|omã)/i, "Omã"],
    [/(karachi|lahore|islamabad|rawalpindi|faisalabad|multan|gujranwala|hyderabad|peshawar|quetta|islamabad|rawalpindi|sargodha|bahawalpur|sialkot|sheikhupura|gujrat|jhang|sahiwal|okara|mardan|kasur|rahim yar khan|dera ghazi khan|nowshera|mingora|kohat|abbottabad|daska|campbellpur|nawabshah|kandhkot|khuzdar|chaman|zhob|loralai|mastung|sibi|ujjan shah kot|bannu|tank|dera ismail khan|mansehra|batgram|kolai palas|battagram|diamer|astore|gilgit|skardu|ghizer|hunza|nagar|chitral|upper dir|lower dir|malakand|swabi|charsadda|mardan|swat|khyber|kurram|north waziristan|south waziristan|federally administered tribal areas|fata|azad kashmir|muzaffarabad|mirpur|kotli|bhimber|neelum|pakistan|paquistão|paquistao)/i, "Paquistão"],
    [/(dhaka|chittagong|khulna|rajshahi|sylhet|barisal|rangpur|mymensingh|comilla|narayanganj|gazipur|tongi|chittagong|cox's bazar|bogra|rangamati|savar|narsingdi|netrakona|kishoreganj|manikganj|munshiganj|faridpur|shariatpur|madaripur|barisal|patuakhali|bhola|jhalokati|pirojpur|potia|lakshmipur|noakhali|feni|chandpur|brammanbaria|comilla|sylhet|moulvibazar|habiganj|sunamganj|dinajpur|thakurgaon|rangpur|nilphamari|lalmonirhat|kurigram|gaibandha|bogra|joypurhat|naogaon|natore|chapai nawabganj|rajshahi|sirajganj|pabna|jessore|magura|narail|khulna|bagerhat|satkhira|jhenaidah|chuadanga|meherpur|kushtia|jhenaidah|bangladesh|bangladeche|bangladexe)/i, "Bangladesh"],
    [/(kathmandu|pokhara|biratnagar|birgunj|lalitpur|bhaktapur|bharatpur|birtamod|butwal|hetauda|dhangadhi|itahari|dharan|nepalgunj|janakpur|banepa|siddharthanagar|gaushala|rampur|tansen|dipayal|mahendranagar|bhimeshwar|inaruwa|kanchanrup|siraha|biratnagar|jhapa|morang|sunsari|udayapur|saptari|siraha|dhankuta|panchthar|taplejung|tehrathum|bhojpur|khotang|okhaldhunga|sindhuli|ramechhap|dolakha|sindhupalchok|kavrepalanchok|lalitpur|bhaktapur|kathmandu|nuwakot|dhading|nuwakot|rasuwa|gorkha|lamjung|kaski|syangja|tanahu|parbat|baglung|myagdi|mustang|palpa|gulmi|argakhanchi|pyuthan|rukum|rolpa|salyan|dang|banke|bardiya|surkhet|dailekh|jajarkot|humla|jumla|kalikot|mugu|bajura|bajhang|doti|achham|darchula|baitadi|dadeldhura|kanchanpur|kailali|nepal|nepal|nepal)/i, "Nepal"],
    [/(colombo|sri jayawardenepura kotte|kandy|galle|jaffna|anuradhapura|negombo|trincomalee|matara|batticaloa|ratnapura|dambulla|nuwara eliya|polonnaruwa|kurunegala|hambantota|badulla|puttalam|kegalle|mannar|vavuniya|mullaitivu|kilinochchi|ampara|batticaloa|trincomalee|mullaittivu|mullaitivu|point pedro|valvettithurai|kankesanturai|manalkadu|thondamanaru|elephant pass|palaly|veli|point pedro|chavakachcheri|sandilipay|sithamparapuram|navaly|alyady|udappu|mannar|pesalai|talaimannar|mathot|jaffna|kandy|nuwara eliya|sri lanka|sri lanka|serendiva|ceilão|ceylon)/i, "Sri Lanka"],
    [/(baku|ganja|sumgait|lankaran|mingachevir|shaki|nakhchivan|azerbaijan|azerbaijão|xirdalan|bilasuvar|agdam|shusha|julfa|ordubad|astara|lenkaran|masallı|lerik|astara|haftoni|imishli|shirvan|salyan|bilasuvar|dashkasan|goygol|shamkir|gadabay|tartar|agstafa|gazakh|tovuz|samukh|goranboy|dashkasan|yevlakh|balakan|zardab|sabirabad|imishli|barda|agjabedi|beylagan|fuzuli|jabrayil|zangilan|gubadly|shahbuzkend|kalbajar|lacin|khojavend|khojali|shusha|agdam|terter|tartar|barda|agjabedi|kurdamir|yevlakh|samukh|goranboy|dashkasan|kalbajar|lacin|gubadly|zangilan|jabrayil|fuzuli|tartar|agstafa|gazakh|tovuz|gadabay|shamkir|dashkasan|goygol|shaki|shaki|shemakha|guba|khachmaz|quba|xachmaz|shabran|khizi|siyazan|abseron|baku|sumgayit|nakhchivan|ordubad|culfa|sarur|babek|shahbuz|julfa|nakhchivan|azerbaijan|azerbaijão)/i, "Azerbaijão"],
    [/(tbilisi|batumi|kutaisi|rustavi|zugdidi|sukhumi|gagra|poti|tbilisi|gori|akhaltsikhe|samtredia|senaki|zestaponi|kobuleti|telavi|akhalgori|tskhinvali|java|tsalenjikha|mtskheta|georgia|geórgia|georgia|georgia)/i, "Geórgia"],
    [/(yerevan|gyumri|vanadzor|hrazdan|armavir|kapan|artashat|kajaran|armenia|armênia|gavar|charentsavan|sevan|abovyan|shenavan|aratsk|yeghvard|byureghavan|meghri|agarak|kapan|sisian|goris|goris|kajaran|syunik|vayk|vardenis|noyemberyan|iljavan|tashir|stefanavan|spitak|talin|arasbarani|azatashen|baghramyan|chapar|mkhchyan|avan|kanaker|davtashen|arabkir|malatia|kentron|qanaqer|echtum|azat|kotayk|ararat|armavir|shirak|lori|tavush|gegharkunik|vayots dzor|syunik|kotayk|yerevan|armenia|armênia)/i, "Armênia"],
    [/(sana'a|sanaa|aden|hodeidah|taiz|mukalla|ibb|dhamar|sayyan|riyan|hais|sahar|qatn|marib|al jawf|sa'dah|hajjah|al bayda|dalah|zabid|al mahwit|al hudaydah|yemen|iêmen|iemen|sana'a|sanaa|aden|hodeidah|taiz|mukalla|ibb|dhamar|riyan|sayyan|yemen|iemen)/i, "Iêmen"],
    [/(beirut|tripoli|sidon|tyre|jounieh|nabatieh|zgharta|batroun|baalbek|hermel|sour|marjayoun|bint jbeil|jbeil|aqoura|zahle|anjar|caza|north governorate|mount lebanon|south governorate|nabatieh|beqaa|akkar|baalbek hermel|lebanon|líbano|libano)/i, "Líbano"],
    [/(damascus|aleppo|homs|hama|latakia|deir ez-zor|al-hasakah|raqqa|idlib|daraa|as-sweida|tartus|qamishli|palmyra|baniyas|kafr halab|al bab|manbij|jarabulus|abu kamal|mayadin|deir ez zor|del az zor|deir al-zur|tabqa|tal abyad|azaz|al rai|kobani|a'zaz|sirin|suruj|tel abiad|amuda|qamishli|al darbasiyah|ras al-ain|malikiyah|derik|afrin|sheikh wassouf|al-qusayr|zabadani|madaya|kobani|sarrin|manbij|jarabulus|al-bab|azaz|tell abyad|al-hasakah|qamishli|derik|malikiyah|qamishli|amuda|al darbasiyah|ras al ain|tell abyad|syria|síria|siria)/i, "Síria"],
    [/(amman|zarqa|irbid|aqaba|madaba|salt|karak|ma'an|tafilah|ajloun|jerash|mafraq|al-balqa|amman|zarka|irbid|ma'an|aqaba|ma'an|jordânia|jordan|jordania)/i, "Jordânia"],
    [/(tunis|sfax|sousse|kairouan|bizerte|gabes|ariana|nabeul|tunisia|tunísia|tunísia|ben arous|manouba|kef|siliana|jendouba|beja|ghardimaou|sidi bouzid|gafsa|tozeur|gasa|médéen|tataouine|mahdia|monastir|moknine|bizerte|nabel|kef|silyana|jendouba|béja|tunis|tunísia|tunisia|tunez)/i, "Tunísia"],
    [/(algiers|oran|constantine|annaba|blida|batna|djelfa|sétif|algeria|argélia|argelia|biskra|tlemcen|bejaia|tizi ouzou|tébessa|cherchell|boumerdès|bouchrouch|souk ahras|guelma|skikda|jijel|bejaia|bouira|médéa|tiaret|m'sila|chlef|saïda|m ascara|ghardaïa|adrar|illizi|tamanrasset|ouargla|tindouf|el oued|khenchela|el bayadh|naâma|sidi bel abbès|bordj bou arreridj|tissemsilt|ain temouchent|relizane|mostaganem|ain defla|mila|bousfer|djendel|bouzeghaia|beni saf|nihtar|el kataf|guemar|touggourt|ouled djellal|bordj badji mokhtar|chegga|taghit|taghit|ouargla|tamanrasset|illizi|adrar|in salah|tin zaouatine|tindouf|algeria|argélia|argelia)/i, "Argélia"],
    [/(casablanca|rabat|tangier|agadir|fes|marrakech|meknes|oujda|kenitra|salé|tetouan|morocco|marrocos|marocco|agadir|safi|mohammedia|beni mellal|khouribga|guelmim|tan-tan|laayoune|dakhla|smara|tarfaya|boujdour|goulimine|tan tan|es semara|laâyoune|assa zag|nouakchott|ouarzazate|midelt|ifrane|azrou|taza|hoceima|chefchaouen|ouazzane|sidi slimane|berrechid|settat|khemisset|tamesna|kalaat sraghna|youssoufia|ben ahmed|el jadida|azemmour|bir jdid|dar bouazza|ain harrouda|temara|skhirate|témara|sidi kacem|meknès|fès|nador|jerada|oued zem|beni ansar|al hoceima|fnideq|m'diq|chefchaouen|asilah|larache|kénitra|sidi allal bahdja|taza|guercif|taounate|taourirt|midelt|errichid|tinghir|zagora|mhamid|guelmim|sidi ifni|legzira|mirleft|sidi bouknadel|mohammedia|bouskoura|dar bouazza|ain aouda|skhirate|temara|rabat|salé|kenitra|casa|casablanca|dar bouazza|mohammedia|marrakesh|safi|el jadida|azemmour|bir jdid|essaouira|agadir|tiznit|taroudannt|maroc|marrocos|marocco|morocco|marrocos)/i, "Marrocos"],
    [/(tripoli|benghazi|misrata|zawiya|khoms|sabha|bayda|misurata|tarhuna|zleiten|ajdabiya|al bayda|az zawiyah|derna|sirte|benina|tolmeita|susa|ghat|ubari|ghemis|al khums|libya|líbia|libia|benghazi|tripoli|misrata|benghazi|derna|al byda|marj|suluq|al qubah|karkur|derna|al bayda|shahhat|aluqaylah|auluq|ajdabiya|tawergha|misurata|bani walid|tarhuna|msallata|zawiya|zyara|al mayah|ziltin|sabratah|surman|al aziziyah|gharyan|yafran|kikla|nalut|ghat|gheriat|fezzan|sabha|awbari|ghat|ubari|tamanhint|waddan|hun|awjilah|jalu|al fuqaha|tazirbu|awjila|jalu|sokna|zella|awjila|jalu|al fuqaha|tazirbu|libya|líbia|libia)/i, "Líbia"],
    [/(nairobi|mombasa|kisumu|nairobi|kenya|nakuru|eldoret|thika|malindi|kitale|garissa|meru|kakamega|machakos|nyeri|likuyani|bungoma|busia|homabay|migori|siaya|kisii|kajiado|ruiru|kiambu|juja|limuru|thika|machakos|wote|makueni|mutomo|vihiga|bondo|busia|bungoma|kitale|eldoret|kapsabet|kericho|bomet|narok|kajiado|kajiado|mombasa|malindi|watamu|lamu|kwale|ukunda|msambweni|mwatate|voi|tsavo|magadi|kajiado|namanga|narok|maji moto|gucha|migori|siaya|homabay|kisumu|busia|bondo|vihiga|kakamega|bungoma|kitale|trans nzoia|ugar|tengelia|kenya|quênia|quenia|kenia|kenya)/i, "Quênia"],
    [/(lagos|abuja|kano|ibadan|port harcourt|benin city|kaduna|ilorin|jos|enugu|nigeria|nigéria|onitsha|warri|maiduguri|zaria|ake|asaba|awka|sokoto|uyo|akure|oyo|osogbo|ilorin|ilorin|minna|lokoja|makurdi|damaturu|yola|bauchi|gombe|gashua|mubi|maidiguri|borno|adamawa|taraba|cross river|rivers|bayelsa|delta|edo|anambra|enugu|abia|ebonyi|imo|akwa ibom|cross river|oyo|osun|ekiti|ondo|ogun|lagos|niger|kogi|kwara|nasarawa|plateau|benue|taraba|adamawa|bauchi|gombe|borno|yobe|jigawa|katsina|kano|kaduna|zamfara|sokoto|kebbi|niger|kogi|abuja|f.c.t.|nassarawa|plateau|benue|enugu|abia|ebonyi|imo|akwa ibom|cross river|rivers|bayelsa|delta|edo|anambra|nigeria|nigéria|nigeria)/i, "Nigéria"],
    [/(addis ababa|dire dawa|mekele|adama|gondar|hawassa|bahir dar|dessie|jimma|jijiga|shashamane|arbaminch|bahir dar|adama|nazret|nairobi|harar|debre birhan|sodo|nekemte|asella|arba minch|hosaena|wolaita|sodo|bule hora|yirga alem|amaro|gorobe|abeya|gidole|konso|sawla|gofa|sawla|gidami|dilla|bule hora|yirga alem|hagere maryam|dilla|goba|bale|robe|goba|hirna|deder|babile|shinile|hara|mizan|bonga|jimma|agarfa|gumer|butajira|hosanna|sodo|durame|badessa|bole|addis ababa|ethiopia|etiópia|etiopia|etiopia)/i, "Etiópia"],
    [/\b(khartoum|oum durman|bahri|omdurman|port sudan|kasala|medani|kosti|nyala|el fasher|geneina|al managil|shendi|sennar|dinder|rahad|sudan|sudão|red sea|river nile|al qadarif|blue nile|white nile|north kordofan|south kordofan|north darfur|south darfur|west darfur|central darfur|east darfur|north kurdufan|south kurdufan|al jazirah|alnīl al ahabyar|alnīl al azraq|gadarif|qadarif|al butana|halfa al jadida|dongola|karima|merowe|wadi halfa|al abadiya|barakat|um rawaba|el obeid|nahud|talodi|kaduqli|dilling|tiwal|el renk|malakal|pariak|kajo keji|kaka|shirkat|barah|abu zabad|al fulah|rafa|gadid|abu jabra|abu hijer|south sudan|sul do sudão|juba|wau|renk|torit|yei|yambio|nimule|nasir|rubkona|bentiu|mayom|leer|pibor|cueibet|tonj|gogrial|kuacjok|akot|maper|rumbek|mapel|ganyliel|yirol|bor|panyang|terekeka|katigiri|kasengere|imotong|kapoeta|narus|lolim|mogiri|natinga|kidepo valley|lotuke|pageri|loka|lainya|maridi|mundri|amadi|tombura|tambura|nabiapai|wiku|bangassou|deim zubeir|sopo|kuru|dem zubeir|raja|daym as suluk|mboro|kafia kingi|bussere|tumbura|tombolo|nyamlell|busser|gidel|gombi|kangi|kordofan|darfur|gedaref|sudan do norte|sudão do sul)\b/i, "Sudão"],
  ];

  for (const [rx, country] of keywordMap) {
    if (stateLow && rx.test(stateLow)) return country;
    if (cityLow && rx.test(cityLow)) return country;
  }

  // 2) Estados brasileiros por Set (nome oficial, sem acento, sigla 2 letras, DF)
  if (stateLow && BRAZILIAN_STATE_KEYWORDS.has(stateLow)) return "Brasil";

  // 3) Timezone -> Brasil primeiro, depois regional tail
  const brTz = [
    "America/Sao_Paulo",
    "America/Cuiaba",
    "America/Porto_Velho",
    "America/Boa_Vista",
    "America/Manaus",
    "America/Eirunepe",
    "America/Rio_Branco",
    "America/Recife",
    "America/Bahia",
    "America/Santarem",
    "America/Campo_Grande",
    "Brazil/East",
    "Brazil/West",
    "Brazil/Acre",
    "Brazil/DeNoronha",
  ];
  if (timezone && brTz.includes(timezone)) return "Brasil";

  // Timezone -> fallback regional (mais largo). Ja deu preferencia para keywords/estados Brasil acima.
  if (timezone.startsWith("America/")) {
    const tail = timezone.slice("America/".length);
    const brTail = [
      "Sao_Paulo","Cuiaba","Porto_Velho","Boa_Vista","Manaus","Eirunepe","Rio_Branco",
      "Recife","Bahia","Santarem","Campo_Grande","Araguaina","Belem","Boa_Vista","Fortaleza",
      "Maceio","Paramaribo","Cayenne","Macapa","Santarem"
    ];
    const usTail = [
      "New_York","Chicago","Denver","Phoenix","Los_Angeles","Anchorage","Honolulu","Boise",
      "Detroit","Indianapolis","Louisville","Menominee","Marquette","Nome","Nome","Juneau",
      "Sitka","Yakutat","Metlakatla","Petersburg","Ketchikan","Adak","Indiana/Knox",
      "Indiana/Marengo","Indiana/Petersburg","Indiana/Tell_City","Indiana/Vevay","Indiana/Vincennes",
      "Indiana/Winamac","Kentucky/Monticello","North_Dakota/Beulah","North_Dakota/Center",
      "North_Dakota/New_Salem","Nipigon","Pangnirtung","Resolute","Thunder_Bay"
    ];
    const caTail = [
      "Winnipeg","Goose_Bay","Halifax","Moncton","St_Johns","Regina","Saskatoon","Edmonton",
      "Calgary","Vancouver","Dawson_Creek","Fort_Nelson","Whitehorse","Yellowknife","Inuvik",
      "Toronto","Ottawa","Montreal","Quebec","Rainy_River","Tegucigalpa","Panama","Guatemala",
      "San_Jose","San_Salvador","Managua","San_Juan","Santo_Domingo","Havana","Port-au-Prince",
      "Kingston","Bridgetown","Castries","Roseau","Basseterre","St_Johns","Gustavia","Philipsburg",
      "Marigot","Tortola","Road_Town","Cayman","Grand_Turk","Providenciales","Bermuda",
      "Puerto_Rico","US_Eastern","US_Central","US_Mountain","US_Pacific","US_Alaska",
      "US_Hawaii","Eastern","Central","Mountain","Pacific","Aleutian","Hawaii"
    ];
    if (brTail.includes(tail)) return "Brasil";
    if (tail.startsWith("Argentina")) return "Argentina";
    if (["Buenos_Aires","Cordoba","Rosario","Jujuy","Mendoza","Tucuman","Catamarca","La_Rioja","San_Juan","San_Luis","Rio_Gallegos","Comodoro_Rivadavia","Salta","Santiago_del_Estero","Mercedes","Corrientes","Posadas","Formosa","Resistencia","Bariloche","Ushuaia"].includes(tail)) return "Argentina";
    if (["Santiago","Punta_Arenas","Easter","Rapa_Nui"].includes(tail)) return "Chile";
    if (tail.startsWith("Chile")) return "Chile";
    if (["Bogota","Colombia","Medellin","Cali","Barranquilla","Cartagena","Bucaramanga","Ibagué","Manizales","Pereira","Cúcuta","Neiva","Pasto","Armenia","Soledad","Montería","Valledupar","Santa_Marta","Sincelejo","Riohacha","Villavicencio","Florencia","Mocoa","Pitalito","Garzon","Popayán","Cali","Tumaco","Ipiales","Leticia","Puerto_Carreno","Inirida","San_Andres","Providencia"].includes(tail)) return "Colômbia";
    if (["Lima","Piura","Trujillo","Arequipa","Iquitos","Chiclayo","Cajamarca","Jauja","Huancayo","Ica","Cusco","Puno","Ayacucho","Huanuco","Chachapoyas","Huancavelica","Abancay","Tacna","Moquegua","Tumbes","Mollendo","Ilo","Callao","Pucallpa","Tarapoto","Jaen","Tingo_Maria","Cerro_de_Pasco"].includes(tail)) return "Peru";
    if (["La_Paz","Sucre","Cochabamba","Santa_Cruz","Oruro","Potosí","Tarija","Trinidad","Cobija","Riberalta","Guayaramerín"].includes(tail)) return "Bolívia";
    if (["Caracas","Venezuela","Maracaibo","Valencia","Barquisimeto","Ciudad_Guayana","San_Cristóbal","Maturín","Barcelona","Maracay"].includes(tail)) return "Venezuela";
    if (["Asuncion","Encarnacion","Ciudad_del_Este","Pedro_Juan_Caballero","Villarrica","Concepcion","Luque","San_Lorenzo","Fernando_de_la_Mora","Limpio","Capiata","Ñemby","Itaugua","Mariano_Roque_Alonso","Presidente_Franco","Aregua","Pilar","Caaguazu","Ciudad_Nueva"].includes(tail)) return "Paraguai";
    if (["Montevideo","Salto","Ciudad_de_la_Costa","Las_Piedras","Durazno","Florida","Maldonado","Rivera","Tacuarembó","Mercedes","Minas","Treinta_y_Tres","Artigas","San_Jose_de_Mayo","Paysandu","Rocha","Fray_Bentos","Trinidad","Canelones","Carmelo","Colonia_del_Sacramento","Punta_del_Este","Melo"].includes(tail)) return "Uruguai";
    if (["Mexico_City","Guadalajara","Monterrey","Merida","Cancun","Tijuana","Puebla","Leon","Queretaro","Zapopan","Juarez","Chihuahua","Toluca","Aguascalientes","Morelia","San_Luis_Potosi","Culiacan","Saltillo","Hermosillo","Mexicali","Veracruz","Acapulco","Tehuacan","Chetumal","Tampico","Villahermosa","Campeche","Tuxtla_Gutierrez","Oaxaca","Puerto_Vallarta","Acapulco_de_Juarez","Cabo_San_Lucas","Cozumel","Isla_Mujeres","Playa_del_Carmen","Bacalar","Ciudad_Juarez","Ciudad_de_Mexico","Tijuana","Ensenada","La_Paz_BCS","Los_Mochis","Guaymas","Nogales","Ciudad_Obregon","Torreon","Matamoros","Reynosa","Nuevo_Laredo","Monclova","Piedras_Negras","Ciudad_Acuña","Zacatecas","Guadalajara","Puebla","Guanajuato","San_Miguel_de_Allende","Tepic","Mazatlan","Nayarit","Puerto_Vallarta","Ciudad_Guzman","Colima","Manzanillo","Tapachula","San_Cristobal_de_las_Casas","Villahermosa","Ciudad_del_Carmen","Ciudad_Constitucion","Ciudad_Insurgentes","La_Paz_BCS","Los_Cabos"].includes(tail)) return "México";
    if (caTail.includes(tail)) return "Canadá";
    if (usTail.includes(tail)) return "Estados Unidos";
    if (tail.startsWith("Brazil")) return "Brasil";
    // fallback default: eh Americas sem informacao
    if (timezone.startsWith("America/")) return "Estados Unidos";
  }
  if (timezone.startsWith("Europe/")) {
    const tail = timezone.slice("Europe/".length);
    if (["Lisbon","Madeira","Azores"].includes(tail)) return "Portugal";
    if (["Madrid","Barcelona","Canary","Ceuta","Melilla"].includes(tail)) return "Espanha";
    if (["Paris","Marseille","Toulouse","Lyon","Nice","Corsica","Grenoble","Strasbourg","Busingen"].includes(tail)) return "França";
    if (["Rome","Milan","Naples","Florence","Venice","Copenhagen","Amsterdam","Brussels","Berlin","Stockholm","Oslo","Helsinki","Warsaw","Prague","Vienna","Zurich","Dublin","Belfast","London","Bucharest","Sofia","Athens","Budapest","Riga","Tallinn","Vilnius","Ljubljana","Bratislava","Podgorica","Skopje","Sarajevo","Zagreb","Belgrade","Chisinau","Tirana","Simferopol"].includes(tail)) {
      if (["London","Isle_of_Man","Guernsey","Jersey","Belfast","Lisburn","Derry","Newry","Portadown","Enniskillen","Omagh","Dungannon","Strabane","Craigavon","Antrim","Ballymena","Newtownabbey","Ards","Carrickfergus","Newtownards","Larne","Coleraine","Bangor","Causeway","Belfast","Londonderry","Downpatrick","Bagenalstown","Carlow","Cashel","Cork","Drogheda","Dublin","Ennis","Galway","Kilkenny","Limerick","Longford","Nenagh","Sligo","Thurles","Tralee","Waterford","Wexford","Dundalk","Swords","Drogheda","Sligo","Killarney","Cobh","Bray","Naas","Athlone","Clonmel","Enniscorthy","Carlow","Mullingar","Letterkenny","Tipperary","Cavan","Monaghan","Roscommon","Castlebar","Tullamore","Longford","Laois","Offaly","Meath","Kildare","Westmeath","Wicklow","Donegal","Mayo","Galway","Clare","Kerry","Cork","Limerick","Tipperary","Waterford","Wexford","Kilkenny","Carlow","Louth","Meath","Westmeath","Offaly","Laois","Kildare","Wicklow","Dublin","Cork","Galway","Mayo","Donegal","Tipperary","Clare","Kerry","Waterford","Wexford","Kilkenny","Carlow","Louth","Meath","Westmeath","Offaly","Laois","Kildare","Wicklow"].includes(tail)) return "Irlanda";
      if (["London","Isle_of_Man","Guernsey","Jersey"].includes(tail)) return "Reino Unido";
      if (["Europe/Zurich","Europe/Bern","Europe/Geneva","Europe/Basel","Europe/Lausanne","Europe/Zurich","Europe/Bern","Europe/Geneve"].includes(timezone)) return "Suíça";
      if (["Europe/Vienna"].includes(timezone)) return "Áustria";
      if (["Europe/Amsterdam","Europe/Rotterdam"].includes(timezone)) return "Países Baixos";
      if (["Europe/Brussels"].includes(timezone)) return "Bélgica";
      if (["Europe/Stockholm"].includes(timezone)) return "Suécia";
      if (["Europe/Oslo"].includes(timezone)) return "Noruega";
      if (["Europe/Copenhagen"].includes(timezone)) return "Dinamarca";
      if (["Europe/Helsinki"].includes(timezone)) return "Finlândia";
      if (["Europe/Moscow","Europe/Samara","Europe/Kaliningrad","Europe/Volgograd","Europe/Astrakhan","Europe/Saratov","Europe/Ulyanovsk"].includes(timezone)) return "Rússia";
      if (["Europe/Istanbul"].includes(timezone)) return "Turquia";
      if (["Europe/Warsaw"].includes(timezone)) return "Polônia";
      if (["Europe/Prague"].includes(timezone)) return "República Tcheca";
      if (["Europe/Budapest"].includes(timezone)) return "Hungria";
      if (["Europe/Bucharest"].includes(timezone)) return "Romênia";
      if (["Europe/Sofia"].includes(timezone)) return "Bulgária";
      if (["Europe/Athens"].includes(timezone)) return "Grécia";
      if (["Europe/Riga"].includes(timezone)) return "Letônia";
      if (["Europe/Tallinn"].includes(timezone)) return "Estônia";
      if (["Europe/Vilnius"].includes(timezone)) return "Lituânia";
      if (["Europe/Ljubljana"].includes(timezone)) return "Eslovênia";
      if (["Europe/Bratislava"].includes(timezone)) return "Eslováquia";
      if (["Europe/Podgorica"].includes(timezone)) return "Montenegro";
      if (["Europe/Skopje"].includes(timezone)) return "Macedônia do Norte";
      if (["Europe/Sarajevo"].includes(timezone)) return "Bósnia e Herzegovina";
      if (["Europe/Zagreb"].includes(timezone)) return "Croácia";
      if (["Europe/Belgrade"].includes(timezone)) return "Sérvia";
      if (["Europe/Chisinau"].includes(timezone)) return "Moldávia";
      if (["Europe/Tirana"].includes(timezone)) return "Albânia";
      if (["Europe/Simferopol"].includes(timezone)) return "Ucrânia";
      if (["Europe/Kyiv","Europe/Kiev","Europe/Uzhgorod","Europe/Zaporozhye"].includes(timezone)) return "Ucrânia";
      if (["Europe/Berlin","Europe/Frankfurt","Europe/Munich","Europe/Cologne","Europe/Hamburg","Europe/Leipzig","Europe/Dresden","Europe/Düsseldorf","Europe/Stuttgart","Europe/Nuremberg","Europe/Bremen","Europe/Dortmund","Europe/Essen","Europe/Hannover","Europe/Duisburg","Europe/Bochum","Europe/Wuppertal","Europe/Bielefeld","Europe/Bonn","Europe/Mannheim","Europe/Karlsruhe","Europe/Augsburg","Europe/Wiesbaden","Europe/Gelsenkirchen","Europe/Mönchengladbach","Europe/Brunswick","Europe/Chemnitz","Europe/Kiel","Europe/Aachen","Europe/Halle","Europe/Magdeburg","Europe/Erfurt","Europe/Ludwigshafen","Europe/Oldenburg","Europe/Leverkusen","Europe/Osnabrück","Europe/Darmstadt","Europe/Paderborn","Europe/Regensburg","Europe/Ingolstadt","Europe/Würzburg","Europe/Fürth","Europe/Wolfsburg","Europe/Ulm","Europe/Heilbronn","Europe/Pforzheim","Europe/Offenbach","Europe/Göttingen","Europe/Bottrop","Europe/Trier","Europe/Recklinghausen","Europe/Reutlingen","Europe/Bremerhaven","Europe/Koblenz","Europe/Bergisch_Gladbach","Europe/Jena","Europe/Remscheid","Europe/Erlangen","Europe/Solingen","Europe/Moers","Europe/Siegen","Europe/Hildesheim","Europe/Avranches","Europe/Salzgitter","Europe/Potsdam","Europe/Kaiserslautern","Europe/Landshut","Europe/Straubing","Europe/Neuss","Europe/Düsseldorf","Europe/Münster","Europe/Herford","Europe/Minden","Europe/Osnabrück","Europe/Hagen","Europe/Neumünster","Europe/Dessau","Europe/Rosslau","Europe/Zwickau","Europe/Zeitz","Europe/Gera","Europe/Suhl","Europe/Altenburg","Europe/Cottbus","Europe/Frankfurt_oder","Europe/Brandenburg","Europe/Neubrandenburg","Europe/Schwerin","Europe/Rostock","Europe/Stralsund","Europe/Wismar","Europe/Greifswald","Europe/Prenzlau","Europe/Ludwigslust","Europe/Karlsruhe","Europe/Freiburg","Europe/Heidelberg","Europe/Mannheim","Europe/Schwäbisch_Hall","Europe/Aalen","Europe/Reutlingen","Europe/Heidenheim","Europe/Friedrichshafen","Europe/Ravensburg","Europe/Constance","Europe/Konstanz","Europe/Bregenz","Europe/Dornbirn","Europe/Feldkirch","Europe/Innsbruck","Europe/Salzburg","Europe/Linz","Europe/Graz","Europe/Klagenfurt","Europe/Villach","Europe/St_Pölten","Europe/Eisenstadt","Europe/Baden","Europe/Wien","Europe/Vienna","Europe/Braunschweig","Europe/Delbrück","Europe/Bielefeld","Europe/Bielefeld"].includes(timezone)) return "Alemanha";
      if (["Europe/Rome","Europe/Milan","Europe/Naples","Europe/Florence","Europe/Venice","Europe/Bologna","Europe/Genoa","Europe/Turin","Europe/Palermo","Europe/Bari","Europe/Catania","Europe/Verona","Europe/Venice","Europe/Padua","Europe/Trieste","Europe/Brescia","Europe/Taranto","Europe/Prato","Europe/Modena","Europe/Parma","Europe/Reggio_Emilia","Europe/Reggio_Calabria","Europe/Perugia","Europe/Cagliari","Europe/Sassari","Europe/Lecce","Europe/Pescara","Europe/Trento","Europe/Siracusa","Europe/Bergamo","Europe/Forlì","Europe/Vicenza","Europe/Terni","Europe/Bolzano","Europe/Ravenna","Europe/Novara","Europe/Ferrara","Europe/Rimini","Europe/Salerno","Europe/Foggia","Europe/Ravenna","Europe/Livorno","Europe/L'Aquila","Europe/Lucca","Europe/Siena","Europe/Pisa","Europe/Arezzo","Europe/Potenza","Europe/Crotone","Europe/Vibo_Valentia","Europe/Cosenza","Europe/Catanzaro","Europe/Reggio_Calabria","Europe/Lamezia_Terme","Europe/Crotone","Europe/Vibo_Valentia","Europe/Cosenza","Europe/Catanzaro","Europe/Messina","Europe/Syracuse","Europe/Agrigento","Europe/Trapani","Europe/Ragusa","Europe/Caltanissetta","Europe/Enna","Europe/Nuoro","Europe/Sassari","Europe/Cagliari","Europe/Olbia","Europe/Tortolì","Europe/Carbonia","Europe/Iglesias","Europe/Lanusei","Europe/Tempio","Europe/Alghero","Europe/Nuoro","Europe/Macerata","Europe/Ascoli_Piceno","Europe/Fermo","Europe/Pescara","Europe/Chieti","Europe/L'Aquila","Europe/Campobasso","Europe/Potenza","Europe/Cosenza","Europe/Catanzaro","Europe/Reggio_Calabria","Europe/Naples","Europe/Benevento","Europe/Avellino","Europe/Salerno","Europe/Battipaglia","Europe/Caserta","Europe/Serravalle","Europe/San_Marino","Europe/Vatican"].includes(timezone)) return "Itália";
      return "Europa";
    }
  }
  if (timezone.startsWith("Asia/")) {
    const tail = timezone.slice("Asia/".length);
    if (["Tokyo","Osaka","Sapporo"].includes(tail)) return "Japão";
    if (["Shanghai","Beijing","Hong_Kong","Chongqing","Taipei","Harbin","Urumqi","Kashgar","Macau"].includes(tail)) return "China";
    if (["Seoul","Incheon","Busan"].includes(tail)) return "Coreia do Sul";
    if (["Singapore"].includes(tail)) return "Singapura";
    if (["Bangkok"].includes(tail)) return "Tailândia";
    if (["Hanoi","Ho_Chi_Minh"].includes(tail)) return "Vietnã";
    if (["Dubai","Abu_Dhabi"].includes(tail)) return "Emirados Árabes Unidos";
    if (["Riyadh","Jeddah","Dammam","Mecca","Medina"].includes(tail)) return "Arábia Saudita";
    if (["Kuala_Lumpur","Kuching","Penang"].includes(tail)) return "Malásia";
    if (["Jakarta","Surabaya","Makassar","Jayapura"].includes(tail)) return "Indonésia";
    if (["Manila","Cebu","Davao"].includes(tail)) return "Filipinas";
    if (["Delhi","Kolkata","Mumbai","Chennai","Bangalore","Hyderabad"].includes(tail)) return "Índia";
    if (["Tehran","Isfahan","Mashhad","Shiraz","Tabriz"].includes(tail)) return "Irã";
    if (["Baghdad","Erbil","Basra","Nassiriyah"].includes(tail)) return "Iraque";
    if (["Istanbul","Ankara","Izmir"].includes(tail)) return "Turquia";
    if (["Doha","Al_Dayeen"].includes(tail)) return "Qatar";
    if (["Kuwait"].includes(tail)) return "Kuwait";
    if (["Muscat","Salalah"].includes(tail)) return "Omã";
    if (["Karachi","Lahore","Islamabad"].includes(tail)) return "Paquistão";
    if (["Dhaka","Chittagong","Sylhet","Rajshahi","Khulna"].includes(tail)) return "Bangladesh";
    if (["Kathmandu","Pokhara","Biratnagar","Birgunj"].includes(tail)) return "Nepal";
    if (["Colombo","Sri_Jayawardenepura"].includes(tail)) return "Sri Lanka";
    if (["Baku"].includes(tail)) return "Azerbaijão";
    if (["Tbilisi"].includes(tail)) return "Geórgia";
    if (["Yerevan"].includes(tail)) return "Armênia";
    if (["Sanaa","Aden","Hodeidah","Mukalla","Taiz"].includes(tail)) return "Iêmen";
    if (["Beirut","Tripoli","Sidon","Tyre","Jounieh","Nabatieh","Zgharta","Batroun","Baalbek","Hermel","Sour","Marjayoun","Bint_Jbeil","Jbeil","Aqoura","Zahle","Anjar","Caza","North_Governorate","Mount_Lebanon","South_Governorate","Nabatieh","Beqaa","Akkar","Baalbek_Hermel","Lebanon"].includes(tail)) return "Líbano";
    if (["Damascus","Aleppo","Homs","Hama","Latakia","Deir_ez-Zor","Al-Hasakah","Raqqa","Idlib","Daraa","As-Sweida","Tartus","Qamishli","Palmyra","Baniyas","Kafr_Halab","Al_Bab","Manbij","Jarabulus","Abu_Kamal","Mayadin","Deir_ez_Zor","Del_Az_Zor","Deir_al-Zur","Tabqa","Tal_Abyad","Azaz","Al_Rai","Kobani","A'zaz","Sirin","Suruj","Tel_Abiad","Amuda","Qamishli","Al_Darbasiyah","Ras_al-Ain","Malikiyah","Derik","Afrin","Sheikh_Wassouf","Al-Qusayr","Zabadani","Madaya","Kobani","Sarrin","Manbij","Jarabulus","Al-Bab","Azaz","Tell_Abyad","Al-Hasakah","Qamishli","Derik","Malikiyah","Qamishli","Amuda","Al_Darbasiyah","Ras_al_Ain","Tell_Abyad","Syria","Damascus","Syria","Syria","Syria"].includes(tail)) return "Síria";
    if (["Amman","Zarqa","Irbid","Aqaba","Madaba","Salt","Karak","Ma'an","Tafilah","Ajloun","Jerash","Mafraq","Al-Balqa","Amman","Zarka","Irbid","Ma'an","Aqaba","Ma'an","Jordan","Jordan","Jordan"].includes(tail)) return "Jordânia";
  }
  if (timezone.startsWith("Africa/")) {
    const tail = timezone.slice("Africa/".length);
    if (["Cairo","Alexandria","Luxor","Port_Said","Suez"].includes(tail)) return "Egito";
    if (["Johannesburg","Cape_Town","Durban","Port_Elizabeth","Pretoria"].includes(tail)) return "África do Sul";
    if (["Lagos","Abuja","Kano","Port_Harcourt","Ibadan"].includes(tail)) return "Nigéria";
    if (["Nairobi","Mombasa","Kisumu"].includes(tail)) return "Quênia";
    if (["Casablanca","Rabat","Tangier","Agadir","Fez","Marrakech"].includes(tail)) return "Marrocos";
    if (["Tunis","Sfax","Sousse"].includes(tail)) return "Tunísia";
    if (["Algiers","Oran","Constantine"].includes(tail)) return "Argélia";
    if (["Tripoli","Benghazi","Misrata"].includes(tail)) return "Líbia";
    if (["Khartoum","Omdurman","Port_Sudan"].includes(tail)) return "Sudão";
    if (["Addis_Ababa","Dire_Dawa","Mekele"].includes(tail)) return "Etiópia";
  }
  if (timezone.startsWith("Australia/")) {
    const tail = timezone.slice("Australia/".length);
    if (["Sydney","Melbourne","Brisbane","Perth","Adelaide","Hobart","Darwin","Canberra","Gold_Coast","Newcastle","Geelong","Wollongong"].includes(tail)) return "Austrália";
  }
  if (timezone.startsWith("Pacific/")) {
    const tail = timezone.slice("Pacific/".length);
    if (["Auckland","Wellington","Christchurch","Dunedin","Hamilton","Tauranga"].includes(tail)) return "Nova Zelândia";
    if (["Honolulu","Fiji","Samoa","Tahiti","Papeete","Port_Moresby","Noumea","Guadalcanal","Hawaii"].includes(tail)) {
      if (["Honolulu"].includes(tail)) return "Estados Unidos";
      if (["Fiji","Suva","Nadi","Lautoka"].includes(tail)) return "Fiji";
      if (["Samoa","Pago_Pago","Apia"].includes(tail)) return "Samoa";
      if (["Tahiti","Papeete","Marquesas","Gambier","Marotiri"].includes(tail)) return "Polinésia Francesa";
      if (["Port_Moresby","Lae","Madang"].includes(tail)) return "Papua-Nova Guiné";
      if (["Noumea","Loyalty","Isle_of_Pines"].includes(tail)) return "Nova Caledônia";
      if (["Guadalcanal","Honiara"].includes(tail)) return "Ilhas Salomão";
    }
  }
  if (timezone.startsWith("Antarctica/")) {
    return "Antártida";
  }
  if (timezone === "UTC" || timezone === "GMT" || timezone.startsWith("Etc/")) {
    return null;
  }

  // Fallback por acentos
  if (stateLow || cityLow) {
    if (/[ãõçáàâéêíóôúü]/i.test(stateLow + " " + cityLow)) {
      if (/ñ/i.test(stateLow + " " + cityLow)) return null;
      return "Brasil";
    }
  }

  return null;
}
