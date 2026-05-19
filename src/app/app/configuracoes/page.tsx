import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan, planLabel } from "@/lib/plans";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { ChangePasswordForm } from "@/components/app/ChangePasswordForm";
import { TimezoneSettings } from "@/components/app/TimezoneSettings";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";

function dateTimeBR(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("pt-BR");
}

export default async function ConfiguracoesPage() {
  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, email, plano, created_at, timezone")
    .maybeSingle();

  const showPassword = !isGlobalAdminEmail(profile?.email);
  const tzRaw = (profile as any)?.timezone;
  const tz = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : null;

  return (
    <div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
        Conta
      </h1>
      <div className="mt-2 text-sm text-white/60">
        Veja e atualize seus dados da conta.
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Email</div>
          <div className="mt-2 text-sm font-semibold text-white/80">
            {profile?.email ?? "-"}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Nome</div>
          <div className="mt-2 text-sm font-semibold text-white/80">
            {profile?.nome ?? "-"}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Plano</div>
          <div className="mt-2 text-sm font-semibold text-white/80">
            {planLabel(normalizePlan(profile?.plano))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold text-white/55">Criado em</div>
          <div className="mt-2 text-sm font-semibold text-white/80">
            {dateTimeBR(profile?.created_at)}
          </div>
        </div>
      </div>

      <TimezoneSettings initialTimeZone={tz} />

      {showPassword ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
            SEGURANÇA
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight">
            Redefinir senha
          </div>
          <div className="mt-1 text-sm text-white/60">
            Defina uma nova senha para sua conta.
          </div>
          <div className="mt-4">
            <ChangePasswordForm />
          </div>
        </div>
      ) : null}
    </div>
  );
}
