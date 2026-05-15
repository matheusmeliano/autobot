import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WhatsAppClient } from "@/components/app/whatsapp/WhatsAppClient";

export default async function WhatsAppPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("instance_id, token, status, phone")
    .maybeSingle();

  if (error) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          WHATSAPP
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Integração Z-API
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus dados. Verifique se as tabelas existem e
          se você está logado.
        </div>
      </div>
    );
  }

  return <WhatsAppClient initial={data ?? null} />;
}
