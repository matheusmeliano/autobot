import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getDefaultExperimentalGroupClassSettings,
  listExperimentalGroupClassSlots,
  normalizeExperimentalGroupClassSettings,
  resolveExperimentalGroupProfessorFromLead,
  type ExperimentalGroupClassRecord,
  type ExperimentalGroupClassSettings,
  type ExperimentalGroupClassMemberSummary,
  type ExperimentalGroupSlotSummary,
} from "./experimentalGroupClass";
import { loadRecurringCalendarOccupiedIntervals } from "./server";

export const EXPERIMENTAL_GROUP_CLASS_SETTINGS_KEY =
  "experimental_group_classes_settings";

function isMissingRelationError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /could not find the table .* in the schema cache/i.test(message)
  );
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
