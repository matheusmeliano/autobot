import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan, planLabel } from "@/lib/plans";
import { changePlanAction } from "@/app/app/assinatura/actions";

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

  const plan = normalizePlan(data?.plano ?? "teste");
  const rawStatus = String(data?.status ?? "").toLowerCase();
  const status = rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
  const vencimento = data?.vencimento ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired =
    typeof vencimento === "string" &&
    vencimento.length >= 10 &&
    vencimento.slice(0, 10) < today;
  const isBlocked = status === "cancelado" || (plan !== "vitalicio" && isExpired);

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

      {isBlocked ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">Seu teste gratuito terminou.</div>
          <div className="mt-1 text-amber-100/90">
            Para reativar o acesso completo, escolha um plano abaixo. Assim que
            ativar, todas as funcionalidades do sistema serão liberadas
            novamente.
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Plano</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {planLabel(plan)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Vencimento</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">
            {plan === "vitalicio" ? "-" : vencimento ?? "-"}
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Básico</div>
              <div className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight sm:text-3xl">
                R$ 49/mês
              </div>
            </div>
          </div>
          <div className="mt-6 h-px bg-white/10" />
          <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">1 instância WhatsApp</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Agendamentos</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Templates básicos</div>
            </li>
          </ul>
          <form action={changePlanAction} className="mt-6">
            <input type="hidden" name="plano" value="basico" />
            <button
              type="submit"
              disabled={plan === "basico"}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
            >
              {plan === "basico" ? "Plano atual" : "Escolher"}
            </button>
          </form>
        </div>

        <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Pro</div>
              <div className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight sm:text-3xl">
                R$ 99/mês
              </div>
            </div>
            <div className="shrink-0 rounded-full bg-indigo-500/15 px-3 py-1 text-[11px] font-semibold text-indigo-200 ring-1 ring-indigo-400/20">
              Mais escolhido
            </div>
          </div>
          <div className="mt-6 h-px bg-white/10" />
          <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Tudo do Básico</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Retentativas inteligentes</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Relatórios completos</div>
            </li>
          </ul>
          <form action={changePlanAction} className="mt-6">
            <input type="hidden" name="plano" value="pro" />
            <button
              type="submit"
              disabled={plan === "pro"}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
            >
              {plan === "pro" ? "Plano atual" : "Escolher"}
            </button>
          </form>
        </div>

        <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Vitalício</div>
              <div className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight sm:text-3xl">
                R$ 2.490/único
              </div>
            </div>
          </div>
          <div className="mt-6 h-px bg-white/10" />
          <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Tudo do Básico e Pro</div>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
              <div className="min-w-0">Sem mensalidades. Seu para sempre!</div>
            </li>
          </ul>
          <form action={changePlanAction} className="mt-6">
            <input type="hidden" name="plano" value="vitalicio" />
            <button
              type="submit"
              disabled={plan === "vitalicio"}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
            >
              {plan === "vitalicio" ? "Plano atual" : "Escolher"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
