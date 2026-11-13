import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";

export const runtime = "nodejs";

const schema = z.object({
  group_class_id: z.string().trim().uuid(),
  lead_id: z.string().trim().uuid(),
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

    const { data: member, error: memberError } = await admin
      .from("atendimento_experimental_group_class_members")
      .select("id, conversation_id, status")
      .eq("group_class_id", parsed.data.group_class_id)
      .eq("lead_id", parsed.data.lead_id)
      .maybeSingle();

    if (memberError) {
      return Response.json({ ok: false, error: memberError.message }, { status: 500 });
    }
    if (!member?.id) {
      return Response.json({ ok: false, error: "member_not_found" }, { status: 404 });
    }

    await admin
      .from("atendimento_experimental_group_class_members")
      .update({
        status: "removed",
        updated_at: nowIso,
      })
      .eq("id", String((member as any)?.id ?? ""));

    const { count: activeCount } = await admin
      .from("atendimento_experimental_group_class_members")
      .select("id", { count: "exact", head: true })
      .eq("group_class_id", parsed.data.group_class_id)
      .eq("status", "assigned");

    if (Number(activeCount ?? 0) <= 0) {
      await admin
        .from("atendimento_experimental_group_classes")
        .update({
          status: "cancelled",
          updated_at: nowIso,
        })
        .eq("id", parsed.data.group_class_id);
    }

    await admin
      .from("atendimento_leads")
      .update({
        experimental_class_group_class_id: null,
        experimental_class_group_status: "interested",
        updated_at: nowIso,
      })
      .eq("id", parsed.data.lead_id);

    await appendHistoryEvent({
      leadId: parsed.data.lead_id,
      conversationId: String((member as any)?.conversation_id ?? "").trim() || null,
      eventType: "experimental_group_class_member_removed",
      title: "Registro removido de uma turma de aula experimental em grupo",
      details: {
        group_class_id: parsed.data.group_class_id,
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
