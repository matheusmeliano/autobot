import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  loadExperimentalGroupClassSettings,
  saveExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import {
  experimentalGroupWeekdayLabel,
  normalizeExperimentalGroupClassSettings,
  type ExperimentalGroupWeekdayKey,
} from "@/lib/atendimento/experimentalGroupClass";

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

export async function GET() {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();
    const { settings, updatedAt } = await loadExperimentalGroupClassSettings({ admin });

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
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

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      weekday_options: buildWeekdayOptions(),
      preview_slots: [],
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
