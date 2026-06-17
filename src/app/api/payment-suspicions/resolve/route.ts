import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markSchedulePaidAction } from "@/app/app/agenda/actions";

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
      const { data: schedule } = await admin
        .from("schedules")
        .select("id, user_id, data_envio, status, recurrence")
        .eq("id", scheduleId)
        .maybeSingle();

      const recurrence = String((schedule as any)?.recurrence ?? "none");
      if (recurrence === "monthly") {
        const paidRes = await markSchedulePaidAction(scheduleId);
        if (!paidRes.ok) {
          return Response.json({ ok: false, error: paidRes.error ?? "Falha ao marcar pagamento." }, { status: 500 });
        }
      } else if (schedule?.id) {
        await admin.from("schedule_runs").insert({
          user_id: userId,
          schedule_id: scheduleId,
          scheduled_for: String((schedule as any)?.data_envio ?? nowIso),
          executed_at: nowIso,
          status: "executado",
        });
        await admin.from("schedules").update({ status: "executado" }).eq("id", scheduleId);
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
    await admin.from("schedules").update({ status: "agendado" }).eq("id", scheduleId);
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
