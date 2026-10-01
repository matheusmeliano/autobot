import {
  appendHistoryEvent,
  confirmLeadRecurringPayment,
  requireAtendimentoUser,
} from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const { leadId } = await params;
    const lid = String(leadId ?? "").trim();
    if (!lid) {
      return Response.json(
        { ok: false, error: "missing_lead_id" },
        { status: 400 },
      );
    }
    const admin = createSupabaseAdminClient();
    const result = await confirmLeadRecurringPayment({
      admin,
      leadId: lid,
      actorType: "attendant",
      attendantEmail: auth.user?.email ? String(auth.user.email) : null,
    });
    if (!result.ok) {
      return Response.json(
        { ok: false, error: (result as any).error ?? "Falha ao confirmar pagamento." },
        { status: 500 },
      );
    }
    try {
      await admin
        .from("atendimento_leads")
        .update({ updated_at: new Date().toISOString() } as any)
        .eq("id", lid);
    } catch {}
    let finalLead: Record<string, unknown> | null = null;
    try {
      const { data: fl } = await admin
        .from("atendimento_leads")
        .select(
          "id, full_name, phone, status, funnel_stage, payment_status, payment_confirmed_at, recurring_payment_status, recurring_payment_confirmed_at, recurring_registration_step, enrollment_number, recurring_class_weekday, recurring_class_weekday_label, recurring_class_lead_time, recurring_class_professor_time, recurring_class_professor_name, recurring_class_professor_phone, recurring_class_link, contract_status, contract_signed_at, contract_pdf_url, city, state, country, timezone, updated_at",
        )
        .eq("id", lid)
        .maybeSingle();
      finalLead = (fl as Record<string, unknown> | null) ?? null;
    } catch {}
    try {
      await appendHistoryEvent({
        leadId: lid,
        conversationId: null,
        eventType: "recurring_payment_confirmed_manual_button",
        title: "Pagamento confirmado via botão manual do painel",
        details: {
          confirmed_at: new Date().toISOString(),
          by: auth.user?.email ? String(auth.user.email) : null,
          previous_enrollment_number: (result as any).enrollmentNumber
            ? String((result as any).enrollmentNumber)
            : null,
        },
        actorType: "attendant",
        actorEmail: auth.user?.email ? String(auth.user.email) : null,
      });
    } catch {}
    return Response.json({ ok: true, lead: finalLead });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Falha inesperada ao confirmar pagamento.",
      },
      { status: 500 },
    );
  }
}
