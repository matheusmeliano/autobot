import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data } = await supabase
    .from("schedules")
    .select(
      "id, debtor_id, template_id, template_pending_id, template_overdue_id, data_envio, status, recurrence, recurrence_until, last_sent_at, payment_received_at, created_at, debtors(nome), pending_template:message_templates!schedules_template_pending_id_fkey(nome), overdue_template:message_templates!schedules_template_overdue_id_fkey(nome)",
    )
    .order("data_envio", { ascending: true })
    .limit(200);

  const rows =
    (data ?? []).map((r: any) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      template_id: r.template_id,
      template_pending_id: r.template_pending_id ?? null,
      template_overdue_id: r.template_overdue_id ?? null,
      data_envio: r.data_envio,
      status: r.status,
      recurrence: r.recurrence ?? "none",
      recurrence_until: r.recurrence_until ?? null,
      last_sent_at: r.last_sent_at ?? null,
      payment_received_at: r.payment_received_at ?? null,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
      template_nome: r.pending_template?.nome ?? null,
      template_pending_nome: r.pending_template?.nome ?? null,
      template_overdue_nome: r.overdue_template?.nome ?? null,
    })) ?? [];

  return Response.json(rows);
}
