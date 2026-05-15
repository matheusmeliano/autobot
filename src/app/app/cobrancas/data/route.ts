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
  const { data } = await supabase
    .from("charges")
    .select("id, debtor_id, mensagem, status, enviada_em, tentativa, created_at, debtors(nome)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows =
    ((data ?? []) as ChargeRowDb[]).map((r) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      mensagem: r.mensagem,
      status: r.status,
      enviada_em: r.enviada_em,
      tentativa: r.tentativa,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
    })) ?? [];

  return Response.json(rows);
}
