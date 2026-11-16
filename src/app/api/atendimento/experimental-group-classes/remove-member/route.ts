import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";

export const runtime = "nodejs";

const schema = z.object({
  group_class_id: z.string().trim().uuid().nullable().optional(),
  lead_id: z.string().trim().uuid(),
  pair_id: z.string().trim().min(1).nullable().optional(),
  slot_type: z.enum(["experimental", "recorrente"]).optional(),
});

function isMissingExperimentalGroupRelation(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42703" ||
    code === "PGRST204" ||
    /relation .*atendimento_experimental_group_(classes|class_members).*does not exist/i.test(
      message,
    ) ||
    /(recurring_class_(group_pair_id|group_status|weekday|weekday_label|professor_name|professor_phone|professor_time|lead_time|professor_timezone|lead_timezone|first_class_at|student_start_notification_sent_at|attendant_start_notification_sent_at))/i.test(
      message,
    ) &&
      /(column .* does not exist|could not find the '.*' column .* in the schema cache|schema cache)/i.test(
        message,
      ) ||
    /could not find the table .*atendimento_experimental_group_(classes|class_members).* in the schema cache/i.test(
      message,
    )
  );
}

function groupSchemaUnavailableResponse() {
  return Response.json(
    {
      ok: false,
      error:
        "As turmas em grupo ainda não estão disponíveis neste ambiente. Atualize a estrutura do banco e recarregue a página.",
    },
    { status: 409 },
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
    const nowIso = new Date().toISOString();

    if (parsed.data.slot_type === "recorrente" || (!parsed.data.group_class_id && parsed.data.pair_id)) {
      const { data: clearedRecurringLead, error: clearRecurringGroupError } = await admin
        .from("atendimento_leads")
        .update({
          recurring_class_group_pair_id: null,
          recurring_class_group_status: null,
          recurring_class_weekday: null,
          recurring_class_weekday_label: null,
          recurring_class_professor_name: null,
          recurring_class_professor_phone: null,
          recurring_class_professor_time: null,
          recurring_class_lead_time: null,
          recurring_class_professor_timezone: null,
          recurring_class_lead_timezone: null,
          recurring_class_first_class_at: null,
          recurring_class_student_start_notification_sent_at: null,
          recurring_class_attendant_start_notification_sent_at: null,
          updated_at: nowIso,
        })
        .eq("id", parsed.data.lead_id)
        .select("id, recurring_class_group_pair_id, recurring_class_group_status")
        .maybeSingle();
      if (clearRecurringGroupError) {
        if (isMissingExperimentalGroupRelation(clearRecurringGroupError)) {
          return groupSchemaUnavailableResponse();
        }
        return Response.json({ ok: false, error: clearRecurringGroupError.message }, { status: 500 });
      }
      if (
        !clearedRecurringLead?.id ||
        String((clearedRecurringLead as any)?.recurring_class_group_pair_id ?? "").trim() ||
        String((clearedRecurringLead as any)?.recurring_class_group_status ?? "").trim()
      ) {
        return Response.json(
          { ok: false, error: "A turma recorrente não foi removida corretamente do registro." },
          { status: 409 },
        );
      }

      await appendHistoryEvent({
        leadId: parsed.data.lead_id,
        conversationId: null,
        eventType: "recurring_group_class_member_removed",
        title: "Aluno removido de uma turma recorrente em grupo",
        details: {
          pair_id: String(parsed.data.pair_id ?? "").trim() || null,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });

      return Response.json({ ok: true });
    }

    if (!parsed.data.group_class_id) {
      return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const { data: lead, error: leadError } = await admin
      .from("atendimento_leads")
      .select(
        "id, experimental_class_group_class_id, experimental_class_group_status, experimental_class_professor_start_at, experimental_class_professor_date, experimental_class_professor_time, experimental_class_professor_phone",
      )
      .eq("id", parsed.data.lead_id)
      .maybeSingle();

    if (leadError) {
      if (isMissingExperimentalGroupRelation(leadError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: leadError.message }, { status: 500 });
    }

    const leadAssignedGroupClassId =
      String((lead as any)?.experimental_class_group_class_id ?? "").trim() || null;
    const requestedGroupClassId = String(parsed.data.group_class_id ?? "").trim() || null;
    const effectiveGroupClassId = leadAssignedGroupClassId || requestedGroupClassId;

    let member:
      | {
          id: string;
          conversation_id: string | null;
          status: string | null;
          group_class_id?: string | null;
        }
      | null = null;

    let memberError: any = null;
    if (effectiveGroupClassId) {
      const memberResult = await admin
        .from("atendimento_experimental_group_class_members")
        .select("id, conversation_id, status, group_class_id")
        .eq("group_class_id", effectiveGroupClassId)
        .eq("lead_id", parsed.data.lead_id)
        .maybeSingle();
      member = (memberResult.data as any) ?? null;
      memberError = memberResult.error;
    }

    if (memberError) {
      if (isMissingExperimentalGroupRelation(memberError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: memberError.message }, { status: 500 });
    }

    if (!member?.id) {
      const fallbackMemberResult = await admin
        .from("atendimento_experimental_group_class_members")
        .select("id, conversation_id, status, group_class_id")
        .eq("lead_id", parsed.data.lead_id)
        .eq("status", "assigned")
        .maybeSingle();
      if (fallbackMemberResult.error) {
        if (isMissingExperimentalGroupRelation(fallbackMemberResult.error)) {
          return groupSchemaUnavailableResponse();
        }
        return Response.json({ ok: false, error: fallbackMemberResult.error.message }, { status: 500 });
      }
      member = (fallbackMemberResult.data as any) ?? null;
    }

    if (!member?.id) {
      const leadGroupStatus = String((lead as any)?.experimental_class_group_status ?? "").trim().toLowerCase();
      if (!leadGroupStatus || leadGroupStatus === "removed") {
        return Response.json({ ok: false, error: "member_not_found" }, { status: 404 });
      }
    }

    const memberGroupClassId =
      String((member as any)?.group_class_id ?? "").trim() || effectiveGroupClassId;

    if (member?.id) {
      const { error: updateMemberError } = await admin
        .from("atendimento_experimental_group_class_members")
        .update({
          status: "removed",
          updated_at: nowIso,
        })
        .eq("id", String((member as any)?.id ?? ""));
      if (updateMemberError) {
        if (isMissingExperimentalGroupRelation(updateMemberError)) {
          return groupSchemaUnavailableResponse();
        }
        return Response.json({ ok: false, error: updateMemberError.message }, { status: 500 });
      }
    }

    if (memberGroupClassId) {
      const { count: activeCount, error: activeCountError } = await admin
        .from("atendimento_experimental_group_class_members")
        .select("id", { count: "exact", head: true })
        .eq("group_class_id", memberGroupClassId)
        .eq("status", "assigned");
      if (activeCountError) {
        if (isMissingExperimentalGroupRelation(activeCountError)) {
          return groupSchemaUnavailableResponse();
        }
        return Response.json({ ok: false, error: activeCountError.message }, { status: 500 });
      }

      if (Number(activeCount ?? 0) <= 0) {
        const { error: updateClassError } = await admin
          .from("atendimento_experimental_group_classes")
          .update({
            status: "cancelled",
            updated_at: nowIso,
          })
          .eq("id", memberGroupClassId);
        if (updateClassError) {
          if (isMissingExperimentalGroupRelation(updateClassError)) {
            return groupSchemaUnavailableResponse();
          }
          return Response.json({ ok: false, error: updateClassError.message }, { status: 500 });
        }
      }
    }

    const { data: clearedExperimentalLead, error: clearExperimentalLeadError } = await admin
      .from("atendimento_leads")
      .update({
        status: "aguardando_aula_experimental",
        funnel_stage: "aula_experimental_antecipada",
        experimental_class_mode_preference: null,
        experimental_class_group_interest: false,
        experimental_class_group_interest_at: null,
        experimental_class_group_class_id: null,
        experimental_class_group_status: null,
        experimental_class_status: null,
        experimental_class_professor_date: null,
        experimental_class_professor_time: null,
        experimental_class_professor_start_at: null,
        experimental_class_lead_date: null,
        experimental_class_lead_time: null,
        experimental_class_lead_start_at: null,
        experimental_class_professor_name: null,
        experimental_class_professor_phone: null,
        experimental_class_booking_id: null,
        experimental_class_link: null,
        experimental_class_student_notification_sent_at: null,
        experimental_class_attendant_notification_sent_at: null,
        experimental_class_registered_attendant_notification_sent_at: null,
        updated_at: nowIso,
      })
      .eq("id", parsed.data.lead_id)
      .select(
        "id, experimental_class_mode_preference, experimental_class_group_interest, experimental_class_group_class_id, experimental_class_group_status",
      )
      .maybeSingle();
    if (clearExperimentalLeadError) {
      if (isMissingExperimentalGroupRelation(clearExperimentalLeadError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: clearExperimentalLeadError.message }, { status: 500 });
    }
    if (
      !clearedExperimentalLead?.id ||
      String((clearedExperimentalLead as any)?.experimental_class_group_class_id ?? "").trim() ||
      String((clearedExperimentalLead as any)?.experimental_class_group_status ?? "").trim() ||
      Boolean((clearedExperimentalLead as any)?.experimental_class_group_interest) ||
      String((clearedExperimentalLead as any)?.experimental_class_mode_preference ?? "").trim()
    ) {
      return Response.json(
        { ok: false, error: "O registro ainda ficou marcado como vinculado a uma turma em grupo." },
        { status: 409 },
      );
    }

    await appendHistoryEvent({
      leadId: parsed.data.lead_id,
      conversationId: String((member as any)?.conversation_id ?? "").trim() || null,
      eventType: "experimental_group_class_member_removed",
      title: "Registro removido de uma turma de aula experimental em grupo",
      details: {
        group_class_id: memberGroupClassId,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
