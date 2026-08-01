import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WhatsAppClient } from "@/components/app/whatsapp/WhatsAppClient";

export default async function WhatsAppPage() {
  const supabase = await createSupabaseServerClient();
  const first = await supabase
    .from("whatsapp_instances")
    .select("instance_id, token, client_token, status, display_name, phone")
    .maybeSingle();
  const missingClientToken =
    first.error &&
    /client_token/i.test(first.error.message) &&
    /column/i.test(first.error.message);
  const missingDisplayName =
    first.error &&
    /display_name/i.test(first.error.message) &&
    /column/i.test(first.error.message);
  const missingPhone =
    first.error &&
    /\bphone\b/i.test(first.error.message) &&
    /column/i.test(first.error.message);
  const retry: typeof first | null =
    missingClientToken && missingDisplayName && missingPhone
      ? await supabase
          .from("whatsapp_instances")
          .select("instance_id, token, status")
          .maybeSingle()
      : missingClientToken && missingDisplayName
        ? await supabase
            .from("whatsapp_instances")
            .select("instance_id, token, status, phone")
            .maybeSingle()
        : missingClientToken && missingPhone
          ? await supabase
              .from("whatsapp_instances")
              .select("instance_id, token, status, display_name")
              .maybeSingle()
          : missingDisplayName && missingPhone
            ? await supabase
                .from("whatsapp_instances")
                .select("instance_id, token, status, client_token")
                .maybeSingle()
            : missingClientToken
              ? await supabase
                  .from("whatsapp_instances")
                  .select("instance_id, token, status, display_name, phone")
                  .maybeSingle()
              : missingDisplayName
                ? await supabase
                    .from("whatsapp_instances")
                    .select("instance_id, token, status, client_token, phone")
                    .maybeSingle()
                : missingPhone
                  ? await supabase
                      .from("whatsapp_instances")
                      .select("instance_id, token, status, client_token, display_name")
                      .maybeSingle()
                  : null;
  const data = (retry?.data ?? first.data) as any;
  const error = retry?.error ?? first.error;

  if (error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Integração Z-API
        </h1>
        <div className="mt-2 text-sm text-white/60">
          {(missingClientToken || missingDisplayName || missingPhone)
            ? "Atualize o banco: rode as migrations pendentes em whatsapp_instances e recarregue."
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
              hasClientToken: Boolean(data.client_token),
              display_name: String(data.display_name ?? "").trim() || null,
              phone: String(data.phone ?? "").trim() || null,
            }
          : null
      }
    />
  );
}
