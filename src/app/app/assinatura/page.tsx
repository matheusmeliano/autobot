import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan, planLabel } from "@/lib/plans";

export default async function AssinaturaPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plano, status, vencimento, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          ASSINATURA
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Assinatura
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar. Verifique se a migration foi aplicada.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
        ASSINATURA
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
        Assinatura
      </h1>
      <div className="mt-2 text-sm text-white/60">
        Aqui você acompanha seu plano e o status da sua assinatura.
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Plano</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {planLabel(normalizePlan(data?.plano))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Vencimento</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {data?.vencimento ?? "-"}
          </div>
        </div>
      </div>
    </div>
  );
}
