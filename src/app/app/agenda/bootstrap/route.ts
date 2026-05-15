import { createSupabaseServerClient } from "@/lib/supabase/server";

type ScheduleRowDb = {
  id: string;
  debtor_id: string;
  template_id: string | null;
  data_envio: string;
  status: string;
  created_at: string;
  debtors: { nome: string } | null;
  message_templates: { nome: string } | null;
};

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });

  const [schedulesRes, debtorsRes, templatesRes] = await Promise.all([
    supabase
      .from("schedules")
      .select(
        "id, debtor_id, template_id, data_envio, status, created_at, debtors(nome), message_templates(nome)",
      )
      .order("data_envio", { ascending: true })
      .limit(200),
    supabase
      .from("debtors")
      .select("id, nome")
      .order("nome", { ascending: true })
      .limit(500),
    supabase
      .from("message_templates")
      .select("id, nome")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (schedulesRes.error || debtorsRes.error || templatesRes.error) {
    return new Response("Falha ao carregar.", { status: 500 });
  }

  const rows =
    ((schedulesRes.data ?? []) as ScheduleRowDb[]).map((r) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      template_id: r.template_id,
      data_envio: r.data_envio,
      status: r.status,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
      template_nome: r.message_templates?.nome ?? null,
    })) ?? [];

  return Response.json({
    rows,
    debtors: debtorsRes.data ?? [],
    templates: templatesRes.data ?? [],
  });
}
