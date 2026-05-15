import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data } = await supabase
    .from("debtors")
    .select("id, nome, telefone, valor, vencimento, pix_key, observacoes, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return Response.json(data ?? []);
}
