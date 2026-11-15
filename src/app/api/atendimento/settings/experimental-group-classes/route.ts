import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadRecurringCalendarOccupiedIntervals,
  requireAtendimentoUser,
} from "@/lib/atendimento/server";
import {
  listAssignedRecurringGroupMembers,
  listFutureExperimentalGroupClasses,
  loadExperimentalGroupClassSettings,
  saveExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import {
  experimentalGroupWeekdayLabel,
  normalizeExperimentalGroupClassSettings,
  type ExperimentalGroupClassRecord,
  type ExperimentalGroupClassSettings,
  type ExperimentalGroupWeekdayKey,
} from "@/lib/atendimento/experimentalGroupClass";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import {
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
  listExperimentalClassAvailability,
} from "@/lib/atendimento/experimentalClass";

const weekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const slotTypeSchema = z.enum(["experimental", "recorrente"]);

const schema = z.object({
  slots: z
    .array(
      z.object({
        enabled: z.boolean(),
        weekday: weekdaySchema.nullable().optional(),
        professor_time: z
          .string()
          .trim()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        professor_name: z.string().trim().nullable().optional(),
        professor_phone: z.string().trim().nullable().optional(),
        slot_type: slotTypeSchema.optional(),
        pair_id: z.string().trim().min(1).optional(),
      }),
    )
    .min(2),
});

function buildWeekdayOptions() {
  return (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as ExperimentalGroupWeekdayKey[]).map(
    (weekday) => ({
      value: weekday,
      label: experimentalGroupWeekdayLabel(weekday),
    }),
  );
}

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

async function listScheduledIndividualExperimentalProfessorStarts(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  fromIso: string;
  professorPhone?: string | null;
}): Promise<string[]> {
  try {
    const { data, error } = await params.admin
      .from("atendimento_experimental_class_bookings")
      .select("professor_start_at, status, assigned_professor_phone")
      .not("professor_start_at", "is", null)
      .gte("professor_start_at", params.fromIso);
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    const targetPhoneDigits = String(params.professorPhone ?? "").replace(/\D/g, "");
    return (data ?? [])
      .filter((row: any) => {
        const status = String(row?.status ?? "").trim().toLowerCase();
        if (status === "cancelled" || status === "completed") return false;
        if (!targetPhoneDigits) return true;
        const rowPhoneDigits = String(row?.assigned_professor_phone ?? "").replace(/\D/g, "");
        return rowPhoneDigits === targetPhoneDigits;
      })
      .map((row: any) => String(row?.professor_start_at ?? "").trim())
      .filter(Boolean);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

async function buildExperimentalGroupAvailability(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  futureGroupClasses?: ExperimentalGroupClassRecord[],
  professorPhone?: string | null,
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const individualStarts = await listScheduledIndividualExperimentalProfessorStarts({
    admin,
    fromIso: nowIso,
    professorPhone,
  });
  const targetPhoneDigits = String(professorPhone ?? "").replace(/\D/g, "");
  const effectiveFutureGroupClasses =
    futureGroupClasses ??
    (await listFutureExperimentalGroupClasses({
      admin,
      fromIso: nowIso,
    }));
  const groupStarts = effectiveFutureGroupClasses
    .filter((row) => {
      if (!targetPhoneDigits) return true;
      return String(row.professor_phone ?? "").replace(/\D/g, "") === targetPhoneDigits;
    })
    .map((row) => String(row.professor_start_at ?? "").trim())
    .filter(Boolean);
  const occupiedIntervals = (await loadRecurringCalendarOccupiedIntervals({
    admin,
    now,
    lookAheadWeeks: 8,
  }))
    .filter((interval) => {
      if (interval.source !== "recurring_schedule") return false;
      if (!targetPhoneDigits) return true;
      return String((interval as any)?.professor_phone_digits ?? "").trim() === targetPhoneDigits;
    })
    .map((interval) => ({
      startAt: interval.start_at,
      endAt: interval.end_at,
    }));
  const availability = listExperimentalClassAvailability({
    now,
    leadTimeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
    bookedProfessorStartAts: [...individualStarts, ...groupStarts],
    occupiedIntervals,
  });
  const slotsByDate: Record<string, any[]> = {};
  availability.slotsByProfessorDate.forEach((value, key) => {
    slotsByDate[String(key)] = value;
  });
  return {
    dates: availability.dates,
    slotsByDate,
    professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
  };
}

async function buildExperimentalGroupAvailabilityByProfessor(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  futureGroupClasses?: ExperimentalGroupClassRecord[],
) {
  const result: Record<string, Awaited<ReturnType<typeof buildExperimentalGroupAvailability>>> = {};
  for (const professor of EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST) {
    result[professor.phone] = await buildExperimentalGroupAvailability(
      admin,
      futureGroupClasses,
      professor.phone,
    );
  }
  return result;
}

function buildExperimentalGroupPairUsage(
  settings: ExperimentalGroupClassSettings,
  futureGroupClasses: ExperimentalGroupClassRecord[],
  recurringMembers: Array<{
    id: string;
    full_name: string | null;
    phone: string | null;
    recurring_class_group_pair_id: string | null;
  }>,
) {
  const usage: Record<
    string,
    {
      assigned_count: number;
      has_assigned_members: boolean;
      members: Array<{
        id: string;
        lead_id: string;
        full_name: string | null;
        phone: string | null;
      }>;
    }
  > = {};

  const experimentalSlots = settings.slots.filter(
    (slot) => slot.slot_type === "experimental" && slot.weekday && slot.professor_time,
  );

  for (const slot of experimentalSlots) {
    usage[String(slot.pair_id ?? "").trim()] = {
      assigned_count: 0,
      has_assigned_members: false,
      members: [],
    };
  }

  for (const groupClass of futureGroupClasses) {
    const assignedCount = (groupClass.members ?? []).filter(
      (member) => String(member.status ?? "").trim().toLowerCase() === "assigned",
    ).length;
    if (assignedCount <= 0) continue;

    const matchingSlot = experimentalSlots.find(
      (slot) =>
        slot.weekday === groupClass.professor_weekday &&
        slot.professor_time === groupClass.professor_time,
    );
    if (!matchingSlot) continue;

    const pairId = String(matchingSlot.pair_id ?? "").trim();
    if (!pairId) continue;

    const current = usage[pairId] ?? {
      assigned_count: 0,
      has_assigned_members: false,
      members: [],
    };
    current.assigned_count += assignedCount;
    current.has_assigned_members = current.assigned_count > 0;
    for (const member of groupClass.members ?? []) {
      if (String(member.status ?? "").trim().toLowerCase() !== "assigned") continue;
      const leadId = String(member.lead_id ?? "").trim();
      if (!leadId) continue;
      if (current.members.some((currentMember) => currentMember.lead_id === leadId)) continue;
      current.members.push({
        id: String(member.id ?? "").trim(),
        lead_id: leadId,
        full_name: member.full_name ?? null,
        phone: member.phone ?? null,
      });
    }
    usage[pairId] = current;
  }

  for (const member of recurringMembers) {
    const pairId = String(member.recurring_class_group_pair_id ?? "").trim();
    if (!pairId) continue;
    const current = usage[pairId] ?? {
      assigned_count: 0,
      has_assigned_members: false,
      members: [],
    };
    current.assigned_count += 1;
    current.has_assigned_members = current.assigned_count > 0;
    if (!current.members.some((currentMember) => currentMember.lead_id === member.id)) {
      current.members.push({
        id: member.id,
        lead_id: member.id,
        full_name: member.full_name,
        phone: member.phone,
      });
    }
    usage[pairId] = current;
  }

  return usage;
}

export async function GET() {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();
    const { settings, updatedAt } = await loadExperimentalGroupClassSettings({ admin });
    const futureGroupClasses = await listFutureExperimentalGroupClasses({
      admin,
      fromIso: new Date().toISOString(),
    });
    const recurringMembers = await listAssignedRecurringGroupMembers({ admin });
    const availability = await buildExperimentalGroupAvailability(admin, futureGroupClasses);
    const availabilityByProfessor = await buildExperimentalGroupAvailabilityByProfessor(
      admin,
      futureGroupClasses,
    );
    const pairUsage = buildExperimentalGroupPairUsage(
      settings,
      futureGroupClasses,
      recurringMembers,
    );

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
      pair_usage: pairUsage,
      availability,
      availability_by_professor: availabilityByProfessor,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }
    if (parsed.data.slots.length % 2 !== 0) {
      return Response.json({ ok: false, error: "invalid_slot_pairs" }, { status: 400 });
    }

    const settings = normalizeExperimentalGroupClassSettings(parsed.data);
    const activeCombinations = settings.slots
      .filter(
        (slot) =>
          slot.slot_type === "experimental" &&
          slot.enabled &&
          slot.weekday &&
          slot.professor_time,
      )
      .map(
        (slot) =>
          `${String(slot.professor_phone ?? "").replace(/\D/g, "")}-${slot.weekday}-${slot.professor_time}`,
      );
    if (new Set(activeCombinations).size !== activeCombinations.length) {
      return Response.json(
        { ok: false, error: "Nao repita a mesma combinacao de dia e horario entre as turmas." },
        { status: 400 },
      );
    }
    const admin = createSupabaseAdminClient();
    const currentSettingsResult = await loadExperimentalGroupClassSettings({ admin });
    const futureGroupClasses = await listFutureExperimentalGroupClasses({
      admin,
      fromIso: new Date().toISOString(),
    });
    const currentPairUsage = buildExperimentalGroupPairUsage(
      currentSettingsResult.settings,
      futureGroupClasses,
      await listAssignedRecurringGroupMembers({ admin }),
    );
    const nextPairIds = new Set(
      settings.slots.map((slot) => String(slot.pair_id ?? "").trim()).filter(Boolean),
    );
    const currentPairIds = Array.from(
      new Set(
        currentSettingsResult.settings.slots
          .map((slot) => String(slot.pair_id ?? "").trim())
          .filter(Boolean),
      ),
    );
    const removedPairWithMembers = currentPairIds.find(
      (pairId) => !nextPairIds.has(pairId) && currentPairUsage[pairId]?.has_assigned_members,
    );
    if (removedPairWithMembers) {
      return Response.json(
        {
          ok: false,
          error: "Nao e possivel excluir uma turma que possui registros atribuidos.",
        },
        { status: 400 },
      );
    }

    const updatedAt = await saveExperimentalGroupClassSettings({ admin, settings });
    const availability = await buildExperimentalGroupAvailability(admin, futureGroupClasses);
    const availabilityByProfessor = await buildExperimentalGroupAvailabilityByProfessor(
      admin,
      futureGroupClasses,
    );
    const pairUsage = buildExperimentalGroupPairUsage(
      settings,
      futureGroupClasses,
      await listAssignedRecurringGroupMembers({ admin }),
    );

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
      pair_usage: pairUsage,
      availability,
      availability_by_professor: availabilityByProfessor,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
