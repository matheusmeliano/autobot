import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";
import {
  AtSign,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileDown,
  GraduationCap,
  Hash,
  LogOut,
  XCircle,
} from "lucide-react";

export const dynamic = "force-dynamic";

function atendimentoTimeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Horário não definido";
  return normalized.endsWith("h") ? normalized : `${normalized}h`;
}

function weekdayFullLabel(raw: string | null | undefined, fallbackLabel: string | null | undefined) {
  const fb = String(fallbackLabel ?? "").trim();
  if (fb) return fb;
  const key = String(raw ?? "").trim().toLowerCase();
  switch (key) {
    case "mon":
      return "Segunda-feira";
    case "tue":
      return "Terça-feira";
    case "wed":
      return "Quarta-feira";
    case "thu":
      return "Quinta-feira";
    case "fri":
      return "Sexta-feira";
    case "sat":
      return "Sábado";
    case "sun":
      return "Domingo";
    default:
      return key ? key : "Dia não definido";
  }
}

function isPaymentConfirmed(lead: any) {
  const payStatus = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAt = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const leadStatus = String((lead as any)?.status ?? "").trim().toLowerCase();
  const funnelStage = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  return (
    payStatus === "confirmado" ||
    payStatus === "matriculado" ||
    Boolean(payConfirmedAt && payConfirmedAt !== "null") ||
    leadStatus === "matriculado" ||
    leadStatus === "matricula_confirmada" ||
    funnelStage === "matriculado" ||
    funnelStage === "matricula_confirmada"
  );
}

export default async function AlunoPortalPage() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return null;
  }

  const userId = String(session.user.id);
  const userLeadId =
    session.user.user_metadata &&
    typeof session.user.user_metadata === "object" &&
    "lead_id" in (session.user.user_metadata as any)
      ? String((session.user.user_metadata as any).lead_id ?? "").trim()
      : "";

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("phone, email, full_name, access_scope")
    .eq("user_id", userId)
    .maybeSingle();

  const profilePhone = String((profileRow as any)?.phone ?? "").trim();
  const profileEmail = String((profileRow as any)?.email ?? "").trim().toLowerCase();
  const profileFullName = String((profileRow as any)?.full_name ?? "").trim();

  let lead: any = null;

  if (userLeadId) {
    const { data } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", userLeadId)
      .maybeSingle();
    lead = data ?? null;
  }

  if (!lead && profilePhone) {
    const phoneDigits = profilePhone.replace(/\D/g, "");
    const { data } = await admin
      .from("atendimento_leads")
      .select("*")
      .or(
        `phone.eq.${phoneDigits},phone.eq.+${phoneDigits}`,
      )
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = data ?? null;
  }

  if (!lead && profileEmail) {
    const { data } = await admin
      .from("atendimento_leads")
      .select("*")
      .or(`student_email.ilike.${profileEmail},email.ilike.${profileEmail}`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = data ?? null;
  }

  const rawFullName = String(lead?.full_name ?? profileFullName ?? "").trim();
  const safeFullName = rawFullName || "Aluno(a)";
  const firstName = safeFullName.split(/\s+/)[0] || safeFullName;

  const enrollmentNumber = String(lead?.enrollment_number ?? "").trim() || null;

  const weekdayRaw = String(lead?.recurring_class_weekday ?? "").trim();
  const weekdayLabelRaw = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
  const classWeekday = weekdayFullLabel(weekdayRaw, weekdayLabelRaw);

  const professorTime = String(lead?.recurring_class_professor_time ?? "").trim();
  const leadTime = String(lead?.recurring_class_lead_time ?? "").trim();
  const classTime = atendimentoTimeLabel(professorTime || leadTime || null);

  const recurringClassLink = String((lead as any)?.recurring_class_link ?? "").trim() || null;

  const paymentOk = lead ? isPaymentConfirmed(lead) : false;
  const paymentConfirmedAt = lead ? formatAtendimentoDateTime((lead as any)?.payment_confirmed_at || null) : null;

  const contractPdfUrl = String((lead as any)?.contract_pdf_url ?? "").trim() || null;
  const contractSignedAt = lead
    ? (lead as any)?.contract_signed_at
      ? formatAtendimentoDateTime((lead as any).contract_signed_at)
      : null
    : null;

  async function handleSignOutAction() {
    "use server";
    const sb = await createSupabaseServerClient();
    await sb.auth.signOut({ scope: "local" });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex w-full flex-col items-start gap-4 border-b border-slate-200/70 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
            <GraduationCap className="h-6 w-6 shrink-0" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Lucas Brum Online Music USA
            </div>
            <h1 className="mt-1 truncate text-xl font-bold text-slate-900 sm:text-2xl">
              Olá, {firstName}!
            </h1>
          </div>
        </div>
        <form action={handleSignOutAction} className="w-full sm:w-auto">
          <button
            type="submit"
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 sm:w-auto"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Sair</span>
          </button>
        </form>
      </header>

      <section className="mt-8 grid min-w-0 gap-4 md:grid-cols-2">
        <article className="w-full rounded-2xl border border-indigo-200/70 bg-white p-5 shadow-sm shadow-indigo-50/50">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">
            <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Número da matrícula</span>
          </div>
          <div className="mt-4 truncate text-lg font-bold text-slate-900">
            {enrollmentNumber || "—"}
          </div>
        </article>

        <article className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-50">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <AtSign className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Dados cadastrais</span>
          </div>
          <div className="mt-4 truncate text-sm font-semibold text-slate-900">
            {safeFullName}
          </div>
        </article>

        <article className="w-full rounded-2xl border border-emerald-200/70 bg-white p-5 shadow-sm shadow-emerald-50/50">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Dia da aula</span>
          </div>
          <div className="mt-4 truncate text-lg font-bold text-slate-900">
            {classWeekday}
          </div>
        </article>

        <article className="w-full rounded-2xl border border-emerald-200/70 bg-white p-5 shadow-sm shadow-emerald-50/50">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
            <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Horário fixo</span>
          </div>
          <div className="mt-4 truncate text-lg font-bold text-slate-900">
            {classTime}
          </div>
        </article>
      </section>

      <section className="mt-6 grid min-w-0 gap-4">
        <article className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-50">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Link fixo das aulas</span>
              </div>
              <div
                className="mt-3 max-w-xl truncate text-sm font-semibold text-slate-700"
                title={recurringClassLink || ""}
              >
                {recurringClassLink || "Link da aula ainda não disponível."}
              </div>
            </div>
            {recurringClassLink ? (
              <a
                href={recurringClassLink}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800 sm:w-auto"
              >
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Abrir aula</span>
              </a>
            ) : null}
          </div>
        </article>
      </section>

      <section className="mt-6 grid min-w-0 gap-4 md:grid-cols-2">
        <article
          className={
            paymentOk
              ? "w-full rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm shadow-emerald-50"
              : "w-full rounded-2xl border border-red-200 bg-red-50/60 p-5 shadow-sm shadow-red-50"
          }
        >
          <div
            className={
              paymentOk
                ? "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700"
                : "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-600"
            }
          >
            {paymentOk ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>Status do pagamento</span>
          </div>
          <div className="mt-4 flex flex-col gap-1">
            <div
              className={
                paymentOk
                  ? "text-lg font-bold text-emerald-800"
                  : "text-lg font-bold text-red-700"
              }
            >
              {paymentOk ? "Pagamento confirmado" : "Pagamento pendente"}
            </div>
            {paymentOk && paymentConfirmedAt ? (
              <div className="text-xs font-semibold text-emerald-700/90">
                Confirmado em {paymentConfirmedAt}
              </div>
            ) : null}
          </div>
        </article>

        <article className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-50">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <FileDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Contrato</span>
          </div>
          <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">
                {contractPdfUrl ? "Contrato assinado disponível" : "Contrato ainda não disponível"}
              </div>
              {contractSignedAt ? (
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  Assinado em {contractSignedAt}
                </div>
              ) : null}
            </div>
            {contractPdfUrl ? (
              <a
                href={contractPdfUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 active:bg-slate-100 sm:w-auto"
              >
                <FileDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Baixar PDF</span>
              </a>
            ) : null}
          </div>
        </article>
      </section>

      <footer className="mt-10 border-t border-slate-200/70 pt-5 text-xs font-semibold text-slate-500">
        © {new Date().getFullYear()} Lucas Brum Online Music USA. Painel do Aluno.
      </footer>
    </main>
  );
}
