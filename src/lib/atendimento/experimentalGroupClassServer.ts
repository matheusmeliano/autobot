import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveLeadTimeZoneFromRecord, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { normalizePhoneDigits } from "@/lib/phone";
import {
  experimentalGroupWeekdayLabel,
  getDefaultExperimentalGroupClassSettings,
  listExperimentalGroupClassSlots,
  normalizeExperimentalGroupClassSettings,
  resolveExperimentalGroupProfessorFromLead,
  resolveRecurringGroupProfessorFromLead,
  type ExperimentalGroupClassRecord,
  type ExperimentalGroupClassSettings,
  type ExperimentalGroupClassMemberSummary,
  type ExperimentalGroupSlotType,
  type ExperimentalGroupSlotSummary,
} from "./experimentalGroupClass";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "./constants";
import { EXPERIMENTAL_CLASS_DURATION_MINUTES } from "./experimentalClass";
import { loadRecurringCalendarOccupiedIntervals } from "./server";

export const EXPERIMENTAL_GROUP_CLASS_SETTINGS_KEY =
  "experimental_group_classes_settings";

function isMissingRelationError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42703" ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message) ||
    /could not find the table .* in the schema cache/i.test(message)
  );
}

type RecurringGroupAssignedLeadRecord = {
  id: string;
  full_name: string | null;
  phone: string | null;
  recurring_class_weekday: string | null;
  recurring_class_weekday_label: string | null;
  recurring_class_professor_time: string | null;
  recurring_class_lead_time: string | null;
  recurring_class_professor_phone: string | null;
  recurring_class_group_pair_id: string | null;
  recurring_class_group_status: string | null;
};

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

function weekdayInTimeZone(value: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(new Date(value))
    .toLowerCase()
    .slice(0, 3);
}

function formatTimeInTimeZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function normalizeRecurringProfessorTime(row: Partial<RecurringGroupAssignedLeadRecord>): string {
  const professorTime = String(row.recurring_class_professor_time ?? "").trim();
  if (/^\d{2}:\d{2}$/.test(professorTime)) return professorTime;
  const leadTime = String(row.recurring_class_lead_time ?? "").trim();
  return /^\d{2}:\d{2}$/.test(leadTime) ? leadTime : "";
}

function startAtConflicts(params: {
  professorStartAt: string;
  occupiedIntervals: Array<{ start_at: string; end_at: string; lead_id: string | null; professor_phone_digits: string | null }>;
  professorPhoneDigits: string;
}) {
  const startMs = new Date(params.professorStartAt).getTime();
  if (!Number.isFinite(startMs) || startMs <= 0) return false;
  const endMs = startMs + EXPERIMENTAL_CLASS_DURATION_MINUTES * 60 * 1000;
  return params.occupiedIntervals.some((interval) => {
    if (
      params.professorPhoneDigits &&
      interval.professor_phone_digits &&
      interval.professor_phone_digits !== params.professorPhoneDigits
    ) {
      return false;
    }
    const intervalStartMs = new Date(String(interval.start_at ?? "")).getTime();
    const intervalEndMs = new Date(String(interval.end_at ?? "")).getTime();
    if (!Number.isFinite(intervalStartMs) || !Number.isFinite(intervalEndMs)) return false;
    return startMs < intervalEndMs && intervalStartMs < endMs;
  });
}

export async function listAssignedRecurringGroupMembers(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
}): Promise<RecurringGroupAssignedLeadRecord[]> {
  try {
    const { data, error } = await params.admin
      .from("atendimento_leads")
      .select(
        "id, full_name, phone, recurring_class_weekday, recurring_class_weekday_label, recurring_class_professor_time, recurring_class_lead_time, recurring_class_professor_phone, recurring_class_group_pair_id, recurring_class_group_status",
      )
      .not("recurring_class_group_pair_id", "is", null);
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return (Array.isArray(data) ? data : [])
      .map((row) => ({
        id: String((row as any)?.id ?? "").trim(),
        full_name: String((row as any)?.full_name ?? "").trim() || null,
        phone: String((row as any)?.phone ?? "").trim() || null,
        recurring_class_weekday: String((row as any)?.recurring_class_weekday ?? "").trim() || null,
        recurring_class_weekday_label:
          String((row as any)?.recurring_class_weekday_label ?? "").trim() || null,
        recurring_class_professor_time:
          String((row as any)?.recurring_class_professor_time ?? "").trim() || null,
        recurring_class_lead_time: String((row as any)?.recurring_class_lead_time ?? "").trim() || null,
        recurring_class_professor_phone:
          String((row as any)?.recurring_class_professor_phone ?? "").trim() || null,
        recurring_class_group_pair_id:
          String((row as any)?.recurring_class_group_pair_id ?? "").trim() || null,
        recurring_class_group_status:
          String((row as any)?.recurring_class_group_status ?? "").trim() || null,
      }))
      .filter(
        (row) =>
          Boolean(row.id && row.recurring_class_group_pair_id) &&
          String(row.recurring_class_group_status ?? "").trim().toLowerCase() !== "removed",
      );
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function loadExperimentalGroupClassSettings(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
}): Promise<{ settings: ExperimentalGroupClassSettings; updatedAt: string | null }> {
  try {
    const { data, error } = await params.admin
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", EXPERIMENTAL_GROUP_CLASS_SETTINGS_KEY)
      .maybeSingle();
    if (error && !isMissingRelationError(error)) {
      throw error;
    }
    return {
      settings: normalizeExperimentalGroupClassSettings((data as any)?.value ?? null),
      updatedAt: String((data as any)?.updated_at ?? "").trim() || null,
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        settings: getDefaultExperimentalGroupClassSettings(),
        updatedAt: null,
      };
    }
    throw error;
  }
}

export async function saveExperimentalGroupClassSettings(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  settings: ExperimentalGroupClassSettings;
}): Promise<string> {
  const nowIso = new Date().toISOString();
  const normalized = normalizeExperimentalGroupClassSettings(params.settings);
  const { error } = await params.admin.from("app_settings").upsert(
    {
      key: EXPERIMENTAL_GROUP_CLASS_SETTINGS_KEY,
      value: normalized,
      updated_at: nowIso,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
  return nowIso;
}

export async function listFutureExperimentalGroupClasses(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  fromIso?: string;
}): Promise<ExperimentalGroupClassRecord[]> {
  const fromIso = String(params.fromIso ?? new Date().toISOString()).trim();
  try {
    const { data: classes, error: classesError } = await params.admin
      .from("atendimento_experimental_group_classes")
      .select(
        "id, professor_name, professor_phone, professor_timezone, professor_weekday, professor_date, professor_time, professor_start_at, capacity, status, confirmed_at, lesson_link",
      )
      .gte("professor_start_at", fromIso)
      .order("professor_start_at", { ascending: true });
    if (classesError) {
      if (isMissingRelationError(classesError)) return [];
      throw classesError;
    }

    const classRows = Array.isArray(classes) ? (classes as any[]) : [];
    const classIds = classRows
      .map((row) => String((row as any)?.id ?? "").trim())
      .filter(Boolean);

    const membersByClassId = new Map<string, ExperimentalGroupClassMemberSummary[]>();
    if (classIds.length > 0) {
      const { data: members, error: membersError } = await params.admin
        .from("atendimento_experimental_group_class_members")
        .select("id, group_class_id, lead_id, status, student_notification_sent_at")
        .in("group_class_id", classIds)
        .order("created_at", { ascending: true });
      if (membersError) {
        if (!isMissingRelationError(membersError)) throw membersError;
      } else {
        const memberRows = Array.isArray(members) ? (members as any[]) : [];
        const leadIds = Array.from(
          new Set(
            memberRows
              .map((row) => String((row as any)?.lead_id ?? "").trim())
              .filter(Boolean),
          ),
        );
        const leadsById = new Map<string, { full_name: string | null; phone: string | null }>();
        if (leadIds.length > 0) {
          const { data: leads, error: leadsError } = await params.admin
            .from("atendimento_leads")
            .select("id, full_name, phone")
            .in("id", leadIds);
          if (leadsError) throw leadsError;
          for (const lead of leads ?? []) {
            const leadId = String((lead as any)?.id ?? "").trim();
            if (!leadId) continue;
            leadsById.set(leadId, {
              full_name: String((lead as any)?.full_name ?? "").trim() || null,
              phone: String((lead as any)?.phone ?? "").trim() || null,
            });
          }
        }

        for (const member of memberRows) {
          const groupClassId = String((member as any)?.group_class_id ?? "").trim();
          const leadId = String((member as any)?.lead_id ?? "").trim();
          if (!groupClassId || !leadId) continue;
          const current = membersByClassId.get(groupClassId) ?? [];
          const leadMeta = leadsById.get(leadId);
          current.push({
            id: String((member as any)?.id ?? "").trim(),
            lead_id: leadId,
            full_name: leadMeta?.full_name ?? null,
            phone: leadMeta?.phone ?? null,
            status: String((member as any)?.status ?? "").trim() || null,
            student_notification_sent_at:
              String((member as any)?.student_notification_sent_at ?? "").trim() || null,
          });
          membersByClassId.set(groupClassId, current);
        }
      }
    }

    return classRows.map((row) => ({
      id: String((row as any)?.id ?? "").trim(),
      professor_name: String((row as any)?.professor_name ?? "").trim() || null,
      professor_phone: String((row as any)?.professor_phone ?? "").trim() || null,
      professor_timezone: String((row as any)?.professor_timezone ?? "").trim() || null,
      professor_weekday: String((row as any)?.professor_weekday ?? "").trim().toLowerCase() as any,
      professor_date: String((row as any)?.professor_date ?? "").trim(),
      professor_time: String((row as any)?.professor_time ?? "").trim(),
      professor_start_at: String((row as any)?.professor_start_at ?? "").trim(),
      capacity: Math.max(1, Math.min(4, Number((row as any)?.capacity ?? 4))),
      status: String((row as any)?.status ?? "").trim() || null,
      confirmed_at: String((row as any)?.confirmed_at ?? "").trim() || null,
      lesson_link: String((row as any)?.lesson_link ?? "").trim() || null,
      members: membersByClassId.get(String((row as any)?.id ?? "").trim()) ?? [],
    }));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listScheduledIndividualExperimentalProfessorStarts(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  fromIso?: string;
  excludeLeadId?: string | null;
}): Promise<string[]> {
  const fromIso = String(params.fromIso ?? new Date().toISOString()).trim();
  try {
    let query = params.admin
      .from("atendimento_experimental_class_bookings")
      .select("lead_id, professor_start_at, status")
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .gte("professor_start_at", fromIso);

    if (params.excludeLeadId) {
      query = query.neq("lead_id", params.excludeLeadId);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return (data ?? [])
      .map((row: any) => String(row?.professor_start_at ?? "").trim())
      .filter(Boolean);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function buildExperimentalGroupClassSlotsForLead(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  lead: Record<string, unknown> | null;
  settings?: ExperimentalGroupClassSettings | null;
  now?: Date;
  lookAheadDays?: number;
  excludeLeadIdFromIndividualBookings?: boolean;
}): Promise<ExperimentalGroupSlotSummary[]> {
  const now = params.now ?? new Date();
  const settings =
    params.settings ?? (await loadExperimentalGroupClassSettings({ admin: params.admin })).settings;
  const existingClasses = await listFutureExperimentalGroupClasses({
    admin: params.admin,
    fromIso: now.toISOString(),
  });
  const bookedStarts = await listScheduledIndividualExperimentalProfessorStarts({
    admin: params.admin,
    fromIso: now.toISOString(),
    excludeLeadId:
      params.excludeLeadIdFromIndividualBookings
        ? String((params.lead as any)?.id ?? "").trim() || null
        : null,
  });
  const occupiedIntervals = (await loadRecurringCalendarOccupiedIntervals({
    admin: params.admin,
    now,
    lookAheadWeeks: 8,
  }))
    .filter((interval) => interval.source === "recurring_schedule")
    .map((interval) => ({
      startAt: interval.start_at,
      endAt: interval.end_at,
    }));

  return listExperimentalGroupClassSlots({
    settings,
    lead: params.lead ?? null,
    assignedProfessor: resolveExperimentalGroupProfessorFromLead(params.lead ?? null),
    existingClasses,
    occupiedIntervals,
    bookedIndividualProfessorStartAts: bookedStarts,
    now,
    lookAheadDays: params.lookAheadDays ?? 42,
  });
}

export async function buildRecurringGroupClassSlotsForLead(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  lead: Record<string, unknown> | null;
  settings?: ExperimentalGroupClassSettings | null;
  now?: Date;
  lookAheadDays?: number;
}): Promise<ExperimentalGroupSlotSummary[]> {
  const now = params.now ?? new Date();
  const settings =
    params.settings ?? (await loadExperimentalGroupClassSettings({ admin: params.admin })).settings;
  const normalizedSettings = normalizeExperimentalGroupClassSettings(settings);
  if (!normalizedSettings.slots.length) return [];

  const assignedProfessor = resolveRecurringGroupProfessorFromLead(params.lead ?? null);
  if (!assignedProfessor?.phone) return [];

  const professorTimeZone =
    String(normalizedSettings.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const leadTimeZone = resolveLeadTimeZoneFromRecord({
    lead: params.lead ?? null,
    fallbackTimeZone: professorTimeZone,
  });
  const leadId = String((params.lead as any)?.id ?? "").trim();
  const professorPhoneDigits = normalizePhoneDigits(assignedProfessor.phone);
  const capacity = Math.min(4, Math.max(1, Number(normalizedSettings.capacity ?? 4)));
  const lookAheadDays = Math.max(14, Math.min(Number(params.lookAheadDays ?? 56), 84));
  const recurringMembers = await listAssignedRecurringGroupMembers({ admin: params.admin });
  const occupiedIntervalsRaw = await loadRecurringCalendarOccupiedIntervals({
    admin: params.admin,
    now,
    lookAheadWeeks: 8,
  });
  const recurringSlots = normalizedSettings.slots.filter(
    (slot) =>
      slot.slot_type === ("recorrente" as ExperimentalGroupSlotType) &&
      slot.enabled &&
      slot.weekday &&
      slot.professor_time,
  );

  const slots: ExperimentalGroupSlotSummary[] = [];
  for (const configuredSlot of recurringSlots) {
    const pairId = String(configuredSlot.pair_id ?? "").trim();
    if (!pairId || !configuredSlot.weekday || !configuredSlot.professor_time) continue;

    const pairMembers = recurringMembers.filter(
      (row) => String(row.recurring_class_group_pair_id ?? "").trim() === pairId,
    );
    const pairMemberIds = new Set(pairMembers.map((row) => row.id));
    const isCurrentLeadAssigned = pairMemberIds.has(leadId);
    const occupiedSeats = pairMembers.length;
    const availableSeats = Math.max(capacity - occupiedSeats, 0);

    const blockedByOtherRecurringSchedules = recurringMembers.some((row) => {
      if (row.id === leadId) return false;
      if (String(row.recurring_class_group_pair_id ?? "").trim() === pairId) return false;
      if (
        normalizePhoneDigits(row.recurring_class_professor_phone) !== professorPhoneDigits ||
        String(row.recurring_class_weekday ?? "").trim().toLowerCase() !== configuredSlot.weekday ||
        normalizeRecurringProfessorTime(row) !== configuredSlot.professor_time
      ) {
        return false;
      }
      return true;
    });
    if (blockedByOtherRecurringSchedules && !isCurrentLeadAssigned) {
      continue;
    }

    const occupiedIntervals = occupiedIntervalsRaw
      .filter((interval) => {
        const intervalLeadId = String(interval.lead_id ?? "").trim() || null;
        if (intervalLeadId && (intervalLeadId === leadId || pairMemberIds.has(intervalLeadId))) {
          return false;
        }
        return true;
      })
      .map((interval) => ({
        start_at: interval.start_at,
        end_at: interval.end_at,
        lead_id: interval.lead_id,
        professor_phone_digits: interval.professor_phone_digits,
      }));

    let nextProfessorStartAt: string | null = null;
    let nextProfessorDate = "";
    for (let offset = 0; offset < lookAheadDays; offset += 1) {
      const candidateDate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
      const professorDate = localDateInTimeZone(candidateDate, professorTimeZone);
      if (!professorDate) continue;
      if (weekdayInTimeZone(candidateDate, professorTimeZone) !== configuredSlot.weekday) continue;
      const professorStartAt = zonedDateTimeToUtcIso({
        date: professorDate,
        time: configuredSlot.professor_time,
        timeZone: professorTimeZone,
      });
      if (!professorStartAt) continue;
      const startMs = new Date(professorStartAt).getTime();
      if (!Number.isFinite(startMs) || startMs <= now.getTime()) continue;
      if (
        startAtConflicts({
          professorStartAt,
          occupiedIntervals,
          professorPhoneDigits,
        })
      ) {
        continue;
      }
      nextProfessorStartAt = professorStartAt;
      nextProfessorDate = professorDate;
      break;
    }

    if (!nextProfessorStartAt) continue;

    const members: ExperimentalGroupClassMemberSummary[] = pairMembers.map((row) => ({
      id: row.id,
      lead_id: row.id,
      full_name: row.full_name,
      phone: row.phone,
      status: "assigned",
      student_notification_sent_at: null,
    }));

    slots.push({
      id: `recurring-${pairId}`,
      group_class_id: null,
      pair_id: pairId,
      slot_type: "recorrente",
      professor_name: assignedProfessor.name ?? null,
      professor_phone: assignedProfessor.phone ?? null,
      professor_timezone: professorTimeZone,
      professor_weekday: configuredSlot.weekday,
      professor_weekday_label: experimentalGroupWeekdayLabel(configuredSlot.weekday),
      professor_date: nextProfessorDate,
      professor_time: configuredSlot.professor_time,
      professor_start_at: nextProfessorStartAt,
      lead_timezone: leadTimeZone,
      lead_date: localDateInTimeZone(nextProfessorStartAt, leadTimeZone),
      lead_time: formatTimeInTimeZone(nextProfessorStartAt, leadTimeZone),
      capacity,
      occupied_seats: occupiedSeats,
      available_seats: availableSeats,
      status: isCurrentLeadAssigned ? "assigned" : "draft",
      lesson_link: null,
      confirmed_at: null,
      members,
      is_full: !isCurrentLeadAssigned && availableSeats <= 0,
      is_current_lead_assigned: isCurrentLeadAssigned,
    });
  }

  return slots.sort(
    (left, right) =>
      new Date(left.professor_start_at).getTime() -
      new Date(right.professor_start_at).getTime(),
  );
}
