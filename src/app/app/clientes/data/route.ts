import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data } = await supabase
    .from("debtors")
    .select(
      "id, nome, telefone, valor, vencimento, pix_key, observacoes, status, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return Response.json(data ?? []);
}
