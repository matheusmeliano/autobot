import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WhatsAppClient } from "@/components/app/whatsapp/WhatsAppClient";

function last4(value: string | null | undefined) {
  const v = String(value ?? "");
  if (!v) return null;
  return v.length <= 4 ? v : v.slice(-4);
}

export default async function WhatsAppPage() {
  const supabase = await createSupabaseServerClient();
  const first = await supabase
    .from("whatsapp_instances")
    .select("instance_id, token, client_token, status")
    .maybeSingle();
  const missingClientToken =
    first.error &&
    /client_token/i.test(first.error.message) &&
    /column/i.test(first.error.message);
  const second = missingClientToken
    ? await supabase
        .from("whatsapp_instances")
        .select("instance_id, token, status")
        .maybeSingle()
    : null;
  const data = (second?.data ?? first.data) as any;
  const error = second?.error ?? first.error;

  if (error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Integração Z-API
        </h1>
        <div className="mt-2 text-sm text-white/60">
          {missingClientToken
            ? "Atualize o banco: rode a migration do campo client_token e recarregue."
            : "Não foi possível carregar seus dados. Verifique se as tabelas existem e se você está logado."}
        </div>
      </div>
    );
  }

  return (
    <WhatsAppClient
      initial={
        data
          ? {
              instance_id: data.instance_id ?? null,
              status: data.status ?? null,
              hasToken: Boolean(data.token),
              tokenLast4: last4(data.token),
              hasClientToken: Boolean(data.client_token),
              clientTokenLast4: last4(data.client_token),
            }
          : null
      }
    />
  );
}
