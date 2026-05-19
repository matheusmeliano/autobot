import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data } = await supabase
    .from("schedules")
    .select("id, debtor_id, template_id, data_envio, status, recurrence, created_at, debtors(nome), message_templates(nome)")
    .order("data_envio", { ascending: true })
    .limit(200);

  const rows =
    (data ?? []).map((r: any) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      template_id: r.template_id,
      data_envio: r.data_envio,
      status: r.status,
      recurrence: r.recurrence ?? "none",
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
      template_nome: r.message_templates?.nome ?? null,
    })) ?? [];

  return Response.json(rows);
}
