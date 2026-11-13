import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  buildExperimentalGroupClassSlotsForLead,
  loadExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";

export const runtime = "nodejs";

const schema = z.object({
  lead_id: z.string().trim().uuid(),
  group_class_id: z.string().trim().uuid().nullable().optional(),
  professor_start_at: z.string().trim().datetime().optional(),
});

export async function POST(req: Request) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const leadId = parsed.data.lead_id;
    const { data: lead, error: leadError } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle();

    if (leadError) {
      return Response.json({ ok: false, error: leadError.message }, { status: 500 });
    }
    if (!lead?.id) {
      return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
    }

    const { settings } = await loadExperimentalGroupClassSettings({ admin });
    if (!settings.enabled) {
      return Response.json(
        { ok: false, error: "A funcionalidade de aulas experimentais em grupo está desativada." },
        { status: 409 },
      );
    }

    const slots = await buildExperimentalGroupClassSlotsForLead({
      admin,
      lead: lead as Record<string, unknown>,
      settings,
      now: new Date(),
      lookAheadDays: 42,
      excludeLeadIdFromIndividualBookings: false,
    });

    const targetSlot =
      slots.find(
        (slot) =>
          (parsed.data.group_class_id &&
            String(slot.group_class_id ?? "").trim() === parsed.data.group_class_id) ||
          (parsed.data.professor_start_at &&
            String(slot.professor_start_at ?? "").trim() === parsed.data.professor_start_at),
      ) ?? null;

    if (!targetSlot) {
      return Response.json(
        { ok: false, error: "A turma selecionada não está mais disponível." },
        { status: 409 },
      );
    }

    if (targetSlot.is_full && !targetSlot.is_current_lead_assigned) {
      return Response.json(
        { ok: false, error: "A turma selecionada já está completa." },
        { status: 409 },
      );
    }

    const { data: latestConversation } = await admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const rpcResult = await admin.rpc("assign_atendimento_experimental_group_member", {
      p_lead_id: leadId,
      p_conversation_id: String((latestConversation as any)?.id ?? "").trim() || null,
      p_professor_name: targetSlot.professor_name,
      p_professor_phone: targetSlot.professor_phone,
      p_professor_timezone: targetSlot.professor_timezone,
      p_professor_weekday: targetSlot.professor_weekday,
      p_professor_date: targetSlot.professor_date,
      p_professor_time: targetSlot.professor_time,
      p_professor_start_at: targetSlot.professor_start_at,
      p_capacity: targetSlot.capacity,
    });

    if (rpcResult.error) {
      const message = String(rpcResult.error.message ?? "");
      if (message.includes("group_class_full")) {
        return Response.json(
          { ok: false, error: "A turma selecionada acabou de ficar lotada." },
          { status: 409 },
        );
      }
      if (message.includes("lead_already_assigned_to_other_group")) {
        return Response.json(
          { ok: false, error: "Este registro já está atribuído a outra turma." },
          { status: 409 },
        );
      }
      return Response.json({ ok: false, error: rpcResult.error.message }, { status: 500 });
    }

    const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : (rpcResult.data as any);
    const groupClassId = String((rpcRow as any)?.group_class_id ?? "").trim();
    const nowIso = new Date().toISOString();
    await admin
      .from("atendimento_leads")
      .update({
        experimental_class_mode_preference: "group",
        experimental_class_group_interest: true,
        experimental_class_group_interest_at:
          String((lead as any)?.experimental_class_group_interest_at ?? "").trim() || nowIso,
        experimental_class_group_class_id: groupClassId || null,
        experimental_class_group_status: "assigned",
        updated_at: nowIso,
      })
      .eq("id", leadId);

    await appendHistoryEvent({
      leadId,
      conversationId: String((latestConversation as any)?.id ?? "").trim() || null,
      eventType: "experimental_group_class_assigned",
      title: "Registro atribuído a uma turma de aula experimental em grupo",
      details: {
        group_class_id: groupClassId || null,
        professor_name: targetSlot.professor_name,
        professor_phone: targetSlot.professor_phone,
        professor_date: targetSlot.professor_date,
        professor_time: targetSlot.professor_time,
        professor_start_at: targetSlot.professor_start_at,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    return Response.json({
      ok: true,
      group_class_id: groupClassId || null,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
