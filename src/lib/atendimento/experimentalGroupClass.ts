import { normalizePhoneDigits } from "@/lib/phone";
import { resolveLeadTimeZoneFromRecord, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "./constants";
import {
  EXPERIMENTAL_CLASS_DURATION_MINUTES,
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
  normalizarExperimentalProfessorParaAllowlist,
  type RecurringOccupiedInterval,
} from "./experimentalClass";

export type ExperimentalGroupWeekdayKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export type ExperimentalGroupConfiguredSlot = {
  weekday: ExperimentalGroupWeekdayKey;
  professor_time: string;
};

export type ExperimentalGroupClassSettings = {
  enabled: boolean;
  professor_name: string | null;
  professor_phone: string | null;
  professor_timezone: string;
  capacity: number;
  slots: ExperimentalGroupConfiguredSlot[];
};

export type ExperimentalGroupClassMemberSummary = {
  id: string;
  lead_id: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  student_notification_sent_at: string | null;
};

export type ExperimentalGroupClassRecord = {
  id: string;
  professor_name: string | null;
  professor_phone: string | null;
  professor_timezone: string | null;
  professor_weekday: ExperimentalGroupWeekdayKey;
  professor_date: string;
  professor_time: string;
  professor_start_at: string;
  capacity: number;
  status: string | null;
  confirmed_at: string | null;
  lesson_link: string | null;
  members: ExperimentalGroupClassMemberSummary[];
};

export type ExperimentalGroupSlotSummary = {
  id: string;
  group_class_id: string | null;
  professor_name: string | null;
  professor_phone: string | null;
  professor_timezone: string;
  professor_weekday: ExperimentalGroupWeekdayKey;
  professor_weekday_label: string;
  professor_date: string;
  professor_time: string;
  professor_start_at: string;
  lead_timezone: string;
  lead_date: string;
  lead_time: string;
  capacity: number;
  occupied_seats: number;
  available_seats: number;
  status: string;
  lesson_link: string | null;
  confirmed_at: string | null;
  members: ExperimentalGroupClassMemberSummary[];
  is_full: boolean;
  is_current_lead_assigned: boolean;
};

const VALID_WEEKDAYS: ExperimentalGroupWeekdayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const WEEKDAY_LABELS_PT_BR: Record<ExperimentalGroupWeekdayKey, string> = {
  mon: "Segunda-feira",
  tue: "Terça-feira",
  wed: "Quarta-feira",
  thu: "Quinta-feira",
  fri: "Sexta-feira",
  sat: "Sábado",
  sun: "Domingo",
};

export function getDefaultExperimentalGroupClassSettings(): ExperimentalGroupClassSettings {
  return {
    enabled: false,
    professor_name: null,
    professor_phone: null,
    professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
    capacity: 4,
    slots: [],
  };
}

function normalizeTimeLabel(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1] ?? "");
  const minute = Number(match[2] ?? "");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeWeekday(value: unknown): ExperimentalGroupWeekdayKey | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return VALID_WEEKDAYS.includes(normalized as ExperimentalGroupWeekdayKey)
    ? (normalized as ExperimentalGroupWeekdayKey)
    : null;
}

export function normalizeExperimentalGroupClassSettings(
  raw: unknown,
): ExperimentalGroupClassSettings {
  const base = getDefaultExperimentalGroupClassSettings();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Record<string, unknown>;
  const professorNormalized = normalizarExperimentalProfessorParaAllowlist({
    name: String(value.professor_name ?? "").trim() || null,
    phone: String(value.professor_phone ?? "").trim() || null,
  });

  const rawSlots = Array.isArray(value.slots) ? value.slots : [];
  const normalizedSlots: ExperimentalGroupConfiguredSlot[] = [];
  for (const slot of rawSlots) {
    if (!slot || typeof slot !== "object") continue;
    const weekday = normalizeWeekday((slot as Record<string, unknown>).weekday);
    const professorTime = normalizeTimeLabel(
      (slot as Record<string, unknown>).professor_time,
    );
    if (!weekday || !professorTime) continue;
    if (normalizedSlots.some((item) => item.weekday === weekday)) continue;
    normalizedSlots.push({
      weekday,
      professor_time: professorTime,
    });
  }

  return {
    enabled:
      value.enabled === true ||
      value.enabled === "true" ||
      value.enabled === 1 ||
      value.enabled === "1",
    professor_name: professorNormalized?.name ?? null,
    professor_phone: professorNormalized?.phone ?? null,
    professor_timezone:
      String(value.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
    capacity: 4,
    slots: normalizedSlots.slice(0, 2),
  };
}

export function experimentalGroupWeekdayLabel(weekday: ExperimentalGroupWeekdayKey): string {
  return WEEKDAY_LABELS_PT_BR[weekday] ?? weekday;
}

export function isLeadPhoneEligibleForExperimentalGroup(phone: unknown): boolean {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  if (/^55\d{10,11}$/.test(digits)) return true;
  if (/^1\d{10}$/.test(digits)) return true;
  if (/^351\d{9}$/.test(digits)) return true;
  return digits.length >= 10 && digits.length <= 14;
}

function localDateInTimeZone(value: Date | string | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function weekdayInTimeZone(
  value: Date | string | number,
  timeZone: string,
): ExperimentalGroupWeekdayKey {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(new Date(value))
    .toLowerCase()
    .slice(0, 3);
  return (VALID_WEEKDAYS.includes(short as ExperimentalGroupWeekdayKey)
    ? short
    : "mon") as ExperimentalGroupWeekdayKey;
}

function formatTimeInTimeZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function localDateLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    weekday: "long",
  }).format(new Date(iso));
}

function professorStartAtConflictsWithRecurring(params: {
  professorStartAt: string;
  occupiedIntervals: RecurringOccupiedInterval[];
}): boolean {
  const startMs = new Date(params.professorStartAt).getTime();
  if (!Number.isFinite(startMs) || startMs <= 0) return false;
  const endMs = startMs + EXPERIMENTAL_CLASS_DURATION_MINUTES * 60 * 1000;
  return (params.occupiedIntervals ?? []).some((interval) => {
    const intervalStartMs = new Date(String(interval.startAt ?? "")).getTime();
    const intervalEndMs = new Date(String(interval.endAt ?? "")).getTime();
    if (!Number.isFinite(intervalStartMs) || !Number.isFinite(intervalEndMs)) return false;
    return startMs < intervalEndMs && intervalStartMs < endMs;
  });
}

export function buildExperimentalGroupClassConfirmationMessage(params: {
  leadName?: string | null;
  professorName?: string | null;
  professorStartAt: string;
  leadTimeZone: string;
  professorTimeZone?: string | null;
}): string {
  const safeFirstName =
    String(params.leadName ?? "").trim().split(/\s+/)[0] || "Aluno(a)";
  const professorTimeZone =
    String(params.professorTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const professorName = String(params.professorName ?? "").trim() || "Professor(a)";
  const leadDate = localDateLabel(params.professorStartAt, params.leadTimeZone);
  const leadTime = formatTimeInTimeZone(params.professorStartAt, params.leadTimeZone);
  const professorDate = localDateLabel(params.professorStartAt, professorTimeZone);
  const professorTime = formatTimeInTimeZone(params.professorStartAt, professorTimeZone);
  return [
    `Perfeito, ${safeFirstName}! Sua aula experimental em grupo foi confirmada. 🎶`,
    `Professor: ${professorName}`,
    `Horário na sua região: ${leadDate}, às ${leadTime}`,
    `Horário do professor (Cuiabá/MT): ${professorDate}, às ${professorTime}`,
  ].join("\n\n");
}

export function listExperimentalGroupClassSlots(params: {
  settings: ExperimentalGroupClassSettings;
  lead: Record<string, unknown> | null;
  existingClasses: ExperimentalGroupClassRecord[];
  occupiedIntervals: RecurringOccupiedInterval[];
  bookedIndividualProfessorStartAts: string[];
  now?: Date;
  lookAheadDays?: number;
}): ExperimentalGroupSlotSummary[] {
  const settings = normalizeExperimentalGroupClassSettings(params.settings);
  if (
    !settings.enabled ||
    !settings.professor_name ||
    !settings.professor_phone ||
    !settings.slots.length
  ) {
    return [];
  }

  const professorTimeZone = settings.professor_timezone || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const leadTimeZone = resolveLeadTimeZoneFromRecord({
    lead: params.lead ?? null,
    fallbackTimeZone: professorTimeZone,
  });
  const now = params.now ?? new Date();
  const lookAheadDays = Math.max(7, Math.min(Number(params.lookAheadDays ?? 42), 84));
  const existingByStartAt = new Map<string, ExperimentalGroupClassRecord>();
  for (const row of params.existingClasses ?? []) {
    const key = String(row.professor_start_at ?? "").trim();
    if (!key) continue;
    existingByStartAt.set(key, row);
  }
  const individualStarts = new Set(
    (params.bookedIndividualProfessorStartAts ?? [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );

  const leadId = String((params.lead as any)?.id ?? "").trim();
  const seenDates = new Set<string>();
  const slots: ExperimentalGroupSlotSummary[] = [];

  for (let offset = 0; offset < lookAheadDays; offset += 1) {
    const candidateDate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const professorDate = localDateInTimeZone(candidateDate, professorTimeZone);
    if (!professorDate || seenDates.has(professorDate)) continue;
    seenDates.add(professorDate);
    const weekday = weekdayInTimeZone(candidateDate, professorTimeZone);

    for (const configuredSlot of settings.slots) {
      if (configuredSlot.weekday !== weekday) continue;
      const professorStartAt = zonedDateTimeToUtcIso({
        date: professorDate,
        time: configuredSlot.professor_time,
        timeZone: professorTimeZone,
      });
      if (!professorStartAt) continue;
      const startMs = new Date(professorStartAt).getTime();
      if (!Number.isFinite(startMs) || startMs <= now.getTime()) continue;

      const existingClass = existingByStartAt.get(professorStartAt) ?? null;
      const activeMembers = (existingClass?.members ?? []).filter(
        (member) => String(member.status ?? "").trim().toLowerCase() === "assigned",
      );
      const isCurrentLeadAssigned = activeMembers.some(
        (member) => String(member.lead_id ?? "").trim() === leadId,
      );
      const occupiedSeats = activeMembers.length;
      const capacity = Math.min(
        4,
        Math.max(1, Number(existingClass?.capacity ?? settings.capacity ?? 4)),
      );
      const availableSeats = Math.max(capacity - occupiedSeats, 0);

      const blockedByRecurring = professorStartAtConflictsWithRecurring({
        professorStartAt,
        occupiedIntervals: params.occupiedIntervals ?? [],
      });
      const blockedByIndividual =
        individualStarts.has(professorStartAt) && !existingClass;

      if (!existingClass && (blockedByRecurring || blockedByIndividual)) {
        continue;
      }

      const statusRaw = String(existingClass?.status ?? "").trim().toLowerCase();
      const status =
        statusRaw && statusRaw !== "cancelled" && statusRaw !== "completed"
          ? statusRaw
          : existingClass
            ? "draft"
            : "draft";

      slots.push({
        id: existingClass?.id ?? professorStartAt,
        group_class_id: existingClass?.id ?? null,
        professor_name: existingClass?.professor_name ?? settings.professor_name,
        professor_phone: existingClass?.professor_phone ?? settings.professor_phone,
        professor_timezone: professorTimeZone,
        professor_weekday: configuredSlot.weekday,
        professor_weekday_label: experimentalGroupWeekdayLabel(configuredSlot.weekday),
        professor_date: existingClass?.professor_date ?? professorDate,
        professor_time: existingClass?.professor_time ?? configuredSlot.professor_time,
        professor_start_at: professorStartAt,
        lead_timezone: leadTimeZone,
        lead_date: localDateInTimeZone(professorStartAt, leadTimeZone),
        lead_time: formatTimeInTimeZone(professorStartAt, leadTimeZone),
        capacity,
        occupied_seats: occupiedSeats,
        available_seats: availableSeats,
        status,
        lesson_link: existingClass?.lesson_link ?? null,
        confirmed_at: existingClass?.confirmed_at ?? null,
        members: activeMembers,
        is_full: !isCurrentLeadAssigned && availableSeats <= 0,
        is_current_lead_assigned: isCurrentLeadAssigned,
      });
    }
  }

  return slots.sort(
    (left, right) =>
      new Date(left.professor_start_at).getTime() -
      new Date(right.professor_start_at).getTime(),
  );
}
