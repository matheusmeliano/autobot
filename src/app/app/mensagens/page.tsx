import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  TemplatesClient,
  type TemplateRow,
} from "@/components/app/templates/TemplatesClient";

export default async function MensagensPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, nome, conteudo, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Templates
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus templates. Verifique se a migration foi
          aplicada e se você está logado.
        </div>
      </div>
    );
  }

  return <TemplatesClient initial={(data ?? []) as TemplateRow[]} />;
}
