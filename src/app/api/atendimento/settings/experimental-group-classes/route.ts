import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadRecurringCalendarOccupiedIntervals,
  requireAtendimentoUser,
} from "@/lib/atendimento/server";
import {
  buildExperimentalGroupPairActivitySummary,
  buildExperimentalGroupPairUsage,
  listAssignedRecurringGroupMembers,
  listExperimentalGroupClasses,
  listFutureExperimentalGroupClasses,
  loadExperimentalGroupClassSettings,
  saveExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import {
  experimentalGroupWeekdayLabel,
  normalizeExperimentalGroupClassSettings,
  resolveExperimentalGroupPairIdForClass,
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

function canonicalizeExperimentalGroupPairSettings(
  settings: ExperimentalGroupClassSettings,
): ExperimentalGroupClassSettings {
  const grouped = new Map<
    string,
    {
      experimental: ExperimentalGroupClassSettings["slots"][number] | null;
      recurring: ExperimentalGroupClassSettings["slots"][number] | null;
    }
  >();
  for (const slot of settings.slots) {
    const pairId = String(slot.pair_id ?? "").trim();
    if (!pairId) continue;
    const current = grouped.get(pairId) ?? { experimental: null, recurring: null };
    if (slot.slot_type === "recorrente") {
      current.recurring = slot;
    } else {
      current.experimental = slot;
    }
    grouped.set(pairId, current);
  }

  const normalizedSlots = Array.from(grouped.entries())
    .sort((left, right) => left[0].localeCompare(right[0], "pt-BR", { numeric: true }))
    .flatMap(([pairId, pair]) => {
      const source = pair.experimental ?? pair.recurring;
      if (!source) return [];
      const sharedValues = {
        enabled: Boolean(source.enabled),
        weekday: source.weekday ?? null,
        professor_time: source.professor_time ?? null,
        professor_name: source.professor_name ?? null,
        professor_phone: source.professor_phone ?? null,
        pair_id: pairId,
      };
      return [
        {
          ...sharedValues,
          slot_type: "experimental" as const,
        },
        {
          ...sharedValues,
          slot_type: "recorrente" as const,
        },
      ];
    });

  return normalizeExperimentalGroupClassSettings({
    ...settings,
    slots: normalizedSlots,
  });
}

function isPairSlotAvailableForProfessor(params: {
  availability: Awaited<ReturnType<typeof buildExperimentalGroupAvailability>> | null | undefined;
  weekday: string | null | undefined;
  professorTime: string | null | undefined;
}) {
  const weekday = String(params.weekday ?? "").trim().toLowerCase();
  const professorTime = String(params.professorTime ?? "").trim();
  const dates = Array.isArray(params.availability?.dates) ? params.availability!.dates : [];
  if (!weekday || !professorTime || !dates.length) return false;
  return dates.some((dateOption) => {
    const slots = Array.isArray(params.availability?.slotsByDate?.[String(dateOption.id ?? "").trim()])
      ? params.availability!.slotsByDate[String(dateOption.id ?? "").trim()]
      : [];
    const matchingWeekday = slots[0]?.weekday ?? "";
    if (String(matchingWeekday).trim().toLowerCase() !== weekday) return false;
    return slots.some(
      (slot: any) => String(slot?.professorTime ?? "").trim() === professorTime,
    );
  });
}

function isCurrentPairScheduleAlreadyReserved(params: {
  slot: ExperimentalGroupClassSettings["slots"][number];
  currentSettings: ExperimentalGroupClassSettings;
  futureGroupClasses: ExperimentalGroupClassRecord[];
}) {
  const pairId = String(params.slot.pair_id ?? "").trim();
  const weekday = String(params.slot.weekday ?? "").trim().toLowerCase();
  const professorTime = String(params.slot.professor_time ?? "").trim();
  const professorPhoneDigits = String(params.slot.professor_phone ?? "").replace(/\D/g, "");
  if (!pairId || !weekday || !professorTime) return false;

  const currentSlot = params.currentSettings.slots.find((slot) => {
    if (slot.slot_type !== "experimental") return false;
    if (String(slot.pair_id ?? "").trim() !== pairId) return false;
    return (
      String(slot.weekday ?? "").trim().toLowerCase() === weekday &&
      String(slot.professor_time ?? "").trim() === professorTime &&
      String(slot.professor_phone ?? "").replace(/\D/g, "") === professorPhoneDigits
    );
  });
  if (currentSlot) return true;

  return params.futureGroupClasses.some((groupClass) => {
    const classPairId = resolveExperimentalGroupPairIdForClass({
      settings: params.currentSettings,
      groupClass,
    });
    if (String(classPairId ?? "").trim() !== pairId) return false;
    return (
      String(groupClass.professor_weekday ?? "").trim().toLowerCase() === weekday &&
      String(groupClass.professor_time ?? "").trim() === professorTime &&
      String(groupClass.professor_phone ?? "").replace(/\D/g, "") === professorPhoneDigits
    );
  });
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
    const recentGroupClasses = await listExperimentalGroupClasses({
      admin,
      fromIso: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      ascending: false,
      limit: 200,
    });
    const pairUsage = buildExperimentalGroupPairUsage({
      settings,
      futureGroupClasses,
      recurringMembers,
    });
    const pairActivity = buildExperimentalGroupPairActivitySummary({
      settings,
      groupClasses: recentGroupClasses,
    });

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
      pair_usage: pairUsage,
      pair_activity: pairActivity,
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

    const settings = canonicalizeExperimentalGroupPairSettings(
      normalizeExperimentalGroupClassSettings(parsed.data),
    );
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
    const availabilityByProfessor = await buildExperimentalGroupAvailabilityByProfessor(
      admin,
      futureGroupClasses,
    );
    const enabledExperimentalPairs = settings.slots.filter(
      (slot) => slot.slot_type === "experimental" && slot.enabled,
    );
    for (const [index, slot] of enabledExperimentalPairs.entries()) {
      if (!slot.professor_phone || !slot.professor_name) {
        return Response.json(
          { ok: false, error: `Selecione o professor da turma ${index + 1}.` },
          { status: 400 },
        );
      }
      if (!slot.weekday || !slot.professor_time) {
        return Response.json(
          { ok: false, error: `Configure dia e horario na turma ${index + 1}.` },
          { status: 400 },
        );
      }
      const availability =
        availabilityByProfessor[String(slot.professor_phone ?? "").trim()] ?? null;
      if (
        !isPairSlotAvailableForProfessor({
          availability,
          weekday: slot.weekday,
          professorTime: slot.professor_time,
        }) &&
        !isCurrentPairScheduleAlreadyReserved({
          slot,
          currentSettings: currentSettingsResult.settings,
          futureGroupClasses,
        })
      ) {
        return Response.json(
          {
            ok: false,
            error: `A turma ${index + 1} precisa usar um dia e horario realmente disponiveis na agenda do professor.`,
          },
          { status: 400 },
        );
      }
    }
    const currentPairUsage = buildExperimentalGroupPairUsage({
      settings: currentSettingsResult.settings,
      futureGroupClasses,
      recurringMembers: await listAssignedRecurringGroupMembers({ admin }),
    });
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
    const pairUsage = buildExperimentalGroupPairUsage({
      settings,
      futureGroupClasses,
      recurringMembers: await listAssignedRecurringGroupMembers({ admin }),
    });
    const pairActivity = buildExperimentalGroupPairActivitySummary({
      settings,
      groupClasses: await listExperimentalGroupClasses({
        admin,
        fromIso: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        ascending: false,
        limit: 200,
      }),
    });

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
      pair_usage: pairUsage,
      pair_activity: pairActivity,
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
