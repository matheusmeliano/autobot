import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({
    canSetCookies: true,
  });
  const { data } = await supabase
    .from("message_templates")
    .select("id, nome, conteudo, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return Response.json(data ?? []);
}
