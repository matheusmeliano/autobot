import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadRecurringCalendarOccupiedIntervals,
  requireAtendimentoUser,
} from "@/lib/atendimento/server";
import {
  listFutureExperimentalGroupClasses,
  loadExperimentalGroupClassSettings,
  saveExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import {
  experimentalGroupWeekdayLabel,
  normalizeExperimentalGroupClassSettings,
  type ExperimentalGroupWeekdayKey,
} from "@/lib/atendimento/experimentalGroupClass";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { listExperimentalClassAvailability } from "@/lib/atendimento/experimentalClass";

const weekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

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
      }),
    )
    .length(4),
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
}): Promise<string[]> {
  try {
    const { data, error } = await params.admin
      .from("atendimento_experimental_class_bookings")
      .select("professor_start_at, status")
      .not("professor_start_at", "is", null)
      .gte("professor_start_at", params.fromIso);
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return (data ?? [])
      .filter((row: any) => {
        const status = String(row?.status ?? "").trim().toLowerCase();
        return status !== "cancelled" && status !== "completed";
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
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const individualStarts = await listScheduledIndividualExperimentalProfessorStarts({
    admin,
    fromIso: nowIso,
  });
  const futureGroupClasses = await listFutureExperimentalGroupClasses({
    admin,
    fromIso: nowIso,
  });
  const groupStarts = futureGroupClasses
    .map((row) => String(row.professor_start_at ?? "").trim())
    .filter(Boolean);
  const occupiedIntervals = (await loadRecurringCalendarOccupiedIntervals({
    admin,
    now,
    lookAheadWeeks: 8,
  }))
    .filter((interval) => interval.source === "recurring_schedule")
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

export async function GET() {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();
    const { settings, updatedAt } = await loadExperimentalGroupClassSettings({ admin });
    const availability = await buildExperimentalGroupAvailability(admin);

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
      availability,
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

    const settings = normalizeExperimentalGroupClassSettings(parsed.data);
    const activeCombinations = settings.slots
      .filter((slot) => slot.enabled && slot.weekday && slot.professor_time)
      .map((slot) => `${slot.weekday}-${slot.professor_time}`);
    if (new Set(activeCombinations).size !== activeCombinations.length) {
      return Response.json(
        { ok: false, error: "Nao repita a mesma combinacao de dia e horario entre as turmas." },
        { status: 400 },
      );
    }
    const admin = createSupabaseAdminClient();
    const updatedAt = await saveExperimentalGroupClassSettings({ admin, settings });
    const availability = await buildExperimentalGroupAvailability(admin);

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
      availability,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
