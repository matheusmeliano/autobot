import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markSchedulePaidAction } from "@/app/app/agenda/actions";
import { getResumeStatusAfterSuspicion } from "@/lib/chargeRetry";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const decision = body?.decision === "confirm" || body?.decision === "reject" ? body.decision : "";
  if (!id || !decision) {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: suspicion, error } = await admin
    .from("payment_suspicions")
    .select("id, user_id, schedule_id, status")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!suspicion?.id) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  if (String((suspicion as any).user_id) !== userId) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const scheduleId = (suspicion as any).schedule_id ? String((suspicion as any).schedule_id) : "";
  const nowIso = new Date().toISOString();

  if (decision === "confirm") {
    if (scheduleId) {
      const paidRes = await markSchedulePaidAction(scheduleId);
      if (!paidRes.ok) {
        return Response.json({ ok: false, error: paidRes.error ?? "Falha ao marcar pagamento." }, { status: 500 });
      }
    }

    await admin
      .from("payment_suspicions")
      .update({ status: "confirmed", resolved_at: nowIso })
      .eq("id", id);

    await admin.from("logs").insert({
      user_id: userId,
      tipo: "pagamento_confirmado",
      descricao: scheduleId
        ? `Pagamento confirmado para o agendamento ${scheduleId}`
        : "Pagamento confirmado (sem agendamento associado)",
    });

    return Response.json({ ok: true });
  }

  if (scheduleId) {
    const { data: schedule } = await admin
      .from("schedules")
      .select("id, debtor_id, status, first_sent_at, last_sent_at, schedule_timezone")
      .eq("id", scheduleId)
      .maybeSingle();
    const nextStatus = getResumeStatusAfterSuspicion({
      status: String((schedule as any)?.status ?? ""),
      firstSentAt: String((schedule as any)?.first_sent_at ?? "") || null,
      lastSentAt: String((schedule as any)?.last_sent_at ?? "") || null,
      nowUtcIso: nowIso,
      timeZone: String((schedule as any)?.schedule_timezone ?? "") || "America/Sao_Paulo",
    });
    await admin.from("schedules").update({ status: nextStatus }).eq("id", scheduleId);
    await syncDebtorChargeStatus(admin, userId, String((schedule as any)?.debtor_id ?? ""));
  }

  await admin.from("payment_suspicions").update({ status: "rejected", resolved_at: nowIso }).eq("id", id);

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "pagamento_rejeitado",
    descricao: scheduleId
      ? `Suspeita de pagamento rejeitada para o agendamento ${scheduleId}`
      : "Suspeita de pagamento rejeitada (sem agendamento associado)",
  });

  return Response.json({ ok: true });
}
