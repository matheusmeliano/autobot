import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SchedulesClient,
  type DebtorOption,
  type ScheduleRow,
  type TemplateOption,
} from "@/components/app/schedules/SchedulesClient";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";

export default async function AgendarPage() {
  const supabase = await createSupabaseServerClient();

  const [schedulesRes, debtorsRes, templatesRes, profileRes] = await Promise.all([
    supabase
      .from("schedules")
      .select(
        "id, debtor_id, template_id, data_envio, status, created_at, debtors(nome), message_templates(nome)",
      )
      .order("data_envio", { ascending: true })
      .limit(200),
    supabase.from("debtors").select("id, nome").order("nome", { ascending: true }).limit(500),
    supabase
      .from("message_templates")
      .select("id, nome")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);

  if (schedulesRes.error || debtorsRes.error || templatesRes.error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Agendamentos</h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus dados. Verifique se as tabelas existem e se você está
          logado.
        </div>
      </div>
    );
  }

  const initial =
    (schedulesRes.data ?? []).map((r: any) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      template_id: r.template_id,
      data_envio: r.data_envio,
      status: r.status,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
      template_nome: r.message_templates?.nome ?? null,
    })) ?? [];

  const tzRaw = (profileRes as any)?.data?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : null;

  return (
    <SchedulesClient
      initial={initial as ScheduleRow[]}
      debtors={(debtorsRes.data ?? []) as DebtorOption[]}
      templates={(templatesRes.data ?? []) as TemplateOption[]}
      timeZone={timeZone}
    />
  );
}

