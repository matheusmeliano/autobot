import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";

export const runtime = "nodejs";

const schema = z.object({
  group_class_id: z.string().trim().uuid(),
  lesson_link: z.string().trim().max(500).nullable().optional(),
});

function isMissingExperimentalGroupRelation(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_group_(classes|class_members).*does not exist/i.test(
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
    const lessonLink = String(parsed.data.lesson_link ?? "").trim() || null;

    const { data: groupClass, error: groupClassError } = await admin
      .from("atendimento_experimental_group_classes")
      .select("id, lesson_link")
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

    const { error: updateClassError } = await admin
      .from("atendimento_experimental_group_classes")
      .update({
        lesson_link: lessonLink,
        updated_at: nowIso,
      })
      .eq("id", groupClassId);
    if (updateClassError) {
      if (isMissingExperimentalGroupRelation(updateClassError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: updateClassError.message }, { status: 500 });
    }

    const { data: members, error: membersError } = await admin
      .from("atendimento_experimental_group_class_members")
      .select("lead_id, conversation_id, status")
      .eq("group_class_id", groupClassId)
      .eq("status", "assigned");
    if (membersError) {
      if (isMissingExperimentalGroupRelation(membersError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: membersError.message }, { status: 500 });
    }

    const memberRows = Array.isArray(members) ? (members as any[]) : [];
    for (const member of memberRows) {
      const leadId = String((member as any)?.lead_id ?? "").trim();
      if (!leadId) continue;
      const conversationId = String((member as any)?.conversation_id ?? "").trim() || null;

      await admin
        .from("atendimento_leads")
        .update({
          experimental_class_link: lessonLink,
          updated_at: nowIso,
        })
        .eq("id", leadId);

      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_group_class_lesson_link_saved",
        title: lessonLink
          ? "Link da turma experimental em grupo atualizado"
          : "Link da turma experimental em grupo removido",
        details: {
          group_class_id: groupClassId,
          lesson_link: lessonLink,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });
    }

    return Response.json({
      ok: true,
      lesson_link: lessonLink,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
