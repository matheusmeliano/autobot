import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ChargesClient,
  type ChargeRow,
  type DebtorOption,
  type TemplateOption,
} from "@/components/app/charges/ChargesClient";

export default async function CobrancasPage() {
  const supabase = await createSupabaseServerClient();

  const [chargesRes, debtorsRes, templatesRes] = await Promise.all([
    supabase
      .from("charges")
      .select(
        "id, debtor_id, mensagem, status, enviada_em, tentativa, created_at, debtors(nome)"
      )
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
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Cobranças
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus dados. Verifique se as tabelas existem e
          se você está logado.
        </div>
      </div>
    );
  }

  const initial =
    (chargesRes.data ?? []).map((r: any) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      mensagem: r.mensagem,
      status: r.status,
      enviada_em: r.enviada_em,
      tentativa: r.tentativa,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
    })) ?? [];

  return (
    <ChargesClient
      initial={initial as ChargeRow[]}
      debtors={(debtorsRes.data ?? []) as DebtorOption[]}
      templates={(templatesRes.data ?? []) as TemplateOption[]}
    />
  );
}
