import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  buildExperimentalGroupClassSlotsForLead,
  buildRecurringGroupClassSlotsForLead,
  loadExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import { resolveLeadTimeZoneFromRecord } from "@/lib/timezone";

export const runtime = "nodejs";

const schema = z.object({
  lead_id: z.string().trim().uuid(),
  group_class_id: z.string().trim().uuid().nullable().optional(),
  professor_start_at: z.string().trim().datetime().optional(),
  pair_id: z.string().trim().min(1).nullable().optional(),
  slot_type: z.enum(["experimental", "recorrente"]).optional(),
});

function isLeadRecurringStudent(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const payStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const leadStatusRaw = String((lead as any)?.status ?? "").trim().toLowerCase();
  const funnelRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  return (
    payStatusRaw === "confirmado" ||
    payStatusRaw === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    leadStatusRaw === "matriculado" ||
    leadStatusRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    funnelRaw === "matricula_confirmada" ||
    Boolean(String((lead as any)?.enrollment_number ?? "").trim())
  );
}

function leadHasStateAndCity(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  return Boolean(stateRaw && cityRaw);
}

function isMissingExperimentalBookingRelation(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(
      message,
    )
  );
}

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
    if (!leadHasStateAndCity(lead as any)) {
      return Response.json(
        {
          ok: false,
          error: "Para atribuir uma turma a este registro, informe primeiro o estado e a cidade.",
        },
        { status: 409 },
      );
    }

    const { settings } = await loadExperimentalGroupClassSettings({ admin });
    if (!settings.enabled) {
      return Response.json(
        { ok: false, error: "A funcionalidade de aulas experimentais em grupo está desativada." },
        { status: 409 },
      );
    }

    const isStudentLead = isLeadRecurringStudent(lead as any);
    const slots = isStudentLead
      ? await buildRecurringGroupClassSlotsForLead({
          admin,
          lead: lead as Record<string, unknown>,
          settings,
          now: new Date(),
          lookAheadDays: 56,
        })
      : await buildExperimentalGroupClassSlotsForLead({
          admin,
          lead: lead as Record<string, unknown>,
          settings,
          now: new Date(),
          lookAheadDays: 42,
          excludeLeadIdFromIndividualBookings: true,
        });

    const targetSlot =
      slots.find(
        (slot) =>
          (parsed.data.slot_type === "recorrente" &&
            parsed.data.pair_id &&
            String(slot.pair_id ?? "").trim() === parsed.data.pair_id) ||
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
    const expectedSlotType = isStudentLead ? "recorrente" : "experimental";
    if (targetSlot.slot_type !== expectedSlotType) {
      return Response.json(
        { ok: false, error: "Este registro só pode ser atribuído ao tipo de turma correspondente." },
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

    const nowIso = new Date().toISOString();
    if (isStudentLead || targetSlot.slot_type === "recorrente") {
      const leadTimeZone = resolveLeadTimeZoneFromRecord({
        lead: lead as Record<string, unknown>,
        fallbackTimeZone:
          String((lead as any)?.recurring_class_lead_timezone ?? (lead as any)?.timezone ?? "").trim() ||
          targetSlot.lead_timezone ||
          targetSlot.professor_timezone,
      });
      await admin
        .from("atendimento_leads")
        .update({
          recurring_class_group_pair_id: String(targetSlot.pair_id ?? "").trim() || null,
          recurring_class_group_status: "assigned",
          recurring_class_professor_name: targetSlot.professor_name,
          recurring_class_professor_phone: targetSlot.professor_phone,
          recurring_class_weekday: targetSlot.professor_weekday,
          recurring_class_weekday_label: targetSlot.professor_weekday_label,
          recurring_class_professor_time: targetSlot.professor_time,
          recurring_class_lead_time: targetSlot.lead_time || targetSlot.professor_time,
          recurring_class_professor_timezone: targetSlot.professor_timezone,
          recurring_class_lead_timezone: leadTimeZone,
          recurring_class_first_class_at: targetSlot.professor_start_at,
          recurring_class_student_start_notification_sent_at: null,
          recurring_class_attendant_start_notification_sent_at: null,
          updated_at: nowIso,
        })
        .eq("id", leadId);

      await appendHistoryEvent({
        leadId,
        conversationId: String((latestConversation as any)?.id ?? "").trim() || null,
        eventType: "recurring_group_class_assigned",
        title: "Aluno atribuído a uma turma recorrente em grupo",
        details: {
          pair_id: String(targetSlot.pair_id ?? "").trim() || null,
          professor_name: targetSlot.professor_name,
          professor_phone: targetSlot.professor_phone,
          professor_weekday: targetSlot.professor_weekday,
          professor_time: targetSlot.professor_time,
          professor_start_at: targetSlot.professor_start_at,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });

      return Response.json({
        ok: true,
        pair_id: String(targetSlot.pair_id ?? "").trim() || null,
      });
    }

    try {
      const { error: cancelBookingError } = await admin
        .from("atendimento_experimental_class_bookings")
        .update({
          status: "cancelled",
          updated_at: nowIso,
        })
        .eq("lead_id", leadId)
        .in("status", ["scheduled", "booked", "confirmed", "in_progress"]);
      if (cancelBookingError && !isMissingExperimentalBookingRelation(cancelBookingError)) {
        return Response.json({ ok: false, error: cancelBookingError.message }, { status: 500 });
      }
    } catch (error) {
      if (!isMissingExperimentalBookingRelation(error)) {
        return Response.json(
          { ok: false, error: String((error as any)?.message ?? error ?? "erro interno") },
          { status: 500 },
        );
      }
    }

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
    await admin
      .from("atendimento_leads")
      .update({
        experimental_class_mode_preference: "group",
        experimental_class_group_interest: true,
        experimental_class_group_interest_at:
          String((lead as any)?.experimental_class_group_interest_at ?? "").trim() || nowIso,
        experimental_class_group_class_id: groupClassId || null,
        experimental_class_group_status: "assigned",
        experimental_class_status: "scheduled",
        experimental_class_professor_date: targetSlot.professor_date || null,
        experimental_class_professor_time: targetSlot.professor_time || null,
        experimental_class_professor_start_at: targetSlot.professor_start_at || null,
        experimental_class_lead_date: targetSlot.lead_date || null,
        experimental_class_lead_time: targetSlot.lead_time || targetSlot.professor_time || null,
        experimental_class_lead_start_at: targetSlot.professor_start_at || null,
        experimental_class_professor_name: targetSlot.professor_name,
        experimental_class_professor_phone: targetSlot.professor_phone,
        experimental_class_booking_id: null,
        experimental_class_link: null,
        experimental_class_student_notification_sent_at: null,
        experimental_class_attendant_notification_sent_at: null,
        experimental_class_registered_attendant_notification_sent_at: null,
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
