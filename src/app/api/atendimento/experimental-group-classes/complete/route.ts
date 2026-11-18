import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";

export const runtime = "nodejs";

const schema = z.object({
  group_class_id: z.string().trim().uuid(),
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
    /column .*(attendance_status|attendance_checked_at).* does not exist/i.test(message) ||
    /could not find the '(attendance_status|attendance_checked_at)' column .*schema cache/i.test(
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
    const groupClassId = parsed.data.group_class_id;

    const { data: groupClass, error: groupClassError } = await admin
      .from("atendimento_experimental_group_classes")
      .select("*")
      .eq("id", groupClassId)
      .maybeSingle();
    if (groupClassError) {
      if (isMissingExperimentalGroupRelation(groupClassError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: groupClassError.message }, { status: 500 });
    }
    if (!groupClass?.id) {
      return Response.json({ ok: false, error: "group_class_not_found" }, { status: 404 });
    }

    const classStatus = String((groupClass as any)?.status ?? "").trim().toLowerCase();
    if (classStatus === "cancelled") {
      return Response.json(
        { ok: false, error: "Esta turma foi cancelada e não pode ser marcada como realizada." },
        { status: 409 },
      );
    }

    const professorStartAt = String((groupClass as any)?.professor_start_at ?? "").trim();

    const checkedAtIso =
      String((groupClass as any)?.attendance_checked_at ?? "").trim() || nowIso;
    if (classStatus !== "completed" || !String((groupClass as any)?.attendance_checked_at ?? "").trim()) {
      const { error: updateClassError } = await admin
        .from("atendimento_experimental_group_classes")
        .update({
          status: "completed",
          attendance_status: "attended",
          attendance_checked_at: checkedAtIso,
          updated_at: nowIso,
        })
        .eq("id", groupClassId);
      if (updateClassError) {
        if (isMissingExperimentalGroupRelation(updateClassError)) {
          return groupSchemaUnavailableResponse();
        }
        return Response.json({ ok: false, error: updateClassError.message }, { status: 500 });
      }
    }

    const { data: members, error: membersError } = await admin
      .from("atendimento_experimental_group_class_members")
      .select("id, lead_id, conversation_id, status")
      .eq("group_class_id", groupClassId)
      .eq("status", "assigned");
    if (membersError) {
      if (isMissingExperimentalGroupRelation(membersError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: membersError.message }, { status: 500 });
    }

    const memberRows = Array.isArray(members) ? (members as any[]) : [];
    const leadIds = memberRows
      .map((member) => String(member?.lead_id ?? "").trim())
      .filter(Boolean);
    const leadsById = new Map<string, any>();
    if (leadIds.length > 0) {
      const { data: leads, error: leadsError } = await admin
        .from("atendimento_leads")
        .select("id, full_name")
        .in("id", leadIds);
      if (leadsError) {
        return Response.json({ ok: false, error: leadsError.message }, { status: 500 });
      }
      for (const lead of leads ?? []) {
        const leadId = String((lead as any)?.id ?? "").trim();
        if (!leadId) continue;
        leadsById.set(leadId, lead);
      }
    }

    for (const member of memberRows) {
      const leadId = String((member as any)?.lead_id ?? "").trim();
      if (!leadId) continue;
      const conversationId =
        String((member as any)?.conversation_id ?? "").trim() || null;

      await admin
        .from("atendimento_leads")
        .update({
          funnel_stage: "matricula_pendente",
          status: "matricula_pendente",
          experimental_class_group_status: "completed",
          experimental_class_status: "completed",
          experimental_class_attendance_status: "attended",
          experimental_class_attendance_checked_at: checkedAtIso,
          updated_at: nowIso,
        })
        .eq("id", leadId);

      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_group_class_completed",
        title: "Aula experimental em grupo marcada como realizada",
        details: {
          group_class_id: groupClassId,
          professor_start_at: professorStartAt || null,
          attendance_status: "attended",
          attendance_checked_at: checkedAtIso,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });
    }

    return Response.json({
      ok: true,
      attendance_checked_at: checkedAtIso,
      already_completed: classStatus === "completed",
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
