import { normalizePhoneDigits } from "@/lib/phone";
import { resolveLeadTimeZoneFromRecord, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "./constants";
import {
  EXPERIMENTAL_CLASS_DURATION_MINUTES,
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

export type ExperimentalGroupSlotType = "experimental" | "recorrente";

export type ExperimentalGroupConfiguredSlot = {
  enabled: boolean;
  weekday: ExperimentalGroupWeekdayKey | null;
  professor_time: string | null;
  professor_name: string | null;
  professor_phone: string | null;
  slot_type: ExperimentalGroupSlotType;
  pair_id: string;
};

export type ExperimentalGroupClassSettings = {
  enabled: boolean;
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
  attendance_status: string | null;
  attendance_checked_at: string | null;
  lesson_link: string | null;
  members: ExperimentalGroupClassMemberSummary[];
};

export type ExperimentalGroupSlotSummary = {
  id: string;
  group_class_id: string | null;
  pair_id: string | null;
  slot_type: ExperimentalGroupSlotType;
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

const VALID_SLOT_TYPES: ExperimentalGroupSlotType[] = ["experimental", "recorrente"];

function buildDefaultExperimentalGroupPair(pairNumber: number): ExperimentalGroupConfiguredSlot[] {
  const pairId = `pair-${pairNumber}`;
  return [
    {
      enabled: false,
      weekday: null,
      professor_time: null,
      professor_name: null,
      professor_phone: null,
      slot_type: "experimental",
      pair_id: pairId,
    },
    {
      enabled: false,
      weekday: null,
      professor_time: null,
      professor_name: null,
      professor_phone: null,
      slot_type: "recorrente",
      pair_id: pairId,
    },
  ];
}

export function getDefaultExperimentalGroupClassSettings(): ExperimentalGroupClassSettings {
  return {
    enabled: false,
    professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
    capacity: 4,
    slots: [...buildDefaultExperimentalGroupPair(1), ...buildDefaultExperimentalGroupPair(2)],
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

function normalizeSlotType(value: unknown): ExperimentalGroupSlotType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return VALID_SLOT_TYPES.includes(normalized as ExperimentalGroupSlotType)
    ? (normalized as ExperimentalGroupSlotType)
    : null;
}

export function normalizeExperimentalGroupClassSettings(
  raw: unknown,
): ExperimentalGroupClassSettings {
  const base = getDefaultExperimentalGroupClassSettings();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Record<string, unknown>;

  const rawSlots = Array.isArray(value.slots) ? value.slots : [];
  const parsedSlots: ExperimentalGroupConfiguredSlot[] = [];
  for (const [index, slot] of rawSlots.slice(0, 40).entries()) {
    if (!slot || typeof slot !== "object") continue;
    const slotValue = slot as Record<string, unknown>;
    const weekday = normalizeWeekday((slot as Record<string, unknown>).weekday);
    const professorTime = normalizeTimeLabel(
      (slot as Record<string, unknown>).professor_time,
    );
    const inferredPairNumber = Math.floor(index / 2) + 1;
    const pairId =
      String(slotValue.pair_id ?? "").trim() || `pair-${inferredPairNumber}`;
    const slotType =
      normalizeSlotType(slotValue.slot_type) ??
      (index % 2 === 0 ? "experimental" : "recorrente");
    const normalizedProfessor = normalizarExperimentalProfessorParaAllowlist({
      name: String(slotValue.professor_name ?? "").trim() || null,
      phone: String(slotValue.professor_phone ?? "").trim() || null,
    });
    parsedSlots.push({
      enabled:
        slotValue.enabled === true ||
        slotValue.enabled === "true" ||
        slotValue.enabled === 1 ||
        slotValue.enabled === "1",
      weekday,
      professor_time: professorTime,
      professor_name: normalizedProfessor?.name ?? null,
      professor_phone: normalizedProfessor?.phone ?? null,
      slot_type: slotType,
      pair_id: pairId,
    });
  }

  const slotsByPair = new Map<string, ExperimentalGroupConfiguredSlot[]>();
  for (const slot of parsedSlots) {
    const list = slotsByPair.get(slot.pair_id) ?? [];
    list.push(slot);
    slotsByPair.set(slot.pair_id, list);
  }

  const normalizedSlots: ExperimentalGroupConfiguredSlot[] = [];
  const pairIds =
    slotsByPair.size > 0
      ? Array.from(slotsByPair.keys()).sort((a, b) => {
          const aMatch = a.match(/(\d+)/);
          const bMatch = b.match(/(\d+)/);
          const aNumber = Number(aMatch?.[1] ?? Number.NaN);
          const bNumber = Number(bMatch?.[1] ?? Number.NaN);
          if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
            return aNumber - bNumber;
          }
          return a.localeCompare(b);
        })
      : ["pair-1", "pair-2"];

  for (const [pairIndex, pairId] of pairIds.entries()) {
    const pairSlots = slotsByPair.get(pairId) ?? [];
    const experimentalSlot =
      pairSlots.find((slot) => slot.slot_type === "experimental") ?? null;
    const recurringSlot =
      pairSlots.find((slot) => slot.slot_type === "recorrente") ?? null;
    const fallbackWeekday =
      experimentalSlot?.weekday ?? recurringSlot?.weekday ?? null;
    const fallbackProfessorTime =
      experimentalSlot?.professor_time ?? recurringSlot?.professor_time ?? null;
    const fallbackProfessorName =
      experimentalSlot?.professor_name ?? recurringSlot?.professor_name ?? null;
    const fallbackProfessorPhone =
      experimentalSlot?.professor_phone ?? recurringSlot?.professor_phone ?? null;
    const fallbackEnabled = Boolean(
      experimentalSlot?.enabled ?? recurringSlot?.enabled ?? false,
    );
    const canonicalPairId = String(pairId ?? "").trim() || `pair-${pairIndex + 1}`;
    normalizedSlots.push({
      enabled: Boolean(experimentalSlot?.enabled ?? fallbackEnabled),
      weekday: experimentalSlot?.weekday ?? fallbackWeekday,
      professor_time: experimentalSlot?.professor_time ?? fallbackProfessorTime,
      professor_name: experimentalSlot?.professor_name ?? fallbackProfessorName,
      professor_phone: experimentalSlot?.professor_phone ?? fallbackProfessorPhone,
      slot_type: "experimental",
      pair_id: canonicalPairId,
    });
    normalizedSlots.push({
      enabled: Boolean(recurringSlot?.enabled ?? fallbackEnabled),
      weekday: recurringSlot?.weekday ?? fallbackWeekday,
      professor_time: recurringSlot?.professor_time ?? fallbackProfessorTime,
      professor_name: recurringSlot?.professor_name ?? fallbackProfessorName,
      professor_phone: recurringSlot?.professor_phone ?? fallbackProfessorPhone,
      slot_type: "recorrente",
      pair_id: canonicalPairId,
    });
  }

  const hasAnyEnabledConfiguredSlot = normalizedSlots.some(
    (slot) =>
      slot.slot_type === "experimental" &&
      slot.enabled &&
      slot.weekday &&
      slot.professor_time,
  );

  return {
    enabled: hasAnyEnabledConfiguredSlot,
    professor_timezone:
      String(value.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
    capacity: 4,
    slots: normalizedSlots,
  };
}

export function resolveExperimentalGroupProfessorFromLead(lead: Record<string, unknown> | null): {
  name: string;
  phone: string;
} | null {
  if (!lead) return null;
  const flatName = String((lead as any)?.experimental_class_professor_name ?? "").trim();
  const flatPhone = String((lead as any)?.experimental_class_professor_phone ?? "").trim();
  const normalizedFlat = normalizarExperimentalProfessorParaAllowlist({
    name: flatName || null,
    phone: flatPhone || null,
  });
  if (normalizedFlat?.name && normalizedFlat?.phone) {
    return {
      name: normalizedFlat.name,
      phone: normalizedFlat.phone,
    };
  }

  const booking = (lead as any)?.experimental_class_booking ?? null;
  const bookingName = String(booking?.assigned_professor_name ?? "").trim();
  const bookingPhone = String(booking?.assigned_professor_phone ?? "").trim();
  const normalizedBooking = normalizarExperimentalProfessorParaAllowlist({
    name: bookingName || null,
    phone: bookingPhone || null,
  });
  if (normalizedBooking?.name && normalizedBooking?.phone) {
    return {
      name: normalizedBooking.name,
      phone: normalizedBooking.phone,
    };
  }

  return null;
}

export function resolveRecurringGroupProfessorFromLead(lead: Record<string, unknown> | null): {
  name: string;
  phone: string;
} | null {
  if (!lead) return null;
  const flatName = String((lead as any)?.recurring_class_professor_name ?? "").trim();
  const flatPhone = String((lead as any)?.recurring_class_professor_phone ?? "").trim();
  const normalizedFlat = normalizarExperimentalProfessorParaAllowlist({
    name: flatName || null,
    phone: flatPhone || null,
  });
  if (normalizedFlat?.name && normalizedFlat?.phone) {
    return {
      name: normalizedFlat.name,
      phone: normalizedFlat.phone,
    };
  }

  if (flatName || flatPhone) {
    return {
      name: flatName || "Professor(a)",
      phone: flatPhone,
    };
  }

  return null;
}

export function resolveConfiguredProfessorFromExperimentalGroupSettings(
  settings: ExperimentalGroupClassSettings | null | undefined,
  slotType: ExperimentalGroupSlotType,
): {
  name: string;
  phone: string;
} | null {
  const normalizedSettings = normalizeExperimentalGroupClassSettings(settings ?? null);
  const configuredSlots = normalizedSettings.slots.filter(
    (slot) =>
      slot.slot_type === slotType &&
      slot.enabled &&
      Boolean(String(slot.professor_name ?? "").trim()) &&
      Boolean(String(slot.professor_phone ?? "").trim()),
  );
  if (!configuredSlots.length) return null;
  const uniqueProfessors = Array.from(
    new Map(
      configuredSlots.map((slot) => [
        `${String(slot.professor_phone ?? "").trim()}::${String(slot.professor_name ?? "").trim()}`,
        {
          name: String(slot.professor_name ?? "").trim(),
          phone: String(slot.professor_phone ?? "").trim(),
        },
      ]),
    ).values(),
  );
  return uniqueProfessors[0] ?? null;
}

export function experimentalGroupWeekdayLabel(weekday: ExperimentalGroupWeekdayKey): string {
  return WEEKDAY_LABELS_PT_BR[weekday] ?? weekday;
}

export function resolveExperimentalGroupPairIdForClass(params: {
  settings: ExperimentalGroupClassSettings;
  groupClass: Pick<
    ExperimentalGroupClassRecord,
    "professor_weekday" | "professor_time" | "professor_phone"
  >;
}): string {
  const settings = normalizeExperimentalGroupClassSettings(params.settings);
  const classWeekday = String(params.groupClass.professor_weekday ?? "").trim().toLowerCase();
  const classTime = String(params.groupClass.professor_time ?? "").trim();
  const classProfessorDigits = normalizePhoneDigits(params.groupClass.professor_phone);
  const matchingSlot = settings.slots.find((slot) => {
    if (slot.slot_type !== "experimental") return false;
    if (!slot.weekday || !slot.professor_time) return false;
    if (slot.weekday !== classWeekday || slot.professor_time !== classTime) return false;
    const slotProfessorDigits = normalizePhoneDigits(slot.professor_phone);
    if (slotProfessorDigits && classProfessorDigits) {
      return slotProfessorDigits === classProfessorDigits;
    }
    return true;
  });
  return String(matchingSlot?.pair_id ?? "").trim();
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

function linkedRecurringSlotReservesSameSchedule(params: {
  settings: ExperimentalGroupClassSettings;
  configuredSlot: ExperimentalGroupConfiguredSlot;
}): boolean {
  const pairId = String(params.configuredSlot.pair_id ?? "").trim();
  if (!pairId || !params.configuredSlot.weekday || !params.configuredSlot.professor_time) {
    return false;
  }
  return params.settings.slots.some((slot) => {
    if (!slot.enabled || slot.slot_type !== "recorrente") return false;
    if (String(slot.pair_id ?? "").trim() !== pairId) return false;
    return (
      String(slot.weekday ?? "").trim().toLowerCase() ===
        String(params.configuredSlot.weekday ?? "").trim().toLowerCase() &&
      String(slot.professor_time ?? "").trim() ===
        String(params.configuredSlot.professor_time ?? "").trim()
    );
  });
}

export function buildExperimentalGroupClassConfirmationMessage(params: {
  leadName?: string | null;
  professorName?: string | null;
  professorStartAt: string;
  leadTimeZone: string;
  professorTimeZone?: string | null;
  lessonLink?: string | null;
}): string {
  const safeFirstName =
    String(params.leadName ?? "").trim().split(/\s+/)[0] || "Aluno(a)";
  const professorTimeZone =
    String(params.professorTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const professorName = String(params.professorName ?? "").trim() || "Professor(a)";
  const lessonLink = String(params.lessonLink ?? "").trim() || null;
  const leadDate = localDateLabel(params.professorStartAt, params.leadTimeZone);
  const leadTime = formatTimeInTimeZone(params.professorStartAt, params.leadTimeZone);
  const professorDate = localDateLabel(params.professorStartAt, professorTimeZone);
  const professorTime = formatTimeInTimeZone(params.professorStartAt, professorTimeZone);
  const lines = [
    `Perfeito, ${safeFirstName}! Sua aula experimental em grupo foi confirmada. 🎶`,
    `Professor: ${professorName}`,
    `Horário na sua região: ${leadDate}, às ${leadTime}`,
    `Horário do professor (Cuiabá/MT): ${professorDate}, às ${professorTime}`,
  ];
  if (lessonLink) {
    lines.push(`Link da aula: ${lessonLink}`);
  }
  return lines.join("\n\n");
}

export function listExperimentalGroupClassSlots(params: {
  settings: ExperimentalGroupClassSettings;
  lead: Record<string, unknown> | null;
  assignedProfessor?: { name: string; phone: string } | null;
  existingClasses: ExperimentalGroupClassRecord[];
  occupiedIntervals: RecurringOccupiedInterval[];
  bookedIndividualProfessorStartAts: string[];
  pairUsage?: Record<
    string,
    {
      assigned_count: number;
      has_assigned_members: boolean;
      has_experimental_members: boolean;
      has_recurring_members: boolean;
      experimental_lead_ids: string[];
      recurring_lead_ids: string[];
      members: Array<{
        id: string;
        lead_id: string;
        full_name: string | null;
        phone: string | null;
      }>;
    }
  >;
  now?: Date;
  lookAheadDays?: number;
}): ExperimentalGroupSlotSummary[] {
  const settings = normalizeExperimentalGroupClassSettings(params.settings);
  if (!settings.enabled || !settings.slots.length) {
    return [];
  }

  const professorTimeZone = settings.professor_timezone || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const assignedProfessor =
    params.assignedProfessor ?? resolveExperimentalGroupProfessorFromLead(params.lead ?? null);
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
  const leadAssignedGroupClassId =
    String((params.lead as any)?.experimental_class_group_class_id ?? "").trim() || null;
  const leadAssignedGroupStatus = String(
    (params.lead as any)?.experimental_class_group_status ?? "",
  )
    .trim()
    .toLowerCase();
  const leadAssignedProfessorStartAt =
    String((params.lead as any)?.experimental_class_professor_start_at ?? "").trim() || null;
  const leadAssignedProfessorDate =
    String((params.lead as any)?.experimental_class_professor_date ?? "").trim() || null;
  const leadAssignedProfessorTime =
    String((params.lead as any)?.experimental_class_professor_time ?? "").trim() || null;
  const leadAssignedProfessorPhoneDigits = normalizePhoneDigits(
    (params.lead as any)?.experimental_class_professor_phone ?? null,
  );
  const leadHasAssignedExperimentalClass =
    Boolean(
      leadId &&
        leadAssignedGroupStatus &&
        leadAssignedGroupStatus !== "removed" &&
        (leadAssignedGroupClassId ||
          leadAssignedProfessorStartAt ||
          (leadAssignedProfessorDate && leadAssignedProfessorTime)),
    );
  const seenDates = new Set<string>();
  const slots: ExperimentalGroupSlotSummary[] = [];

  for (let offset = 0; offset < lookAheadDays; offset += 1) {
    const candidateDate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const professorDate = localDateInTimeZone(candidateDate, professorTimeZone);
    if (!professorDate || seenDates.has(professorDate)) continue;
    seenDates.add(professorDate);
    const weekday = weekdayInTimeZone(candidateDate, professorTimeZone);

    for (const configuredSlot of settings.slots) {
      if (
        configuredSlot.slot_type !== "experimental" ||
        !configuredSlot.enabled ||
        !configuredSlot.weekday ||
        !configuredSlot.professor_time
      ) {
        continue;
      }
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
      const pairId = String(configuredSlot.pair_id ?? "").trim();
      const pairUsageEntry = pairId ? params.pairUsage?.[pairId] ?? null : null;
      const pairRecurringLeadIds = new Set(pairUsageEntry?.recurring_lead_ids ?? []);
      const matchesCurrentLeadAssignment = (() => {
        if (!leadHasAssignedExperimentalClass) return false;
        const existingClassId = String(existingClass?.id ?? "").trim() || null;
        if (leadAssignedGroupClassId && existingClassId === leadAssignedGroupClassId) {
          return true;
        }
        if (leadAssignedProfessorStartAt && professorStartAt === leadAssignedProfessorStartAt) {
          return true;
        }
        if (
          leadAssignedProfessorDate &&
          leadAssignedProfessorTime &&
          professorDate === leadAssignedProfessorDate &&
          configuredSlot.professor_time === leadAssignedProfessorTime
        ) {
          const slotProfessorDigits = normalizePhoneDigits(
            existingClass?.professor_phone ?? configuredSlot.professor_phone ?? null,
          );
          if (
            !leadAssignedProfessorPhoneDigits ||
            !slotProfessorDigits ||
            slotProfessorDigits === leadAssignedProfessorPhoneDigits
          ) {
            return true;
          }
        }
        return false;
      })();
      const isCurrentLeadAssigned =
        matchesCurrentLeadAssignment ||
        activeMembers.some((member) => String(member.lead_id ?? "").trim() === leadId);
      const occupiedSeats = Math.max(
        activeMembers.length,
        Number(pairUsageEntry?.assigned_count ?? activeMembers.length),
      );
      const capacity = Math.min(
        4,
        Math.max(1, Number(existingClass?.capacity ?? settings.capacity ?? 4)),
      );
      const availableSeats = Math.max(capacity - occupiedSeats, 0);
      const blockedByRecurringOccupants =
        Boolean(pairUsageEntry?.has_recurring_members) && !pairRecurringLeadIds.has(leadId);
      if (blockedByRecurringOccupants && !isCurrentLeadAssigned) {
        continue;
      }

      const blockedByRecurring =
        !linkedRecurringSlotReservesSameSchedule({
          settings,
          configuredSlot,
        }) &&
        professorStartAtConflictsWithRecurring({
          professorStartAt,
          occupiedIntervals: params.occupiedIntervals ?? [],
        });
      const blockedByIndividual =
        individualStarts.has(professorStartAt) && !existingClass;
      const slotProfessorName =
        String(configuredSlot.professor_name ?? "").trim() || assignedProfessor?.name || "";
      const slotProfessorPhone =
        String(configuredSlot.professor_phone ?? "").trim() || assignedProfessor?.phone || "";

      if (!existingClass && (blockedByRecurring || blockedByIndividual)) {
        continue;
      }
      if (!existingClass && !slotProfessorName && !slotProfessorPhone) {
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
        pair_id: pairId || null,
        slot_type: "experimental",
        professor_name:
          existingClass?.professor_name ??
          (slotProfessorName ? slotProfessorName : null),
        professor_phone:
          existingClass?.professor_phone ??
          (slotProfessorPhone ? slotProfessorPhone : null),
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
        members: Array.isArray(pairUsageEntry?.members)
          ? pairUsageEntry!.members.map((member) => ({
              id: member.id,
              lead_id: member.lead_id,
              full_name: member.full_name,
              phone: member.phone,
              status: activeMembers.some(
                (activeMember) => String(activeMember.lead_id ?? "").trim() === member.lead_id,
              )
                ? "assigned"
                : "assigned",
              student_notification_sent_at:
                activeMembers.find(
                  (activeMember) => String(activeMember.lead_id ?? "").trim() === member.lead_id,
                )?.student_notification_sent_at ?? null,
            }))
          : activeMembers,
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
