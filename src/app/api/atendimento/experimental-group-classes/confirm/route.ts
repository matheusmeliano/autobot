import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendHistoryEvent,
  requireAtendimentoUser,
  sendAtendimentoWhatsAppText,
} from "@/lib/atendimento/server";
import {
  buildExperimentalGroupClassConfirmationMessage,
} from "@/lib/atendimento/experimentalGroupClass";
import { resolveLeadTimeZoneFromRecord } from "@/lib/timezone";

export const runtime = "nodejs";

const schema = z.object({
  group_class_id: z.string().trim().uuid(),
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
    const nowIso = new Date().toISOString();
    const groupClassId = parsed.data.group_class_id;

    const { data: groupClass, error: groupClassError } = await admin
      .from("atendimento_experimental_group_classes")
      .select("*")
      .eq("id", groupClassId)
      .maybeSingle();

    if (groupClassError) {
      return Response.json({ ok: false, error: groupClassError.message }, { status: 500 });
    }
    if (!groupClass?.id) {
      return Response.json({ ok: false, error: "group_class_not_found" }, { status: 404 });
    }

    const { data: members, error: membersError } = await admin
      .from("atendimento_experimental_group_class_members")
      .select("*")
      .eq("group_class_id", groupClassId)
      .eq("status", "assigned")
      .order("created_at", { ascending: true });

    if (membersError) {
      return Response.json({ ok: false, error: membersError.message }, { status: 500 });
    }

    const memberRows = Array.isArray(members) ? (members as any[]) : [];
    if (!memberRows.length) {
      return Response.json(
        { ok: false, error: "A turma precisa ter pelo menos um aluno atribuído." },
        { status: 409 },
      );
    }

    const leadIds = memberRows
      .map((row) => String(row?.lead_id ?? "").trim())
      .filter(Boolean);
    const { data: leads, error: leadsError } = await admin
      .from("atendimento_leads")
      .select("*")
      .in("id", leadIds);

    if (leadsError) {
      return Response.json({ ok: false, error: leadsError.message }, { status: 500 });
    }

    const leadsById = new Map<string, any>();
    for (const lead of leads ?? []) {
      const leadId = String((lead as any)?.id ?? "").trim();
      if (!leadId) continue;
      leadsById.set(leadId, lead);
    }

    await admin
      .from("atendimento_experimental_group_classes")
      .update({
        status: "confirmed",
        confirmed_at: String((groupClass as any)?.confirmed_at ?? "").trim() || nowIso,
        updated_at: nowIso,
      })
      .eq("id", groupClassId);

    let sentCount = 0;
    const errors: Array<{ lead_id: string; error: string }> = [];

    for (const member of memberRows) {
      const leadId = String((member as any)?.lead_id ?? "").trim();
      const lead = leadsById.get(leadId);
      if (!lead) continue;
      const leadPhone = String((lead as any)?.phone ?? "").trim();
      const conversationId = String((member as any)?.conversation_id ?? "").trim() || null;
      const leadTimeZone = resolveLeadTimeZoneFromRecord({
        lead,
        fallbackTimeZone: String((groupClass as any)?.professor_timezone ?? "").trim() || null,
      });
      const message = buildExperimentalGroupClassConfirmationMessage({
        leadName: String((lead as any)?.full_name ?? "").trim() || null,
        professorName: String((groupClass as any)?.professor_name ?? "").trim() || null,
        professorStartAt: String((groupClass as any)?.professor_start_at ?? "").trim(),
        leadTimeZone,
        professorTimeZone:
          String((groupClass as any)?.professor_timezone ?? "").trim() || null,
      });

      if (
        !String((member as any)?.student_notification_sent_at ?? "").trim() &&
        leadPhone
      ) {
        try {
          await sendAtendimentoWhatsAppText({
            phone: leadPhone,
            message,
            allowNoInbound: true,
          });
          await admin
            .from("atendimento_experimental_group_class_members")
            .update({
              student_notification_sent_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", String((member as any)?.id ?? ""));
          sentCount += 1;
        } catch (error: any) {
          errors.push({
            lead_id: leadId,
            error: String(error?.message ?? error ?? "Falha ao enviar WhatsApp"),
          });
        }
      }

      const professorStartAt = String((groupClass as any)?.professor_start_at ?? "").trim();
      const leadDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: leadTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(professorStartAt));
      const leadTime = new Intl.DateTimeFormat("pt-BR", {
        timeZone: leadTimeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(professorStartAt));

      await admin
        .from("atendimento_leads")
        .update({
          funnel_stage: "aula_experimental_agendada",
          experimental_class_mode_preference: "group",
          experimental_class_group_interest: true,
          experimental_class_group_interest_at:
            String((lead as any)?.experimental_class_group_interest_at ?? "").trim() || nowIso,
          experimental_class_group_class_id: groupClassId,
          experimental_class_group_status: "confirmed",
          experimental_class_status: "scheduled",
          experimental_class_professor_date:
            String((groupClass as any)?.professor_date ?? "").trim() || null,
          experimental_class_professor_time:
            String((groupClass as any)?.professor_time ?? "").trim() || null,
          experimental_class_professor_start_at: professorStartAt || null,
          experimental_class_lead_date: leadDate || null,
          experimental_class_lead_time: leadTime || null,
          experimental_class_lead_start_at: professorStartAt || null,
          experimental_class_professor_name:
            String((groupClass as any)?.professor_name ?? "").trim() || null,
          experimental_class_professor_phone:
            String((groupClass as any)?.professor_phone ?? "").trim() || null,
          updated_at: nowIso,
        })
        .eq("id", leadId);

      if (conversationId) {
        await admin
          .from("atendimento_conversations")
          .update({ bot_enabled: false, updated_at: nowIso })
          .eq("id", conversationId);
      }

      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_group_class_confirmed",
        title: "Turma de aula experimental em grupo confirmada",
        details: {
          group_class_id: groupClassId,
          professor_name: String((groupClass as any)?.professor_name ?? "").trim() || null,
          professor_phone: String((groupClass as any)?.professor_phone ?? "").trim() || null,
          professor_date: String((groupClass as any)?.professor_date ?? "").trim() || null,
          professor_time: String((groupClass as any)?.professor_time ?? "").trim() || null,
          professor_start_at: professorStartAt || null,
          lead_date: leadDate || null,
          lead_time: leadTime || null,
          lead_timezone: leadTimeZone,
          student_notification_sent: !errors.some((entry) => entry.lead_id === leadId),
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });
    }

    return Response.json({
      ok: true,
      sent_count: sentCount,
      errors,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
