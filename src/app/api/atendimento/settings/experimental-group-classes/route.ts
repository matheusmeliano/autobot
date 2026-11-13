import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
} from "@/lib/atendimento/experimentalClass";
import {
  buildExperimentalGroupClassSlotsForLead,
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
  enabled: z.boolean(),
  professor_name: z.string().trim().min(1).max(120),
  professor_phone: z.string().trim().min(1).max(40),
  slots: z
    .array(
      z.object({
        weekday: weekdaySchema,
        professor_time: z.string().trim().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .length(2),
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
    const previewSlots = await buildExperimentalGroupClassSlotsForLead({
      admin,
      lead: null,
      settings,
      now: new Date(),
      lookAheadDays: 28,
    });

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      professor_options: EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
      weekday_options: buildWeekdayOptions(),
      preview_slots: previewSlots.slice(0, 8),
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
    const uniqueWeekdays = new Set(settings.slots.map((slot) => slot.weekday));
    if (uniqueWeekdays.size !== settings.slots.length) {
      return Response.json(
        { ok: false, error: "Escolha dois dias diferentes da semana." },
        { status: 400 },
      );
    }
    if (!settings.professor_name || !settings.professor_phone) {
      return Response.json(
        { ok: false, error: "Professor inválido para aulas experimentais em grupo." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const updatedAt = await saveExperimentalGroupClassSettings({ admin, settings });
    const previewSlots = await buildExperimentalGroupClassSlotsForLead({
      admin,
      lead: null,
      settings,
      now: new Date(),
      lookAheadDays: 28,
    });

    return Response.json({
      ok: true,
      settings,
      updated_at: updatedAt,
      professor_options: EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
      weekday_options: buildWeekdayOptions(),
      preview_slots: previewSlots.slice(0, 8),
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
