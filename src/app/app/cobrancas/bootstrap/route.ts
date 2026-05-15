import { createSupabaseServerClient } from "@/lib/supabase/server";

type ChargeRowDb = {
  id: string;
  debtor_id: string;
  mensagem: string | null;
  status: string;
  enviada_em: string | null;
  tentativa: number;
  created_at: string;
  debtors: { nome: string } | null;
};

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });

  const [chargesRes, debtorsRes, templatesRes] = await Promise.all([
    supabase
      .from("charges")
      .select("id, debtor_id, mensagem, status, enviada_em, tentativa, created_at, debtors(nome)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("debtors")
      .select("id, nome, pix_key")
      .order("nome", { ascending: true })
      .limit(500),
    supabase
      .from("message_templates")
      .select("id, nome, conteudo")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (chargesRes.error || debtorsRes.error || templatesRes.error) {
    return new Response("Falha ao carregar.", { status: 500 });
  }

  const rows =
    ((chargesRes.data ?? []) as ChargeRowDb[]).map((r) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      mensagem: r.mensagem,
      status: r.status,
      enviada_em: r.enviada_em,
      tentativa: r.tentativa,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
    })) ?? [];

  return Response.json({
    rows,
    debtors: debtorsRes.data ?? [],
    templates: templatesRes.data ?? [],
  });
}
