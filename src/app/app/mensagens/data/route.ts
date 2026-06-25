import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAllMessageTemplates } from "@/lib/messageTemplates";

export async function GET() {
  const supabase = await createSupabaseServerClient({
    canSetCookies: true,
  });
  const { data, error } = await listAllMessageTemplates(supabase);

  if (error) {
    return Response.json(
      { error: error.message ?? "Falha ao carregar templates." },
      { status: 500 },
    );
  }

  return Response.json(data ?? []);
}
