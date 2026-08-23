import { NextRequest, NextResponse } from "next/server";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth?.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { leadId } = await params;
    const safeLeadId = String(leadId ?? "").trim();
    if (!safeLeadId) {
      return NextResponse.json({ ok: false, error: "Lead inválido." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as {
      new_password?: string | null;
    } | null;

    const newPassword = String(body?.new_password ?? "").trim();
    if (newPassword.length < 4) {
      return NextResponse.json(
        { ok: false, error: "A nova senha deve ter no mínimo 4 caracteres." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    const { error: updErr } = await admin
      .from("atendimento_leads")
      .update({
        recurring_registration_password: newPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("id", safeLeadId);

    if (updErr) {
      const msg = String(updErr.message ?? "").toLowerCase();
      if (/column.*does not exist|PGRST204|PGRST205|42703/i.test(msg)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Campo de senha ainda não disponível na tabela. Contate o suporte técnico.",
          },
          { status: 501 },
        );
      }
      throw updErr;
    }

    try {
      const { data: convRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", safeLeadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((convRow as any)?.id) {
        const { appendHistoryEvent } = await import("@/lib/atendimento/server");
        await appendHistoryEvent({
          leadId: safeLeadId,
          conversationId: String((convRow as any).id),
          eventType: "recurring_registration_password_changed_by_attendant",
          title: "Senha de matrícula recorrente alterada pelo atendente",
          details: { actor_email: auth.user.email },
          actorType: "attendant",
          actorEmail: auth.user.email,
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[lead-recurring-password] patch error", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Falha ao alterar a senha. Tente novamente.",
      },
      { status: 500 },
    );
  }
}
