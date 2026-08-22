"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AlertTriangle, CalendarDays, Check, CheckCircle2, Copy, Download, ExternalLink, FileText, Loader2, Pencil, Plus, Save, Search, Trash2, X, XCircle, Zap } from "lucide-react";
import { modalToast } from "@/lib/modalToast";
import { AppModal } from "@/components/app/AppModal";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import {
  deriveExperimentalClassBookingDisplayStatus,
  experimentalClassBookingDisplayStatusLabel,
  calculateNextRecurringOccurrence,
  calculatePastRecurringOccurrences,
} from "@/lib/atendimento/experimentalClass";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDate, formatAtendimentoDateTime, formatAtendimentoLocationName, leadMatchesSearchQuery, suggestClosestName } from "@/lib/atendimento/utils";

type SummarySectionId = "interessados" | "alunos" | "agendamentos" | "contratos";
const PANEL_PAGE_SIZE = 10;

function atendimentoOriginLabel(origin: string | null | undefined) {
  const normalized = String(origin ?? "").trim().toLowerCase();
  if (normalized === "link_publico_atendimento") return "Link de atendimento";
  if (normalized === "whatsapp_trafego_pago") return "Tráfego pago";
  if (!normalized) return "-";
  return origin ?? "-";
}

function atendimentoTimeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  return normalized.endsWith("h") ? normalized : `${normalized}h`;
}

function experimentalClassAttendanceLabel(status: "pending" | "attended" | "no_show" | null | undefined) {
  if (status === "attended") return "Concluído";
  if (status === "no_show") return "Não compareceu";
  return "Pendente";
}

function leadHasExperimentalClassPanelStatus(lead: AtendimentoLeadListItem) {
  const booking = lead.experimental_class_booking ?? null;
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  const bookingSource = String((booking as any)?.source ?? "").trim().toLowerCase();
  if (booking) {
    if (bookingStatus === "cancelled") return false;
    if (bookingSource !== "draft") return true;
  }
  const stage = String(lead.funnel_stage ?? "").trim().toLowerCase();
  if (!["aula_experimental_convidada", "pre_cadastro_concluido", "aula_experimental_agendada"].includes(stage)) {
    return false;
  }
  const wasCancelled =
    String(lead.latest_experimental_class_cancelled_at ?? "").trim() ||
    String(lead.latest_experimental_class_event ?? "").trim().toLowerCase() === "experimental_class_cancelled";
  if (wasCancelled) return false;
  return true;
}

function leadHasAnyExperimentalVinculo(lead: AtendimentoLeadListItem) {
  const booking = lead.experimental_class_booking ?? null;
  const bookingId = String(booking?.id ?? "").trim();
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  if (bookingId && bookingStatus !== "cancelled") return true;

  const flatBookingId = String((lead as any)?.experimental_class_booking_id ?? "").trim();
  const flatStatus = String((lead as any)?.experimental_class_status ?? "").trim().toLowerCase();
  const flatLeadDate = String((lead as any)?.experimental_class_lead_date ?? "").trim();
  const flatLeadTime = String((lead as any)?.experimental_class_lead_time ?? "").trim();
  const flatProfDate = String((lead as any)?.experimental_class_professor_date ?? "").trim();
  const flatProfTime = String((lead as any)?.experimental_class_professor_time ?? "").trim();
  const flatLeadStart = String((lead as any)?.experimental_class_lead_start_at ?? "").trim();
  const flatProfStart = String((lead as any)?.experimental_class_professor_start_at ?? "").trim();
  if (flatBookingId && flatStatus !== "cancelled") return true;
  if (flatLeadDate || flatLeadTime || flatProfDate || flatProfTime || flatLeadStart || flatProfStart) {
    if (flatStatus !== "cancelled") return true;
  }
  return leadHasExperimentalClassPanelStatus(lead);
}

function isLeadRepescagem(lead: AtendimentoLeadListItem | null | undefined) {
  if (!lead) return false;
  const stage = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const st = String((lead as any)?.status ?? "").trim().toLowerCase();
  return (
    stage === "repescagem" ||
    st === "repescagem" ||
    stage === "matricula_pendente_recusada" ||
    st === "matricula_pendente_recusada"
  );
}

function isLeadMatriculaRecusadaPosAttendance(
  lead: AtendimentoLeadListItem | null | undefined,
) {
  if (!lead) return false;
  const stage = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const st = String((lead as any)?.status ?? "").trim().toLowerCase();
  return stage === "matricula_pendente_recusada" || st === "matricula_pendente_recusada";
}

function isBookingAttendanceNoShow(booking: unknown) {
  const status = String((booking as any)?.attendance_status ?? "").trim().toLowerCase();
  return status === "no_show";
}

function isBookingAttendanceResolved(booking: unknown) {
  const status = String((booking as any)?.attendance_status ?? "").trim().toLowerCase();
  return status === "attended" || status === "no_show";
}

function isLeadInAlunosSection(lead: AtendimentoLeadListItem): boolean {
  const st = String(lead.status ?? "").trim().toLowerCase();
  const fs = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const rcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const ps = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  return (
    st === "aluno" ||
    st === "matriculado" ||
    st === "cadastro_recorrente_pendente_plataforma" ||
    st === "contrato_coletando_dados" ||
    st === "contrato_aguardando_aceite" ||
    st === "contrato_assinado" ||
    st === "matricula_confirmada" ||
    st === "pagamento_pendente_confirmacao" ||
    st === "pagamento_nao_realizado" ||
    fs === "aluno_recorrente_cadastrado" ||
    fs === "cadastro_recorrente_pendente_plataforma" ||
    fs === "pagamento_pendente_confirmacao" ||
    fs === "pagamento_nao_realizado" ||
    rcs === "cadastro_plataforma_pendente" ||
    rcs === "confirmado" ||
    ps === "pendente_confirmacao" ||
    ps === "nao_realizado" ||
    ps === "confirmado"
  );
}

function leadHasAnyRecurringProgressSignal(lead: AtendimentoLeadListItem): boolean {
  const recWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const recWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recWeekdayRaw);
  const weekdayLabel = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
  const weekdayLabelOk =
    Boolean(weekdayLabel) &&
    /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
      weekdayLabel,
    );
  const recTimeOk =
    Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
    Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const rcsOk = Boolean(String((lead as any)?.recurring_class_status ?? "").trim());
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const regStepOk = Number.isFinite(regStepRaw) && regStepRaw >= 1 && regStepRaw <= 12;
  const st = String(lead.status ?? "").trim().toLowerCase();
  const fs = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const stOrFsOk =
    st === "aluno" ||
    st === "matriculado" ||
    st === "cadastro_recorrente_pendente_plataforma" ||
    st === "contrato_coletando_dados" ||
    st === "contrato_aguardando_aceite" ||
    st === "contrato_assinado" ||
    st === "matricula_confirmada" ||
    fs === "aluno_recorrente_cadastrado" ||
    fs === "cadastro_recorrente_pendente_plataforma" ||
    fs === "contrato_coletando_dados" ||
    fs === "contrato_aguardando_aceite" ||
    fs === "contrato_assinado" ||
    fs === "matricula_confirmada" ||
    fs === "matriculado" ||
    rcsOk;
  return recWeekdayOk || weekdayLabelOk || recTimeOk || rcsOk || regStepOk || stOrFsOk;
}

function shouldHideExperimentalInfoCompletely(
  lead: AtendimentoLeadListItem,
  activeSection: SummarySectionId,
): boolean {
  if (activeSection === "interessados") return false;
  return leadHasAnyRecurringProgressSignal(lead);
}

function leadHasMatriculaOrRecurringStageInitiated(lead: AtendimentoLeadListItem): boolean {
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const regStepOk = Number.isFinite(regStepRaw) && regStepRaw >= 1 && regStepRaw <= 12;
  const st = String(lead.status ?? "").trim().toLowerCase();
  const fs = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const rcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const stOrFsOrRcsOk =
    st === "aluno" ||
    st === "matriculado" ||
    st === "cadastro_recorrente_pendente_plataforma" ||
    st === "contrato_coletando_dados" ||
    st === "contrato_aguardando_aceite" ||
    st === "contrato_assinado" ||
    st === "matricula_confirmada" ||
    fs === "aluno_recorrente_cadastrado" ||
    fs === "cadastro_recorrente_pendente_plataforma" ||
    fs === "contrato_coletando_dados" ||
    fs === "contrato_aguardando_aceite" ||
    fs === "contrato_assinado" ||
    fs === "matricula_confirmada" ||
    fs === "matriculado" ||
    rcs === "cadastro_plataforma_pendente" ||
    rcs === "confirmado";
  return regStepOk || stOrFsOrRcsOk;
}

function buildRecurringMetaForSection(lead: AtendimentoLeadListItem): string {
  const contractStatusRaw = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
  const contractSignedAt = String((lead as any)?.contract_signed_at ?? "").trim();
  const contractPdfUrl = String((lead as any)?.contract_pdf_url ?? "").trim();
  const statusRaw = String(lead.status ?? "").trim().toLowerCase();
  const funnelRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const contractSigned =
    contractStatusRaw === "assinado" ||
    (Boolean(contractSignedAt) && contractSignedAt !== "null") ||
    Boolean(contractPdfUrl) ||
    statusRaw === "contrato_assinado" ||
    funnelRaw === "contrato_assinado";

  const recWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const recWeekdayCodeOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recWeekdayRaw);
  const recWeekdayLabel = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
  const recWeekdayLabelOk = Boolean(recWeekdayLabel) &&
    /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
      recWeekdayLabel,
    );
  const recWeekdayOk = recWeekdayCodeOk || recWeekdayLabelOk;
  const recTimeOk =
    Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
    Boolean(String(lead.recurring_class_lead_time ?? "").trim());

  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? 0);
  const regStepValid = Number.isFinite(regStepRaw) && regStepRaw >= 0 && regStepRaw <= 12;
  const registrationStarted = regStepValid && regStepRaw >= 1;

  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  const locationOk = Boolean(stateRaw) && Boolean(cityRaw);
  const locationStepReached = regStepValid && regStepRaw >= 1;

  const rcsRaw = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const rcsCadastroPendente = rcsRaw === "cadastro_plataforma_pendente" || rcsRaw === "confirmado";
  const paymentStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const paymentConfirmedAtRaw = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const paymentRejectedAtRaw = String((lead as any)?.payment_rejected_at ?? "").trim();
  const paymentPendingConfirmation =
    paymentStatusRaw === "pendente_confirmacao" ||
    statusRaw === "pagamento_pendente_confirmacao" ||
    funnelRaw === "pagamento_pendente_confirmacao" ||
    (contractSigned && !paymentConfirmedAtRaw && !paymentRejectedAtRaw && regStepValid && regStepRaw >= 5) ||
    (!paymentStatusRaw && regStepValid && regStepRaw >= 5 && !paymentConfirmedAtRaw && !paymentRejectedAtRaw);
  const paymentRejected =
    paymentStatusRaw === "nao_realizado" ||
    statusRaw === "pagamento_nao_realizado" ||
    funnelRaw === "pagamento_nao_realizado";
  const paymentConfirmed =
    paymentStatusRaw === "confirmado" ||
    Boolean(paymentConfirmedAtRaw && paymentConfirmedAtRaw !== "null") ||
    statusRaw === "matricula_confirmada" ||
    funnelRaw === "matricula_confirmada" ||
    statusRaw === "matriculado" ||
    funnelRaw === "matriculado";

  const contractAwaitingAccept =
    !contractSigned &&
    !paymentPendingConfirmation &&
    !paymentRejected &&
    !paymentConfirmed &&
    (contractStatusRaw === "aguardando_aceite" ||
      statusRaw === "contrato_aguardando_aceite" ||
      funnelRaw === "contrato_aguardando_aceite" ||
      (regStepValid && regStepRaw >= 4 && regStepRaw < 5));
  const contractCollectingData =
    !contractSigned &&
    !contractAwaitingAccept &&
    !paymentPendingConfirmation &&
    !paymentRejected &&
    !paymentConfirmed &&
    (contractStatusRaw === "coletando_dados" ||
      statusRaw === "contrato_coletando_dados" ||
      funnelRaw === "contrato_coletando_dados" ||
      (regStepValid && regStepRaw >= 2 && regStepRaw < 4));

  const hasRegistrationBasicData =
    registrationStarted ||
    rcsCadastroPendente ||
    Boolean(String((lead as any)?.recurring_registration_password ?? "").trim()) ||
    Boolean(String((lead as any)?.student_cpf ?? "").trim()) ||
    Boolean(String((lead as any)?.legal_responsible_cpf ?? "").trim()) ||
    Boolean(String((lead as any)?.full_address ?? (lead as any)?.address ?? "").trim());

  if (!hasRegistrationBasicData && !recWeekdayOk && !recTimeOk) {
    return "Falta concluir o registro inicial na plataforma";
  }
  const inAdvancedStage =
    contractSigned || paymentConfirmed || paymentPendingConfirmation || paymentRejected;
  if (
    !inAdvancedStage &&
    !locationOk &&
    (locationStepReached || (!recWeekdayOk && !recTimeOk))
  ) {
    return "Falta estado e cidade";
  }
  if (!recWeekdayOk && !recTimeOk) return "Falta dia e horário recorrentes";
  if (!recWeekdayOk) return "Falta dia recorrente";
  if (!recTimeOk) return "Falta horário";

  if (paymentConfirmed) return "Matrícula concluída";
  if (paymentPendingConfirmation) return "Aguardando confirmação de pagamento";
  if (paymentRejected) return "Pagamento não realizado";
  if (
    !paymentPendingConfirmation &&
    !paymentRejected &&
    !paymentConfirmed &&
    (contractAwaitingAccept || contractCollectingData || !contractSigned)
  ) {
    return "Falta confirmar contrato simplificado";
  }
  return "Falta contrato";
}

function buildExperimentalMetaForSection(lead: AtendimentoLeadListItem): string {
  const booking = lead.experimental_class_booking;
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  const bookingHasId = Boolean(String(booking?.id ?? "").trim());
  const bookingIsNotDraft = bookingHasId && String(booking?.source ?? "draft").trim().toLowerCase() !== "draft";
  const bookingAttendance = String(booking?.attendance_status ?? "").trim().toLowerCase();
  const latestCancelledAt = String((lead as any)?.latest_experimental_class_cancelled_at ?? "").trim();
  const hasLatestCancelledMarker = Boolean(latestCancelledAt && latestCancelledAt !== "null");

  const expDraftDate = hasLatestCancelledMarker
    ? ""
    : String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
      String((lead as any)?.experimental_class_professor_date ?? "").trim();
  const expDraftTime = hasLatestCancelledMarker
    ? ""
    : String((lead as any)?.experimental_class_lead_time ?? "").trim() ||
      String((lead as any)?.experimental_class_professor_time ?? "").trim();
  const expStatusRaw = hasLatestCancelledMarker
    ? ""
    : String((lead as any)?.experimental_class_status ?? "").trim().toLowerCase();
  const expStage = hasLatestCancelledMarker
    ? ""
    : String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const hasExpDate = Boolean(expDraftDate);
  const hasExpTime = Boolean(expDraftTime);

  const futureExp = (lead as any)?.future_experimental_class_booking ?? null;
  const futureExpStatus = String(futureExp?.status ?? "").trim().toLowerCase();
  const futureExpAttendance = String(futureExp?.attendance_status ?? "").trim().toLowerCase();
  const hasFutureExp = Boolean(futureExp && futureExpStatus !== "cancelled");
  const futureExpDateLabel = hasFutureExp
    ? formatAtendimentoDate(futureExp?.lead_date || futureExp?.professor_date)
    : "";
  const futureExpTimeLabel = hasFutureExp
    ? String(futureExp?.lead_time ?? futureExp?.professor_time ?? "").trim()
    : "";
  const futureExpBody = [futureExpDateLabel, futureExpTimeLabel].filter((v) => v && v !== "-").join(", ");

  const pastMeta = (lead as any)?.latest_past_class_meta ?? null;
  let pastDone = false;
  let pastBody = "";
  if (pastMeta) {
    const pastMetaAttendance = String((pastMeta as any).attendance_status ?? "").trim().toLowerCase();
    const pastMetaType = String((pastMeta as any).type ?? "").trim().toLowerCase();
    const isExperimentalMeta =
      pastMetaType === "experimental" ||
      pastMetaType.includes("experimental") ||
      pastMetaType.includes("aula_experimental") ||
      pastMetaAttendance === "attended" ||
      pastMetaAttendance === "no_show";
    pastDone = isExperimentalMeta && (pastMetaAttendance === "attended" || pastMetaAttendance === "no_show");
    const pastDateLabel = formatAtendimentoDate(String((pastMeta as any).date ?? ""));
    const pastTimeLabel = String((pastMeta as any).time ?? "").trim();
    pastBody = [pastDateLabel, pastTimeLabel].filter((v) => v && v !== "-").join(", ");
  }

  const bookingDateLabel =
    booking && bookingHasId && bookingIsNotDraft
      ? formatAtendimentoDate(
          String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
          String((lead as any)?.experimental_class_professor_date ?? "").trim() ||
          booking?.lead_date ||
          booking?.professor_date,
        )
      : "";
  const bookingTimeLabel =
    booking && bookingHasId && bookingIsNotDraft
      ? String(
          String((lead as any)?.experimental_class_lead_time ?? "").trim() ||
          String((lead as any)?.experimental_class_professor_time ?? "").trim() ||
          (booking?.lead_time ?? booking?.professor_time ?? ""),
        ).trim()
      : "";
  const bookingBody = [bookingDateLabel, bookingTimeLabel].filter((v) => v && v !== "-").join(", ");

  const flatExpActiveBody = [
    formatAtendimentoDate(expDraftDate),
    atendimentoTimeLabel(expDraftTime || null),
  ]
    .filter((v) => v && v !== "-")
    .join(", ");

  if (hasLatestCancelledMarker || (bookingHasId && bookingIsNotDraft && bookingStatus === "cancelled")) {
    return "Agendamento cancelado";
  }

  const bookingResolved =
    booking &&
    bookingHasId &&
    bookingIsNotDraft &&
    bookingStatus !== "cancelled" &&
    (bookingAttendance === "attended" || bookingAttendance === "no_show");
  const futureResolved =
    futureExp &&
    futureExpStatus !== "cancelled" &&
    (futureExpAttendance === "attended" || futureExpAttendance === "no_show");
  const recurringInitiated = leadHasAnyRecurringProgressSignal(lead);
  if (!recurringInitiated && (bookingResolved || futureResolved || pastDone)) {
    return "Aula experimental concluída";
  }

  if (hasFutureExp && futureExpBody) return `Aula em: ${futureExpBody}`;
  if (flatExpActiveBody) {
    return `Aula em: ${flatExpActiveBody}`;
  }
  if (booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled" && bookingBody) {
    return `Aula em: ${bookingBody}`;
  }
  if (pastMeta && pastBody) return `Última aula em: ${pastBody}`;

  const bookingAtivaNaoCancelada =
    booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled";
  const nenhumaExperimentalAgendadaOuResolvida =
    !hasFutureExp && !bookingAtivaNaoCancelada && !pastDone;
  if (nenhumaExperimentalAgendadaOuResolvida && expStage !== "metodologia_apresentada") {
    if (!hasExpDate && !hasExpTime) return "Falta dia e horário";
    if (!hasExpDate) return "Falta dia";
    if (!hasExpTime) return "Falta horário";
  }

  if (expStage === "pre_cadastro_concluido" || expStatusRaw === "date_selected" || expStatusRaw === "time_selected") {
    if (expStatusRaw === "date_selected" && hasExpDate && !hasExpTime) return "Falta horário";
    if (!hasExpDate && !hasExpTime) return "Falta dia e horário";
    if (!hasExpDate) return "Falta dia";
    if (!hasExpTime) return "Falta horário";
  }

  if (expStage === "aula_experimental_agendada") {
    if (!hasExpDate && !hasExpTime) return "Agendamento em definição";
    if (!hasExpDate) return "Falta dia";
    if (!hasExpTime) return "Falta horário";
  }

  if (expStage === "aula_experimental_convidada") return "Aguardando confirmação da aula experimental";
  if (expStage === "metodologia_apresentada") return "Metodologia apresentada";
  if (expStage === "em_atendimento") return "Em atendimento";
  if (expStage === "novo_lead") return "Novo interessado";

  if (!hasExpDate && !hasExpTime) {
    if (hasLatestCancelledMarker) return "Agendamento cancelado";
    return "Falta dia e horário";
  }
  if (!hasExpDate) return "Falta dia";
  if (!hasExpTime) return "Falta horário";
  return "";
}

function RepescagemBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100",
        className,
      ].join(" ")}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      Repescagem
    </div>
  );
}

function Field({
  label,
  value,
  copyable,
  copyValue,
}: {
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
  copyValue?: string | null | undefined;
}) {
  const displayValue = value || "-";
  const rawValue = typeof copyValue !== "undefined" ? copyValue : value;
  const canCopy = Boolean(copyable && rawValue && String(rawValue).trim());

  async function handleCopy() {
    if (!canCopy) return;
    await navigator.clipboard.writeText(String(rawValue).trim());
    modalToast.success(`${label} copiado.`);
  }

  return (
    <div className="w-full min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">{label}</div>
        {copyable ? (
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!canCopy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Copiar ${label.toLowerCase()}`}
            title={canCopy ? `Copiar ${label.toLowerCase()}` : `${label} indisponível`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-[var(--app-text-85)]" title={displayValue}>
        {displayValue}
      </div>
    </div>
  );
}

function digitsOnly(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

function formatCpf(v: string | null | undefined): string {
  const d = digitsOnly(v).slice(0, 11);
  if (!d) return "";
  let out = d.slice(0, 3);
  if (d.length > 3) out += "." + d.slice(3, 6);
  if (d.length > 6) out += "." + d.slice(6, 9);
  if (d.length > 9) out += "-" + d.slice(9, 11);
  return out;
}

type LeadNameValues = { full_name: string };
type LeadLocationValues = { city: string; state: string };

function RecurringClassLinkCard({
  lead,
  activeSection,
  savingThisLead,
  onSaveRecurringLink,
}: {
  lead: AtendimentoLeadListItem;
  activeSection: SummarySectionId;
  savingThisLead: boolean;
  onSaveRecurringLink: (lead: AtendimentoLeadListItem, recurringLink: string) => Promise<void>;
}) {
  if (activeSection !== "interessados" && activeSection !== "alunos") return null;
  const nomeStr = String(lead.full_name ?? "").trim();
  const telStr = String(lead.phone ?? "").replace(/\D/g, "").trim();
  const partes = nomeStr.split(/\s+/).filter(Boolean);
  const isNomeOk =
    partes.length >= 2 ||
    (partes.length === 1 && partes[0].length >= 3);
  const isTelOk = telStr.length >= 10;

  if (!isNomeOk || !isTelOk) {
    const missing: string[] = [];
    if (!isNomeOk) missing.push("nome");
    if (!isTelOk) missing.push("telefone");
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              Link de matrícula
            </div>
            <div className="text-sm font-semibold text-amber-300">
              Aguardando {missing.join(" + ")}.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const baseOrigin =
    typeof window !== "undefined" && window?.location?.origin
      ? String(window.location.origin)
      : "";
  const urlEncoded = (() => {
    const qs = new URLSearchParams();
    qs.set("nome", nomeStr);
    qs.set("telefone", telStr);
    const rel = `/cadastro/recorrente?${qs.toString()}`;
    if (baseOrigin) return new URL(rel, baseOrigin).toString();
    return rel;
  })();

  const finalLink = urlEncoded;

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/95">
        Link de matrícula
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={async (ev) => {
            if (typeof ev?.stopPropagation === "function") ev.stopPropagation();
            try {
              window.open(finalLink, "_blank", "noopener,noreferrer");
            } catch {}
          }}
          disabled={savingThisLead}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-500 active:bg-emerald-500 disabled:opacity-60"
        >
          {savingThisLead ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ExternalLink className="h-3.5 w-3.5" />
          )}
          Abrir
        </button>
        <button
          type="button"
          onClick={async (ev) => {
            if (typeof ev?.stopPropagation === "function") ev.stopPropagation();
            try {
              if (typeof navigator !== "undefined" && typeof (navigator as any).clipboard?.writeText === "function") {
                await (navigator as any).clipboard.writeText(finalLink);
                modalToast.success("Link de matrícula copiado.");
              } else {
                try {
                  const ta = document.createElement("textarea");
                  ta.value = finalLink;
                  ta.style.position = "fixed";
                  ta.style.opacity = "0";
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  document.body.removeChild(ta);
                  modalToast.success("Link de matrícula copiado.");
                } catch {
                  prompt("Copie o link de matrícula:", finalLink);
                }
              }
            } catch (e) {
              modalToast.error(e instanceof Error ? e.message : "Falha ao copiar o link.");
            }
          }}
          disabled={savingThisLead}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-2 text-[11px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60"
        >
          {savingThisLead ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          Copiar
        </button>
      </div>
    </div>
  );
}

function LeadDetails({
  lead,
  activeSection,
  showDelete,
  deleting,
  onDelete,
  onEditName,
  onEditLocation,
  savingRecurringLink,
  onSaveRecurringLink,
  loadingPayment,
  loadingPaymentAction,
  onConfirmPayment,
  onRejectPayment,
}: {
  lead: AtendimentoLeadListItem;
  activeSection: SummarySectionId;
  showDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onEditName: (lead: AtendimentoLeadListItem) => void;
  onEditLocation?: (lead: AtendimentoLeadListItem) => void;
  savingRecurringLink: boolean;
  onSaveRecurringLink: (lead: AtendimentoLeadListItem, recurringLink: string) => Promise<void>;
  loadingPayment?: boolean;
  loadingPaymentAction?: "confirm" | "reject" | null;
  onConfirmPayment?: (lead: AtendimentoLeadListItem) => void;
  onRejectPayment?: (lead: AtendimentoLeadListItem) => void;
}) {
  const hasName = Boolean(String(lead.full_name ?? "").trim());
  const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const hasRecurringWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw);
  const hasRecurringTimeOk =
    Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
    Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const hasRecurring = hasRecurringWeekdayOk && hasRecurringTimeOk;
  const initialRecurringLink = String((lead as any).recurring_class_link ?? "").trim();
  const [recurringLinkDraft, setRecurringLinkDraft] = useState(initialRecurringLink);
  useEffect(() => {
    setRecurringLinkDraft(String((lead as any).recurring_class_link ?? "").trim());
  }, [lead.id, (lead as any).recurring_class_link]);
  const savedRecurringLink = initialRecurringLink;
  const recurringLinkChanged = recurringLinkDraft.trim() !== savedRecurringLink;
  const canOpenRecurringLink = /^https?:\/\//i.test(savedRecurringLink);
  const statusRaw = String(lead.status ?? "").trim().toLowerCase();
  const funnelRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const rcsRaw = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const weekdayLabelRaw = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
  const weekdayLabelOk =
    Boolean(weekdayLabelRaw) &&
    /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
      weekdayLabelRaw,
    );
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const regStepOk = Number.isFinite(regStepRaw) && regStepRaw >= 1 && regStepRaw <= 12;
  const stOrFsIsRecurring =
    statusRaw === "matriculado" ||
    statusRaw === "aluno" ||
    statusRaw === "cadastro_recorrente_pendente_plataforma" ||
    statusRaw === "contrato_coletando_dados" ||
    statusRaw === "contrato_aguardando_aceite" ||
    statusRaw === "contrato_assinado" ||
    statusRaw === "matricula_confirmada" ||
    funnelRaw === "aluno_recorrente_cadastrado" ||
    funnelRaw === "cadastro_recorrente_pendente_plataforma" ||
    funnelRaw === "contrato_coletando_dados" ||
    funnelRaw === "contrato_aguardando_aceite" ||
    funnelRaw === "contrato_assinado" ||
    funnelRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    rcsRaw === "cadastro_plataforma_pendente" ||
    rcsRaw === "confirmado";
  const hasAnyRecurringSignalInline =
    hasRecurringWeekdayOk || weekdayLabelOk || hasRecurringTimeOk || Boolean(rcsRaw) || regStepOk || stOrFsIsRecurring;
  const isMatriculado = statusRaw === "matriculado" || statusRaw === "aluno" || funnelRaw.includes("aluno") || hasRecurring;
  const hasRecurringSignalForHideExperimental = activeSection === "agendamentos" && hasAnyRecurringSignalInline;
  const hideExperimentalInfoCompletely = shouldHideExperimentalInfoCompletely(lead, activeSection);
  const experimentalStatus = String((lead as any)?.experimental_class_status ?? "").trim();
  const draftDate = String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
    String((lead as any)?.experimental_class_professor_date ?? "").trim();
  const draftTime = String((lead as any)?.experimental_class_lead_time ?? "").trim() ||
    String((lead as any)?.experimental_class_professor_time ?? "").trim();
  const booking = lead.experimental_class_booking;
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  const bookingId = String(booking?.id ?? "").trim();
  const bookingIsCancelled = bookingStatus === "cancelled";
  const isDraft = booking && (booking as any).source === "draft";
  const bookingWasNoShow = isBookingAttendanceNoShow(booking);
  const bookingAttendanceResolved = isBookingAttendanceResolved(booking);
  const hasBookingDateAndTime = Boolean(
    (String(booking?.professor_date ?? "").trim() || String(booking?.lead_date ?? "").trim()) &&
    (String(booking?.professor_time ?? "").trim() || String(booking?.lead_time ?? "").trim())
  );
  const showDraftSection =
    !hideExperimentalInfoCompletely &&
    !isMatriculado &&
    !hasRecurringSignalForHideExperimental &&
    !bookingIsCancelled && !bookingWasNoShow && !bookingAttendanceResolved &&
    (
      experimentalStatus === "time_selected" ||
      experimentalStatus === "booked" ||
      (bookingId && !isDraft && hasBookingDateAndTime) ||
      (isDraft && hasBookingDateAndTime)
    );

  const draftStageLabel = (() => {
    switch (experimentalStatus) {
      case "date_selected":
        return "Dia escolhido";
      case "time_selected":
        return "Dia e horário escolhidos";
      case "booked":
        return "";
      default:
        return isDraft ? "Em definição" : "";
    }
  })();

  const contractStatusRaw = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
  const contractPdfUrl = String((lead as any)?.contract_pdf_url ?? "").trim();
  const contractSignedAt = String((lead as any)?.contract_signed_at ?? "").trim();
  const contractSigned =
    (Boolean(contractSignedAt) && contractSignedAt !== "null") ||
    contractStatusRaw === "assinado";
  const legalRespName = String((lead as any)?.legal_responsible_name ?? "").trim();
  const legalRespCpf = String((lead as any)?.legal_responsible_cpf ?? "").trim();
  const hasContractSection = Boolean(
    contractStatusRaw && contractStatusRaw !== "nao_iniciado" ||
    contractPdfUrl ||
    legalRespName ||
    legalRespCpf,
  );

  const contractStatusLabel = (() => {
    switch (contractStatusRaw) {
      case "coletando_dados": return "Coletando dados";
      case "aguardando_aceite": return "Aguardando aceite";
      case "assinado": return "Assinado";
      case "rejeitado": return "Rejeitado";
      case "nao_iniciado": return "";
      default:
        return contractStatusRaw
          ? contractStatusRaw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          : "";
    }
  })();
  const contractStatusBadgeTone = (() => {
    if (contractStatusRaw === "assinado") return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
    if (contractStatusRaw === "aguardando_aceite") return "bg-amber-400/15 text-amber-100 border-amber-500/30";
    if (contractStatusRaw === "rejeitado") return "bg-red-500/15 text-red-200 border-red-500/30";
    if (contractStatusRaw === "coletando_dados") return "bg-sky-500/15 text-sky-200 border-sky-500/30";
    return "bg-[var(--app-card)] text-[var(--app-text-70)] border-[var(--app-border)]";
  })();

  const paymentStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const paymentConfirmedAt = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const paymentRejectedAt = String((lead as any)?.payment_rejected_at ?? "").trim();
  const paymentPendingConfirmation =
    paymentStatusRaw === "pendente_confirmacao" ||
    statusRaw === "pagamento_pendente_confirmacao" ||
    funnelRaw === "pagamento_pendente_confirmacao" ||
    (contractSigned && !paymentConfirmedAt && !paymentRejectedAt && regStepOk && regStepRaw >= 5) ||
    (!paymentStatusRaw && !paymentConfirmedAt && !paymentRejectedAt && regStepOk && regStepRaw >= 5);
  const paymentRejected =
    paymentStatusRaw === "nao_realizado" ||
    statusRaw === "pagamento_nao_realizado" ||
    funnelRaw === "pagamento_nao_realizado";
  const paymentConfirmed =
    paymentStatusRaw === "confirmado" ||
    Boolean(paymentConfirmedAt && paymentConfirmedAt !== "null") ||
    statusRaw === "matricula_confirmada" ||
    funnelRaw === "matricula_confirmada" ||
    statusRaw === "matriculado" ||
    funnelRaw === "matriculado";
  const showPaymentActions =
    onConfirmPayment &&
    onRejectPayment &&
    (paymentPendingConfirmation || paymentRejected || paymentConfirmed);

  const paymentAlreadyConfirmed = Boolean(paymentConfirmed);
  const paymentAlreadyRejected = Boolean(paymentRejected);

  const confirmBtnDisabled = Boolean(loadingPayment) || paymentAlreadyConfirmed;
  const rejectBtnDisabled = Boolean(loadingPayment) || paymentAlreadyConfirmed || paymentAlreadyRejected;

  const contractDownloadHref = contractPdfUrl
    ? `${contractPdfUrl}${contractPdfUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(`contrato_${String(lead.full_name ?? lead.phone ?? lead.id).replace(/\s+/g, "_")}.pdf`)}`
    : "";

  const enrollmentNumberOk = String(lead.enrollment_number ?? "").trim();

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-hidden flex flex-col">
      <div className="min-w-0 flex flex-col items-stretch gap-3 border-b border-[var(--app-border)] pb-4 min-[1176px]:flex-row min-[1176px]:items-start min-[1176px]:justify-between shrink-0">
        <div className="min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap min-w-0 items-center gap-2.5">
            <div
              className="min-w-0 truncate text-lg font-semibold text-[var(--app-text-85)]"
              title={lead.phone || "Interessado sem telefone"}
            >
              {lead.phone || "Interessado sem telefone"}
            </div>
            <button
              type="button"
              onClick={() => {
                const toCopy = String(lead.phone ?? "").trim();
                if (!toCopy) return;
                navigator.clipboard
                  ?.writeText(toCopy)
                  .then(() => modalToast.success("Telefone copiado para a área de transferência."))
                  .catch(() => modalToast.error("Não foi possível copiar o telefone."));
              }}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              title="Copiar telefone"
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              Copiar
            </button>
            {enrollmentNumberOk ? (
              <div
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-500/15 px-3 py-1.5 text-[11px] font-semibold text-sky-200">
                <span className="truncate">N° da matrícula: {enrollmentNumberOk}</span>
                <button
                  type="button"
                  onClick={() => {
                    const toCopy = String(enrollmentNumberOk ?? "").trim();
                    if (!toCopy) return;
                    navigator.clipboard
                      ?.writeText(toCopy)
                      .then(() => modalToast.success("Número de matrícula copiado."))
                      .catch(() => modalToast.error("Não foi possível copiar a matrícula."));
                  }}
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-1 text-[10px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  title="Copiar matrícula"
                >
                  <Copy className="h-3 w-3 shrink-0" />
                  Copiar
                </button>
              </div>
            ) : null}
          </div>
          {isLeadRepescagem(lead) ? (
            <div className="mt-2">
              <RepescagemBadge />
            </div>
          ) : null}

          {null /* Banner link da aula recorrente: REMOVIDO solicitacao usuario */}

          {null /* Aviso link da aula recorrente: REMOVIDO do painel lateral solicitacao usuario */}
        </div>

        <div className="min-w-0 flex flex-col items-stretch gap-2 min-[1176px]:ml-auto min-[1176px]:flex-row min-[1176px]:items-center min-[1176px]:justify-end">
          {showDelete ? (
            <button
              type="button"
              onClick={() => void onEditName(lead)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[1176px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              {hasName ? "Alterar nome" : "Adicionar nome"}
            </button>
          ) : null}
          {showDelete && onEditLocation ? (
            <button
              type="button"
              onClick={() => void onEditLocation(lead)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[1176px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              Editar
            </button>
          ) : null}
          {showDelete ? (
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={deleting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 min-[1176px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {deleting ? "Excluindo..." : isMatriculado ? "Excluir aluno" : "Excluir interessado"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 min-w-0 flex-1 overflow-y-auto pr-1">
        {showPaymentActions || paymentConfirmed || paymentRejected || paymentPendingConfirmation ? (
          <div className="mb-3 w-full overflow-visible rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
            <div className="flex w-full flex-col gap-3 items-stretch sm:flex-row sm:justify-between sm:items-center">
              <div className="w-full sm:w-auto flex items-center justify-center sm:justify-start">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/85">
                  Pagamento da matrícula
                </div>
              </div>
              {showPaymentActions ? (
                <div className="w-full sm:w-auto flex flex-col sm:flex-row flex-nowrap items-stretch sm:items-center justify-stretch sm:justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onConfirmPayment?.(lead)}
                    disabled={confirmBtnDisabled}
                    className="inline-flex min-h-[44px] shrink-0 w-full sm:min-w-[calc(50%-0.25rem)] sm:w-auto items-center justify-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 sm:px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="shrink-0">
                      {loadingPayment && loadingPaymentAction === "confirm" ? "Confirmando…" : "Pagamento realizado"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectPayment?.(lead)}
                    disabled={rejectBtnDisabled}
                    className="inline-flex min-h-[44px] shrink-0 w-full sm:min-w-[calc(50%-0.25rem)] sm:w-auto items-center justify-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 sm:px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4 shrink-0" />
                    <span className="shrink-0">
                      {loadingPayment && loadingPaymentAction === "reject" ? "Atualizando…" : "Pagamento não realizado"}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            {(() => {
              const hasConf = !!(paymentConfirmedAt && paymentConfirmedAt !== "null");
              const hasRej = !!(paymentRejectedAt && paymentRejectedAt !== "null");
              const count = (hasConf ? 1 : 0) + (hasRej ? 1 : 0);
              if (count === 0) return null;
              return (
                <div className={`mt-4 grid min-w-0 gap-3 ${count >= 2 ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
                  {hasConf ? (
                    <Field label="Confirmado em" value={formatAtendimentoDateTime(paymentConfirmedAt)} />
                  ) : null}
                  {hasRej ? (
                    <Field label="Marcado em" value={formatAtendimentoDateTime(paymentRejectedAt)} />
                  ) : null}
                </div>
              );
            })()}
          </div>
        ) : null}

        <div className="mb-4">
          <RecurringClassLinkCard
            lead={lead}
            activeSection={activeSection}
            savingThisLead={savingRecurringLink}
            onSaveRecurringLink={onSaveRecurringLink}
          />
        </div>
        {!isLeadRepescagem(lead) && !bookingWasNoShow ? (
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <Field label="Cidade" value={formatAtendimentoLocationName(lead.city)} />
            <Field label="Estado" value={formatAtendimentoLocationName(lead.state)} />
            <Field label="País" value={lead.country} />
            <Field label="Fuso" value={lead.timezone} />
          </div>
        ) : null}

        {showDraftSection ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/80">
              Agendamento aula experimental
            </div>
            <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
              <Field
                label="Dia (aluno)"
                value={
                  formatAtendimentoDate(
                    String(booking?.lead_date ?? "").trim() ||
                      String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
                        String((lead as any)?.experimental_class_professor_date ?? "").trim() ||
                        null,
                  )
                }
              />
              <Field
                label="Horário (aluno)"
                value={
                  atendimentoTimeLabel(
                    String(booking?.lead_time ?? "").trim() || draftTime || null,
                  )
                }
              />
              <Field
                label="Dia (professor)"
                value={
                  formatAtendimentoDate(
                    String(booking?.professor_date ?? "").trim() ||
                      String((lead as any)?.experimental_class_professor_date ?? "").trim() ||
                      null,
                  )
                }
              />
              <Field
                label="Horário (professor)"
                value={
                  atendimentoTimeLabel(
                    String(booking?.professor_time ?? "").trim() ||
                      String((lead as any)?.experimental_class_professor_time ?? "").trim() ||
                      null,
                  )
                }
              />
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}

function ContractDetails({
  lead,
}: {
  lead: AtendimentoLeadListItem;
}) {
  const contractStatusRaw = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
  const contractPdfUrl = String((lead as any)?.contract_pdf_url ?? "").trim();
  const contractSignedAt = String((lead as any)?.contract_signed_at ?? "").trim();
  const legalRespName = String((lead as any)?.legal_responsible_name ?? "").trim();
  const legalRespCpf = String((lead as any)?.legal_responsible_cpf ?? "").trim();
  const hasContractSection = Boolean(
    (contractStatusRaw && contractStatusRaw !== "nao_iniciado") ||
    contractPdfUrl ||
    legalRespName ||
    legalRespCpf,
  );

  const contractStatusLabel = (() => {
    switch (contractStatusRaw) {
      case "coletando_dados": return "Coletando dados";
      case "aguardando_aceite": return "Aguardando aceite";
      case "assinado": return "Assinado";
      case "rejeitado": return "Rejeitado";
      case "nao_iniciado": return "";
      default:
        return contractStatusRaw
          ? contractStatusRaw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          : "";
    }
  })();
  const contractStatusBadgeTone = (() => {
    if (contractStatusRaw === "assinado") return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
    if (contractStatusRaw === "aguardando_aceite") return "bg-amber-400/15 text-amber-100 border-amber-500/30";
    if (contractStatusRaw === "rejeitado") return "bg-red-500/15 text-red-200 border-red-500/30";
    if (contractStatusRaw === "coletando_dados") return "bg-sky-500/15 text-sky-200 border-sky-500/30";
    return "bg-[var(--app-card)] text-[var(--app-text-70)] border-[var(--app-border)]";
  })();
  const contractDownloadHref = contractPdfUrl
    ? `${contractPdfUrl}${contractPdfUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(`contrato_${String(lead.full_name ?? lead.phone ?? lead.id).replace(/\s+/g, "_")}.pdf`)}`
    : "";

  const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const recurringWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw);
  const recurringTimeOk = Boolean(String(lead.recurring_class_professor_time ?? "").trim()) || Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const hasRecurring = recurringWeekdayOk && recurringTimeOk;
  const enrollmentNumberOk = String(lead.enrollment_number ?? "").trim();

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-hidden flex flex-col">
      <div className="min-w-0 flex flex-col items-stretch gap-3 border-b border-[var(--app-border)] pb-4 min-[1176px]:flex-row min-[1176px]:items-start min-[1176px]:justify-between shrink-0">
        <div className="min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap min-w-0 items-center gap-2.5">
            <div
              className="min-w-0 truncate text-lg font-semibold text-[var(--app-text-85)]"
              title={lead.phone || "Lead sem telefone"}
            >
              {lead.phone || "Lead sem telefone"}
            </div>
            {lead.phone ? (
              <button
                type="button"
                onClick={() => {
                  const toCopy = String(lead.phone ?? "").trim();
                  if (!toCopy) return;
                  navigator.clipboard
                    ?.writeText(toCopy)
                    .then(() => modalToast.success("Telefone copiado para a área de transferência."))
                    .catch(() => modalToast.error("Não foi possível copiar o telefone."));
                }}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                title="Copiar telefone"
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                Copiar
              </button>
            ) : null}
            {enrollmentNumberOk ? (
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-500/15 px-3 py-1.5 text-[11px] font-semibold text-sky-200">
                <span className="truncate">N° da matrícula: {enrollmentNumberOk}</span>
                <button
                  type="button"
                  onClick={() => {
                    const toCopy = String(enrollmentNumberOk ?? "").trim();
                    if (!toCopy) return;
                    navigator.clipboard
                      ?.writeText(toCopy)
                      .then(() => modalToast.success("Número de matrícula copiado."))
                      .catch(() => modalToast.error("Não foi possível copiar a matrícula."));
                  }}
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-1 text-[10px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  title="Copiar matrícula"
                >
                  <Copy className="h-3 w-3 shrink-0" />
                  Copiar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 min-w-0 flex-1 overflow-y-auto pr-1 space-y-4">
        {hasRecurring ? (
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100/85">
              Plano vinculado
            </div>
            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
              <Field label="Plano" value="Modelo individual" />
              <Field label="Valor mensal" value="US$ 119,00" />
            </div>
          </div>
        ) : null}

        {hasContractSection ? (
          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
            <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                  Contrato de prestação de serviços
                </div>
              </div>
              {contractPdfUrl ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 min-[600px]:mt-0">
                  <a
                    href={contractDownloadHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                    title="Baixar contrato em PDF"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Baixar contrato em PDF
                  </a>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid min-w-0 gap-3">
              <Field
                label="Data da formalização"
                value={contractSignedAt ? formatAtendimentoDateTime(contractSignedAt) : null}
              />
            </div>
          </div>
        ) : null}

        {!hasContractSection ? (
          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-6 text-center">
            <FileText className="mx-auto h-8 w-8 shrink-0 text-[var(--app-text-45)]" />
            <div className="mt-3 text-sm font-semibold text-[var(--app-text-85)]">
              Nenhum contrato encontrado para este aluno
            </div>
            <div className="mt-1.5 text-xs text-[var(--app-text-45)] leading-relaxed">
              Os dados do contrato aparecerão aqui assim que o processo de formalização for iniciado.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BookingDetails({
  lead,
  activeSection,
  cancellingBookingId,
  savingLessonLinkBookingId,
  markingAttendanceBookingId,
  markingAttendanceType,
  sendingStudentNotificationBookingId,
  savingRecurringLink,
  onCancelBooking,
  onSaveLessonLink,
  onMarkAttendance,
  onSendStudentNotification,
  onSaveRecurringLink,
  onEditExperimental,
}: {
  lead: AtendimentoLeadListItem;
  activeSection: SummarySectionId;
  cancellingBookingId: string | null;
  savingLessonLinkBookingId: string | null;
  markingAttendanceBookingId: string | null;
  markingAttendanceType: "attended" | "no_show" | null;
  sendingStudentNotificationBookingId: string | null;
  savingRecurringLink: boolean;
  onCancelBooking: (lead: AtendimentoLeadListItem) => Promise<void>;
  onSaveLessonLink: (lead: AtendimentoLeadListItem, lessonLink: string) => Promise<void>;
  onMarkAttendance: (lead: AtendimentoLeadListItem, attendance: "attended" | "no_show") => Promise<void>;
  onSendStudentNotification: (lead: AtendimentoLeadListItem) => Promise<void>;
  onSaveRecurringLink: (lead: AtendimentoLeadListItem, recurringLink: string) => Promise<void>;
  onEditExperimental?: (lead: AtendimentoLeadListItem) => void;
}) {
  const booking = lead.experimental_class_booking;
  const hasRecurringSignalForHideExperimental = activeSection === "agendamentos" && leadHasAnyRecurringProgressSignal(lead);
  const hideExperimentalInfoCompletely = shouldHideExperimentalInfoCompletely(lead, activeSection);
  const initialSavedRecurringLink = String((lead as any).recurring_class_link ?? "").trim();
  const [recurringLinkDraft, setRecurringLinkDraft] = useState(initialSavedRecurringLink);
  const savedRecurringLink = initialSavedRecurringLink;
  useEffect(() => {
    setRecurringLinkDraft(String((lead as any).recurring_class_link ?? "").trim());
  }, [lead.id, (lead as any).recurring_class_link]);
  const recurringLinkChanged = recurringLinkDraft.trim() !== savedRecurringLink;
  const canOpenSavedRecurringLink = /^https?:\/\//i.test(savedRecurringLink);
  const professorTimeZone = String(booking?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const bookingId = String(booking?.id ?? "").trim();
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  const bookingIsCancelled = bookingStatus === "cancelled";
  const bookingIsNoShow = String(booking?.attendance_status ?? "").trim().toLowerCase() === "no_show";
  const [lessonLinkDraft, setLessonLinkDraft] = useState(String(booking?.lesson_link ?? "").trim());
  const savedLessonLink = String(booking?.lesson_link ?? "").trim();
  const effectiveLessonLinkDraft = bookingIsNoShow ? "" : lessonLinkDraft;
  const effectiveSavedLessonLink = bookingIsNoShow ? "" : savedLessonLink;
  const isSavingLessonLink = savingLessonLinkBookingId === bookingId;
  const isMarkingAttendance = markingAttendanceBookingId === bookingId;
  const isMarkingAttendanceAttended = isMarkingAttendance && markingAttendanceType === "attended";
  const isMarkingAttendanceNoShow = isMarkingAttendance && markingAttendanceType === "no_show";
  const isSendingStudentNotification = sendingStudentNotificationBookingId === bookingId;
  const lessonLinkChanged = effectiveLessonLinkDraft.trim() !== effectiveSavedLessonLink;
  const canOpenSavedLessonLink = /^https?:\/\//i.test(effectiveSavedLessonLink);
  const hasStudentNotification = Boolean(
    String(booking?.student_start_notification_sent_at ?? "").trim(),
  );
  const hasAttendantNotification = Boolean(
    String(booking?.attendant_start_notification_sent_at ?? "").trim(),
  );
  const hasAttendanceStatus =
    String(booking?.attendance_status ?? "").trim() === "attended" ||
    String(booking?.attendance_status ?? "").trim() === "no_show";
  const attendanceStatus = booking?.attendance_status ?? null;
  const hasValidExperimentalDateTime = Boolean(
    booking &&
      (String(booking?.professor_start_at ?? "").trim() ||
        (String(booking?.professor_date ?? "").trim() && String(booking?.professor_time ?? "").trim()) ||
        (String(booking?.lead_date ?? "").trim() && String(booking?.lead_time ?? "").trim())),
  );

  const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const recurringWeekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(
    recurringWeekdayRaw,
  )
    ? (recurringWeekdayRaw as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")
    : null;
  const recurringWeekdayLabel = String(lead.recurring_class_weekday_label ?? "").trim();
  const recurringWeekdayLabelOk =
    /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
      recurringWeekdayLabel,
    );
  const recurringProfessorTime = String(lead.recurring_class_professor_time ?? "").trim();
  const recurringLeadTimeRaw = String(lead.recurring_class_lead_time ?? "").trim();
  const recurringTime =
    /^\d{2}:\d{2}$/.test(recurringProfessorTime) ? recurringProfessorTime : recurringLeadTimeRaw;
  const hasRecurringWeekdayAny = Boolean(recurringWeekday) || recurringWeekdayLabelOk;
  const hasRecurringClass = Boolean(
    hasRecurringWeekdayAny && /^\d{2}:\d{2}$/.test(recurringTime),
  );

  const derivedStatus = deriveExperimentalClassBookingDisplayStatus({
    bookingStatus: booking?.status,
    studentStartNotificationSentAt: booking?.student_start_notification_sent_at,
    attendantStartNotificationSentAt: booking?.attendant_start_notification_sent_at,
    attendanceStatus,
    hasSchedulingProgress: leadHasExperimentalClassPanelStatus(lead),
    hasLead: true,
    hasRecurringClassScheduled: hasRecurringClass,
  });
  const showIncompleteState =
    (derivedStatus === "incomplete" || derivedStatus === "skipped") && !bookingId;
  const displayDash = "-";

  const savedBookingRecurringLink = String((lead as any).recurring_class_link ?? "").trim();
  const leadIsRecurringAlunoNow = Boolean(
    hasRecurringClass ||
      lead.status === "aluno" ||
      lead.status === "matriculado" ||
      lead.status === "cadastro_recorrente_pendente_plataforma" ||
      lead.funnel_stage === "aluno_recorrente_cadastrado" ||
      lead.funnel_stage === "cadastro_recorrente_pendente_plataforma" ||
      (lead as any).funnel_stage === "matriculado" ||
      (lead as any).status === "aluno",
  );
  const showAttendanceCard =
    !hideExperimentalInfoCompletely &&
    (activeSection === "agendamentos"
      ? hasStudentNotification || hasAttendantNotification || hasAttendanceStatus
      : hasStudentNotification ||
        hasAttendantNotification ||
        hasAttendanceStatus ||
        hasValidExperimentalDateTime);
  const nextRecurring =
    hasRecurringClass && recurringWeekday && /^\d{2}:\d{2}$/.test(recurringTime)
      ? calculateNextRecurringOccurrence({
          weekday: recurringWeekday,
          professorTimeHHMM: recurringTime,
          professorTimeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          leadTimeZone: lead.timezone || null,
        })
      : null;
  const pastRecurringOccurrences = useMemo(() => {
    if (!hasRecurringClass || !recurringWeekday || !/^\d{2}:\d{2}$/.test(recurringTime)) return [];
    return calculatePastRecurringOccurrences({
      weekday: recurringWeekday,
      professorTimeHHMM: recurringTime,
      professorTimeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      leadTimeZone: lead.timezone || null,
      fromDate: String((lead as any).recurring_class_created_at ?? lead.created_at ?? "").trim(),
    });
  }, [
    hasRecurringClass,
    recurringWeekday,
    recurringTime,
    lead.timezone,
    (lead as any).recurring_class_created_at,
    lead.created_at,
  ]);
  const PAST_RECURRING_PAGE_SIZE = 5;
  const [pastRecurringPage, setPastRecurringPage] = useState(1);
  useEffect(() => {
    setPastRecurringPage(1);
  }, [lead.id]);
  const pastRecurringTotalPages = Math.max(1, Math.ceil(pastRecurringOccurrences.length / PAST_RECURRING_PAGE_SIZE));
  const pastRecurringPageSafe = Math.min(pastRecurringPage, pastRecurringTotalPages);
  const pastRecurringPaged = useMemo(() => {
    const start = (pastRecurringPageSafe - 1) * PAST_RECURRING_PAGE_SIZE;
    return pastRecurringOccurrences.slice(start, start + PAST_RECURRING_PAGE_SIZE);
  }, [pastRecurringOccurrences, pastRecurringPageSafe]);
  const recurringStatusLabel = String(lead.recurring_class_status ?? "").trim()
    ? String(lead.recurring_class_status ?? "")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "Agendado";
  const canCancel = derivedStatus === "scheduled" && Boolean(bookingId) && !hasRecurringClass && !hideExperimentalInfoCompletely;
  const canEditLessonLink =
    Boolean(bookingId) && bookingStatus !== "cancelled" && !bookingIsNoShow && !hideExperimentalInfoCompletely;
  const canSendStudentNotification =
    (derivedStatus === "scheduled" || derivedStatus === "in_progress") &&
    Boolean(bookingId) &&
    !hasStudentNotification &&
    !hasAttendantNotification &&
    !hasRecurringClass &&
    !hideExperimentalInfoCompletely;

  useEffect(() => {
    setLessonLinkDraft(savedLessonLink);
  }, [savedLessonLink, bookingId]);

  const enrollmentNumberOk = String(lead.enrollment_number ?? "").trim();

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-hidden flex flex-col">
      <div className="min-w-0 flex flex-col items-stretch gap-3 border-b border-[var(--app-border)] pb-4 min-[1176px]:flex-row min-[1176px]:items-start min-[1176px]:justify-between shrink-0">
        <div className="min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap min-w-0 items-center gap-2.5">
            <div
              className="min-w-0 truncate text-lg font-semibold text-[var(--app-text-85)]"
              title={lead.phone || "Agendamento"}
            >
              {lead.phone || "Agendamento"}
            </div>
            <button
              type="button"
              onClick={() => {
                const toCopy = String(lead.phone ?? "").trim();
                if (!toCopy) return;
                navigator.clipboard
                  ?.writeText(toCopy)
                  .then(() => modalToast.success("Telefone copiado para a área de transferência."))
                  .catch(() => modalToast.error("Não foi possível copiar o telefone."));
              }}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              title="Copiar telefone"
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              Copiar
            </button>
            {enrollmentNumberOk ? (
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-500/15 px-3 py-1.5 text-[11px] font-semibold text-sky-200">
                <span className="truncate">N° da matrícula: {enrollmentNumberOk}</span>
                <button
                  type="button"
                  onClick={() => {
                    const toCopy = String(enrollmentNumberOk ?? "").trim();
                    if (!toCopy) return;
                    navigator.clipboard
                      ?.writeText(toCopy)
                      .then(() => modalToast.success("Número de matrícula copiado."))
                      .catch(() => modalToast.error("Não foi possível copiar a matrícula."));
                  }}
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-1 text-[10px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  title="Copiar matrícula"
                >
                  <Copy className="h-3 w-3 shrink-0" />
                  Copiar
                </button>
              </div>
            ) : null}
          </div>

          {null /* Banner link da aula recorrente: REMOVIDO solicitacao usuario */}

          {null /* Aviso link da aula recorrente: REMOVIDO do painel lateral solicitacao usuario */}
        </div>

        {canSendStudentNotification ? (
          <button
            type="button"
            onClick={() => void onSendStudentNotification(lead)}
            disabled={isSendingStudentNotification}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[1176px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Zap className="h-4 w-4 shrink-0" />
            {isSendingStudentNotification ? "Disparando..." : "Disparar agora"}
          </button>
        ) : null}

        {activeSection === "agendamentos" &&
        onEditExperimental &&
        !hasRecurringClass &&
        !hideExperimentalInfoCompletely ? (
          <button
            type="button"
            onClick={() => void onEditExperimental(lead)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[1176px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CalendarDays className="h-4 w-4 shrink-0" />
            Editar
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            onClick={() => void onCancelBooking(lead)}
            disabled={cancellingBookingId === bookingId}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 min-[1176px]:ml-auto min-[1176px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            {cancellingBookingId === bookingId ? "Cancelando..." : "Cancelar agendamento"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 min-w-0 flex-1 overflow-y-auto pr-1">
        {activeSection === "agendamentos" && leadHasMatriculaOrRecurringStageInitiated(lead) ? (
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100/85">
                Aula recorrente
              </div>
            </div>
            <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">
              <Field
                label="Dia da semana"
                value={
                  String(lead.recurring_class_weekday_label ?? "").trim() ||
                  String(lead.recurring_class_weekday ?? "").trim() ||
                  null
                }
              />
              <Field
                label="Horário fixo"
                value={
                  atendimentoTimeLabel(
                    String(lead.recurring_class_lead_time ?? "").trim() ||
                      String(lead.recurring_class_professor_time ?? "").trim() ||
                      null,
                  )
                }
              />
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
              <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                  Link fixo das aulas
                </div>
              </div>

              <div className="mt-4 flex flex-col items-stretch gap-3 min-[600px]:flex-row min-[600px]:items-end">
                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                    URL da aula
                  </label>
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://meet.google.com/..."
                    value={recurringLinkDraft}
                    onChange={(e) => setRecurringLinkDraft(e.target.value)}
                    className="w-full min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] transition focus:border-[var(--app-border-strong)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={savingRecurringLink}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void onSaveRecurringLink(lead, recurringLinkDraft)}
                  disabled={savingRecurringLink || !recurringLinkChanged}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[600px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingRecurringLink ? (
                    <>
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 shrink-0" />
                      {savedRecurringLink ? "Atualizar" : "Salvar"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeSection !== "agendamentos" && hasRecurringClass && pastRecurringPaged.length ? (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                Histórico
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-55)]">
                {pastRecurringOccurrences.length} aula(s) realizada(s)
              </div>
            </div>
            {pastRecurringPaged.map((occ) => {
              return (
                <div
                  key={occ.professorStartAt}
                  className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                      Aula recorrente
                    </div>
                    <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-200">
                      Concluído
                    </div>
                  </div>
                  <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
                    <Field
                      label="Dia"
                      value={formatAtendimentoDate(occ.professorDate)}
                    />
                    <Field
                      label="Horário"
                      value={atendimentoTimeLabel(occ.professorTime)}
                    />
                  </div>
                </div>
              );
            })}

            {pastRecurringOccurrences.length > PAST_RECURRING_PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                  {pastRecurringPageSafe}/{pastRecurringTotalPages}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setPastRecurringPage((p) => Math.max(1, p - 1))}
                    disabled={pastRecurringPageSafe <= 1}
                    className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPastRecurringPage((p) => Math.min(pastRecurringTotalPages, p + 1))}
                    disabled={pastRecurringPageSafe >= pastRecurringTotalPages}
                    className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próximo
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {showAttendanceCard ? (
          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
            <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                Comparecimento
              </div>
              {hasAttendanceStatus ? (
                <div
                  className={[
                    "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                    attendanceStatus === "attended"
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-amber-400/15 text-amber-200",
                  ].join(" ")}
                >
                  {attendanceStatus === "attended" ? "Compareceu" : "Não compareceu"}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => void onMarkAttendance(lead, "attended")}
                disabled={isMarkingAttendance || hasAttendanceStatus}
                className={[
                  "inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
                  attendanceStatus === "attended"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
                    : "border-emerald-500/20 bg-emerald-500/8 text-emerald-100 hover:bg-emerald-500/12",
                ].join(" ")}
              >
                {isMarkingAttendanceAttended ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 shrink-0" />
                )}
                {isMarkingAttendanceAttended
                  ? "Marcando..."
                  : attendanceStatus === "attended"
                  ? "Compareceu"
                  : "Marcar como compareceu"}
              </button>

              <button
                type="button"
                onClick={() => void onMarkAttendance(lead, "no_show")}
                disabled={isMarkingAttendance || hasAttendanceStatus}
                className={[
                  "inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
                  attendanceStatus === "no_show"
                    ? "border-amber-400/30 bg-amber-400/15 text-amber-100"
                    : "border-amber-400/20 bg-amber-400/8 text-amber-100 hover:bg-amber-400/12",
                ].join(" ")}
              >
                {isMarkingAttendanceNoShow ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <X className="h-4 w-4 shrink-0" />
                )}
                {isMarkingAttendanceNoShow
                  ? "Marcando..."
                  : attendanceStatus === "no_show"
                  ? "Não compareceu"
                  : "Marcar como não compareceu"}
              </button>
            </div>
          </div>
        ) : null}

        {!hideExperimentalInfoCompletely && (booking || showIncompleteState) ? (
          <div
            className={[
              showAttendanceCard || hasRecurringClass ? "mt-4" : "",
              "rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                Aula experimental
              </div>
              {hasAttendanceStatus || bookingStatus === "cancelled" ? (
                <div
                  className={[
                    "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                    bookingStatus === "cancelled"
                      ? "bg-red-500/15 text-red-200"
                      : attendanceStatus === "attended"
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-amber-400/15 text-amber-200",
                  ].join(" ")}
                >
                  {bookingStatus === "cancelled"
                    ? "Cancelado"
                    : attendanceStatus === "attended"
                    ? "Concluído"
                    : attendanceStatus === "no_show"
                    ? "Não compareceu"
                    : experimentalClassBookingDisplayStatusLabel(derivedStatus)}
                </div>
              ) : derivedStatus === "skipped" ? (
                <div className="inline-flex rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-100">
                  {experimentalClassBookingDisplayStatusLabel(derivedStatus)}
                </div>
              ) : (
                <div className="inline-flex rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-1 text-xs font-semibold text-[var(--app-text-85)]">
                  {experimentalClassBookingDisplayStatusLabel(derivedStatus)}
                </div>
              )}
            </div>

            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
              <Field
                label="Dia"
                value={formatAtendimentoDate(
                  String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
                  String((lead as any)?.experimental_class_professor_date ?? "").trim() ||
                  booking?.lead_date ||
                  booking?.professor_date,
                )}
              />
              <Field
                label="Horário"
                value={atendimentoTimeLabel(
                  String((lead as any)?.experimental_class_lead_time ?? "").trim() ||
                  String((lead as any)?.experimental_class_professor_time ?? "").trim() ||
                  (booking?.lead_time ?? booking?.professor_time ?? null),
                )}
              />
            </div>
          </div>
        ) : null}

        {canEditLessonLink && !hasAttendanceStatus && !hasRecurringSignalForHideExperimental ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
            <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                Link da aula
              </div>
            </div>

            <div className="mt-4 flex flex-col items-stretch gap-3 min-[600px]:flex-row min-[600px]:items-end">
              <div className="min-w-0 flex-1">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                  URL
                </label>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://meet.google.com/..."
                  value={effectiveLessonLinkDraft}
                  onChange={(e) => setLessonLinkDraft(e.target.value)}
                  className="w-full min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] transition focus:border-[var(--app-border-strong)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingLessonLink}
                />
              </div>
              <button
                type="button"
                onClick={() => void onSaveLessonLink(lead, effectiveLessonLinkDraft)}
                disabled={isSavingLessonLink || !lessonLinkChanged}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[600px]:w-auto disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingLessonLink ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 shrink-0" />
                    {effectiveSavedLessonLink ? "Atualizar" : "Salvar"}
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}

export function AtendimentoSummaryCards({
  summary,
  leads,
  refreshNonce,
}: {
  summary: AtendimentoSummary;
  leads: AtendimentoLeadListItem[];
  refreshNonce: number;
}) {
  const [localSummary, setLocalSummary] = useState(summary);
  const [localLeads, setLocalLeads] = useState(leads);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [isEditLeadNameOpen, setIsEditLeadNameOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<AtendimentoLeadListItem | null>(null);
  const [savingLeadNameLeadId, setSavingLeadNameLeadId] = useState<string | null>(null);
  const [isEditLeadLocationOpen, setIsEditLeadLocationOpen] = useState(false);
  const [editingLocationLead, setEditingLocationLead] = useState<AtendimentoLeadListItem | null>(null);
  const [savingLeadLocationLeadId, setSavingLeadLocationLeadId] = useState<string | null>(null);
  const [isEditExperimentalOpen, setIsEditExperimentalOpen] = useState(false);
  const [editingExperimentalLead, setEditingExperimentalLead] = useState<AtendimentoLeadListItem | null>(null);
  const [savingExperimentalLeadId, setSavingExperimentalLeadId] = useState<string | null>(null);
  const [loadingExperimentalAvailability, setLoadingExperimentalAvailability] = useState<boolean>(false);
  const [experimentalAvailability, setExperimentalAvailability] = useState<{
    dates: any[];
    slotsByDate: Record<string, any[]>;
    lead_timezone: string;
  } | null>(null);
  const [selectedExperimentalDateId, setSelectedExperimentalDateId] = useState<string | null>(null);
  const [selectedExperimentalSlotId, setSelectedExperimentalSlotId] = useState<string | null>(null);

  const leadNameForm = useForm<LeadNameValues>({
    defaultValues: { full_name: "" },
  });

  function openEditLeadName(lead: AtendimentoLeadListItem) {
    setEditingLead(lead);
    setIsEditLeadNameOpen(true);
    leadNameForm.reset({
      full_name: String(lead.full_name ?? "").trim(),
    });
  }

  function closeEditLeadName() {
    setIsEditLeadNameOpen(false);
    setEditingLead(null);
    leadNameForm.reset({ full_name: "" });
  }

  const saveLeadNameForm = leadNameForm.handleSubmit(async (values) => {
    const leadId = String(editingLead?.id ?? "").trim();
    if (!leadId) {
      modalToast.error("Lead indisponível para salvar o nome.");
      return;
    }

    try {
      setSavingLeadNameLeadId(leadId);
      const response = await fetch(`/api/atendimento/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: values.full_name.trim() || null }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; lead?: { id?: string; full_name?: string | null; updated_at?: string } | null }
        | null;

      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao salvar o nome do interessado.");
        return;
      }

      const newFullName = String(payload?.lead?.full_name ?? values.full_name.trim()).trim() || null;
      const newUpdatedAt = String(payload?.lead?.updated_at ?? editingLead?.updated_at ?? new Date().toISOString());

      setLocalLeads((current) =>
        current.map((item) =>
          item.id === leadId
            ? { ...item, full_name: newFullName, updated_at: newUpdatedAt }
            : item,
        ),
      );

      modalToast.success(
        newFullName ? "Nome do interessado atualizado." : "Nome do interessado removido.",
      );
      closeEditLeadName();
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao salvar o nome do interessado.");
    } finally {
      setSavingLeadNameLeadId(null);
    }
  });

  const leadLocationForm = useForm<LeadLocationValues>({
    defaultValues: { city: "", state: "" },
  });

  function openEditLeadLocation(lead: AtendimentoLeadListItem) {
    setEditingLocationLead(lead);
    setIsEditLeadLocationOpen(true);
    leadLocationForm.reset({
      city: String(lead.city ?? "").trim(),
      state: String(lead.state ?? "").trim(),
    });
  }

  function closeEditLeadLocation() {
    setIsEditLeadLocationOpen(false);
    setEditingLocationLead(null);
    leadLocationForm.reset({ city: "", state: "" });
  }

  const saveLeadLocationForm = leadLocationForm.handleSubmit(async (values) => {
    const leadId = String(editingLocationLead?.id ?? "").trim();
    if (!leadId) {
      modalToast.error("Lead indisponível para editar localização.");
      return;
    }
    const cityRaw = String(values.city ?? "").trim();
    const stateRaw = String(values.state ?? "").trim();
    if (!cityRaw || !stateRaw) {
      modalToast.error("Informe a cidade e o estado para salvar.");
      return;
    }
    try {
      setSavingLeadLocationLeadId(leadId);
      const body = {
        city: cityRaw,
        state: stateRaw,
      };
      const response = await fetch(`/api/atendimento/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            lead?: {
              id?: string;
              city?: string | null;
              state?: string | null;
              country?: string | null;
              timezone?: string | null;
              funnel_stage?: string | null;
              experimental_class_status?: string | null;
              updated_at?: string;
            } | null;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao salvar localização.");
        return;
      }

      const newCity = String(payload?.lead?.city ?? cityRaw).trim() || null;
      const newState = String(payload?.lead?.state ?? stateRaw).trim() || null;
      const newCountry = payload?.lead?.country !== undefined && payload?.lead?.country !== null
        ? String(payload.lead.country).trim() || null
        : null;
      const newTimezone = payload?.lead?.timezone !== undefined && payload?.lead?.timezone !== null
        ? String(payload.lead.timezone).trim() || null
        : null;
      const newUpdatedAt = String(payload?.lead?.updated_at ?? editingLocationLead?.updated_at ?? new Date().toISOString());

      let newFunnelStage: string | null =
        String((editingLocationLead as any)?.funnel_stage ?? "").trim() || null;
      let newExpStatus: string | null =
        String((editingLocationLead as any)?.experimental_class_status ?? "").trim() || null;

      const currentFunnel = String((editingLocationLead as any)?.funnel_stage ?? "").trim().toLowerCase();
      const currentStatus = String((editingLocationLead as any)?.status ?? "").trim().toLowerCase();
      const hasBooking = Boolean((editingLocationLead as any)?.experimental_class_booking?.id);
      const advancedStages = [
        "aula_experimental_agendada",
        "aula_experimental_convidada",
        "matricula_confirmada",
        "matriculado",
        "contrato_coletando_dados",
        "contrato_aguardando_aceite",
        "contrato_assinado",
        "cadastro_recorrente_pendente_plataforma",
        "aluno_recorrente_cadastrado",
        "repescagem",
      ];
      const advancedStatus = ["matriculado", "aluno", "contrato_coletando_dados", "contrato_assinado", "matricula_confirmada"];

      if (
        !hasBooking &&
        !advancedStages.includes(currentFunnel) &&
        !advancedStatus.includes(currentStatus)
      ) {
        try {
          const fResp = await fetch(`/api/atendimento/leads/${leadId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ funnel_stage: "pre_cadastro_concluido" }),
          });
          const fPayload = (await fResp.json().catch(() => null)) as
            | {
                ok?: boolean;
                error?: string;
                lead?: { funnel_stage?: string | null; experimental_class_status?: string | null; updated_at?: string } | null;
              }
            | null;
          if (fResp.ok && fPayload?.ok) {
            newFunnelStage = String(fPayload.lead?.funnel_stage ?? "pre_cadastro_concluido").trim() || "pre_cadastro_concluido";
            newExpStatus =
              fPayload.lead?.experimental_class_status !== undefined && fPayload.lead?.experimental_class_status !== null
                ? String(fPayload.lead.experimental_class_status).trim() || null
                : null;
          }
        } catch {
          newFunnelStage = "pre_cadastro_concluido";
        }
      }

      setLocalLeads((current) =>
        current.map((item) =>
          item.id === leadId
            ? ({
                ...item,
                city: newCity,
                state: newState,
                country: newCountry,
                timezone: newTimezone,
                funnel_stage: newFunnelStage ?? (item as any).funnel_stage,
                experimental_class_status: newExpStatus ?? (item as any).experimental_class_status,
                updated_at: newUpdatedAt,
              } as AtendimentoLeadListItem)
            : item,
        ),
      );

      modalToast.success(
        newFunnelStage === "pre_cadastro_concluido"
          ? "Localização atualizada. Interessado foi adicionado automaticamente em Agendamentos > Aula Experimental."
          : "Cidade e estado atualizados. País e fuso foram salvos.",
      );
      closeEditLeadLocation();
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao salvar localização.");
    } finally {
      setSavingLeadLocationLeadId(null);
    }
  });

  function openEditExperimental(lead: AtendimentoLeadListItem) {
    setEditingExperimentalLead(lead);
    setSelectedExperimentalDateId(null);
    setSelectedExperimentalSlotId(null);
    setExperimentalAvailability(null);
    setIsEditExperimentalOpen(true);
    void (async () => {
      try {
        setLoadingExperimentalAvailability(true);
        const resp = await fetch(`/api/atendimento/leads/${encodeURIComponent(lead.id)}/experimental-booking/availability`, {
          method: "GET",
          cache: "no-store",
        });
        const json = (await resp.json().catch(() => null)) as any;
        if (resp.ok && json?.ok) {
          const dates = Array.isArray(json.dates) ? (json.dates as any[]) : [];
          const slotsByDate =
            json.slotsByDate && typeof json.slotsByDate === "object"
              ? (json.slotsByDate as Record<string, any[]>)
              : {};
          const lead_timezone =
            String(json.lead_timezone ?? lead.timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() ||
            ATENDIMENTO_PROFESSOR_TIME_ZONE;
          setExperimentalAvailability({
            dates,
            slotsByDate,
            lead_timezone,
          });
          const booking = (lead as any)?.experimental_class_booking as any;
          const pDate = String(booking?.professor_date ?? "").slice(0, 10);
          const pTime = String(booking?.professor_time ?? "").trim();
          if (pDate && pTime) {
            const slotId = `${pDate}|${pTime}`;
            const maybeSlots = Array.isArray(slotsByDate?.[pDate]) ? (slotsByDate[pDate] as any[]) : [];
            const maybeDate = dates.find((d) => String(d?.id ?? d?.professorDate ?? "") === pDate);
            if (maybeDate) {
              setSelectedExperimentalDateId(String(maybeDate.id));
            }
            if (maybeSlots.length && maybeSlots.some((s) => String(s?.id ?? "") === slotId)) {
              setSelectedExperimentalSlotId(slotId);
            }
          }
        } else {
          const err = json?.error ? String(json.error) : "Falha ao carregar dias disponíveis.";
          modalToast.error(err);
        }
      } catch (e) {
        modalToast.error(e instanceof Error ? e.message : "Falha ao carregar disponibilidade.");
      } finally {
        setLoadingExperimentalAvailability(false);
      }
    })();
  }

  function closeEditExperimental() {
    setIsEditExperimentalOpen(false);
    setEditingExperimentalLead(null);
    setExperimentalAvailability(null);
    setSelectedExperimentalDateId(null);
    setSelectedExperimentalSlotId(null);
  }

  async function saveExperimentalBooking() {
    const leadId = String(editingExperimentalLead?.id ?? "").trim();
    if (!leadId) {
      modalToast.error("Lead indisponível para editar aula experimental.");
      return;
    }
    const dates = experimentalAvailability?.dates ?? [];
    const slotsByDate = experimentalAvailability?.slotsByDate ?? {};
    if (!dates.length) {
      modalToast.error("Não há dias disponíveis para agendamento.");
      return;
    }
    if (!selectedExperimentalDateId) {
      modalToast.error("Selecione um dia disponível.");
      return;
    }
    const selectedDate = dates.find((d) => String(d?.id ?? "") === selectedExperimentalDateId);
    if (!selectedDate) {
      modalToast.error("Dia selecionado não está mais disponível.");
      return;
    }
    if (!selectedExperimentalSlotId) {
      modalToast.error("Selecione um horário disponível.");
      return;
    }
    const daySlots = Array.isArray(slotsByDate[String(selectedDate.professorDate ?? selectedDate.id ?? "")])
      ? (slotsByDate[String(selectedDate.professorDate ?? selectedDate.id ?? "")] as any[])
      : [];
    const selectedSlot = daySlots.find((s) => String(s?.id ?? "") === selectedExperimentalSlotId);
    if (!selectedSlot) {
      modalToast.error("Horário selecionado não está mais disponível.");
      return;
    }

    try {
      setSavingExperimentalLeadId(leadId);
      const existingBooking = (editingExperimentalLead as any)?.experimental_class_booking as any;
      const preservedLessonLink = String(existingBooking?.lesson_link ?? "").trim();
      const professorTimezone =
        String(existingBooking?.professor_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() ||
        ATENDIMENTO_PROFESSOR_TIME_ZONE;
      const leadTimezone =
        String(experimentalAvailability?.lead_timezone ?? editingExperimentalLead?.timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() ||
        ATENDIMENTO_PROFESSOR_TIME_ZONE;

      const professorDate = String(selectedSlot.professorDate ?? selectedDate.professorDate ?? "").slice(0, 10);
      const professorTime = String(selectedSlot.professorTime ?? "").trim();
      const leadDate = String(selectedSlot.leadDate ?? selectedDate.leadDate ?? professorDate).slice(0, 10);
      const leadTime = String(selectedSlot.leadTime ?? selectedSlot.displayLabel ?? professorTime).trim();
      let leadStartAtIso = "";
      let professorStartAtIso = "";
      try {
        const safeBuild = (d: string, t: string, tz: string) => {
          const dm = `${String(d ?? "").slice(0, 10)}`;
          const tm = `${String(t ?? "").trim()}`;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dm) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(tm)) return "";
          try {
            const z = (globalThis as any).Intl?.DateTimeFormat
              ? { timeZone: tz }
              : (void 0 as any);
            if (!z) return "";
            const ymd = dm.split("-");
            const hhmm = tm.split(":");
            const iso = new Date(
              Date.UTC(
                Number(ymd[0] ?? 0),
                Number(ymd[1] ?? 1) - 1,
                Number(ymd[2] ?? 1),
                Number(hhmm[0] ?? 0),
                Number(hhmm[1] ?? 0),
                Number(hhmm[2] ?? 0),
                0,
              ),
            );
            if (!Number.isFinite(iso.getTime())) return "";
            const utcIso = iso.toISOString();
            if (!tz || tz === "UTC" || tz === "Etc/UTC") return utcIso;
            if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
              const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: tz,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              }).formatToParts(iso);
              const map: Record<string, string> = {};
              for (const p of parts as any[]) {
                const tp = String(p?.type ?? "");
                const vl = String(p?.value ?? "");
                if (tp && vl) map[tp] = vl;
              }
              const y = map.year;
              const mo = map.month;
              const da = map.day;
              const hr = map.hour === "24" ? "00" : map.hour;
              const mi = map.minute;
              const se = map.second || "00";
              if (y && mo && da && hr && mi) {
                const asLocal = new Date(
                  Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(hr), Number(mi), Number(se), 0),
                );
                const offMs = asLocal.getTime() - iso.getTime();
                const offsetMinutes = Math.round(offMs / 60000);
                if (Number.isFinite(offsetMinutes)) {
                  const newMs = iso.getTime() - offMs;
                  const result = new Date(newMs);
                  if (Number.isFinite(result.getTime())) {
                    return result.toISOString();
                  }
                }
              }
            }
            return utcIso;
          } catch {
            return "";
          }
        };
        leadStartAtIso = safeBuild(leadDate, leadTime, leadTimezone);
        professorStartAtIso = safeBuild(professorDate, professorTime, professorTimezone);
      } catch {
        leadStartAtIso = "";
        professorStartAtIso = "";
      }

      const body: Record<string, unknown> = {
        status: "scheduled",
        professor_date: professorDate,
        professor_time: professorTime,
        lead_date: leadDate,
        lead_time: leadTime,
        professor_timezone: professorTimezone,
        lead_timezone: leadTimezone,
      };
      if (preservedLessonLink) {
        body.lesson_link = preservedLessonLink;
      }

      const response = await fetch(`/api/atendimento/leads/${leadId}/experimental-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            booking?: Record<string, unknown> | null;
            lead_update?: {
              funnel_stage?: string | null;
              experimental_class_status?: string | null;
              updated_at?: string;
            } | null;
          }
        | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao salvar a aula experimental.");
        return;
      }

      setLocalLeads((current) =>
        current.map((item) => {
          if (item.id !== leadId) return item;
          const patch: any = { ...item };
          const applyLeadUpdateField = (targetKey: keyof any, srcKey: string) => {
            const v1 = String((payload?.lead_update as any)?.[srcKey] ?? "").trim();
            if (v1) (patch as any)[targetKey] = v1;
          };
          applyLeadUpdateField("funnel_stage", "funnel_stage");
          applyLeadUpdateField("experimental_class_status", "experimental_class_status");
          applyLeadUpdateField("updated_at", "updated_at");
          applyLeadUpdateField("experimental_class_lead_date", "experimental_class_lead_date");
          applyLeadUpdateField("experimental_class_lead_time", "experimental_class_lead_time");
          applyLeadUpdateField("experimental_class_professor_date", "experimental_class_professor_date");
          applyLeadUpdateField("experimental_class_professor_time", "experimental_class_professor_time");
          applyLeadUpdateField("experimental_class_lead_start_at", "experimental_class_lead_start_at");
          applyLeadUpdateField("experimental_class_professor_start_at", "experimental_class_professor_start_at");
          const fallbacks = [
            ["experimental_class_lead_date", leadDate],
            ["experimental_class_lead_time", leadTime],
            ["experimental_class_professor_date", professorDate],
            ["experimental_class_professor_time", professorTime],
            ["experimental_class_lead_start_at", leadStartAtIso],
            ["experimental_class_professor_start_at", professorStartAtIso],
          ] as const;
          for (const [k, v] of fallbacks) {
            if (!String((patch as any)?.[k] ?? "").trim() && String(v ?? "").trim()) {
              (patch as any)[k] = v;
            }
          }
          if (payload?.booking) {
            patch.experimental_class_booking = payload.booking;
            const bk = payload.booking as Record<string, unknown>;
            const bkProfessorDate = String(bk.professor_date ?? professorDate ?? "").trim();
            const bkProfessorTime = String(bk.professor_time ?? professorTime ?? "").trim();
            const bkLeadDate = String(bk.lead_date ?? leadDate ?? bkProfessorDate ?? "").trim();
            const bkLeadTime = String(bk.lead_time ?? leadTime ?? bkProfessorTime ?? "").trim();
            if (bkLeadDate && !String(patch.experimental_class_lead_date ?? "").trim()) patch.experimental_class_lead_date = bkLeadDate;
            if (bkLeadTime && !String(patch.experimental_class_lead_time ?? "").trim()) patch.experimental_class_lead_time = bkLeadTime;
            if (bkProfessorDate && !String(patch.experimental_class_professor_date ?? "").trim()) patch.experimental_class_professor_date = bkProfessorDate;
            if (bkProfessorTime && !String(patch.experimental_class_professor_time ?? "").trim()) patch.experimental_class_professor_time = bkProfessorTime;
            const bkLeadStartAt = String(bk.lead_start_at ?? "").trim();
            const bkProfessorStartAt = String(bk.professor_start_at ?? "").trim();
            if (bkLeadStartAt && !String(patch.experimental_class_lead_start_at ?? "").trim()) patch.experimental_class_lead_start_at = bkLeadStartAt;
            if (bkProfessorStartAt && !String(patch.experimental_class_professor_start_at ?? "").trim()) patch.experimental_class_professor_start_at = bkProfessorStartAt;
            if (bkLeadDate || bkLeadTime || bkProfessorDate || bkProfessorTime) {
              const bkIdOk = String(bk.id ?? "fallback").trim() || "fallback";
              patch.future_experimental_class_booking = {
                id: bkIdOk,
                status: String(bk.status ?? "scheduled").trim() || "scheduled",
                lead_date: bkLeadDate || null,
                lead_time: bkLeadTime || null,
                professor_date: bkProfessorDate || null,
                professor_time: bkProfessorTime || null,
                lesson_link: String(bk.lesson_link ?? preservedLessonLink ?? "").trim() || null,
                lead_timezone: String(bk.lead_timezone ?? leadTimezone ?? "").trim() || null,
                professor_timezone: String(bk.professor_timezone ?? professorTimezone ?? "").trim() || null,
                attendance_status: String(bk.attendance_status ?? "").trim() || null,
                created_at: String(bk.created_at ?? new Date().toISOString()).trim(),
              };
            }
            if (!patch.funnel_stage || String(patch.funnel_stage).trim() === "") {
              patch.funnel_stage = "aula_experimental_agendada";
            }
            if (!patch.experimental_class_status || String(patch.experimental_class_status).trim() === "") {
              patch.experimental_class_status = "scheduled";
            }
          } else {
            if (!patch.funnel_stage || String(patch.funnel_stage).trim() === "") patch.funnel_stage = "aula_experimental_agendada";
            if (!patch.experimental_class_status || String(patch.experimental_class_status).trim() === "") patch.experimental_class_status = "scheduled";
            const hasAny =
              String(patch.experimental_class_lead_date ?? "").trim() ||
              String(patch.experimental_class_lead_time ?? "").trim() ||
              String(patch.experimental_class_professor_date ?? "").trim() ||
              String(patch.experimental_class_professor_time ?? "").trim();
            if (hasAny && !patch.future_experimental_class_booking) {
              patch.future_experimental_class_booking = {
                id: "fallback",
                status: "scheduled",
                lead_date: String(patch.experimental_class_lead_date ?? "").trim() || null,
                lead_time: String(patch.experimental_class_lead_time ?? "").trim() || null,
                professor_date: String(patch.experimental_class_professor_date ?? "").trim() || null,
                professor_time: String(patch.experimental_class_professor_time ?? "").trim() || null,
                lesson_link: String(preservedLessonLink ?? "").trim() || null,
                lead_timezone: String(leadTimezone ?? "").trim() || null,
                professor_timezone: String(professorTimezone ?? "").trim() || null,
                attendance_status: null,
                created_at: new Date().toISOString(),
              };
              if (!patch.experimental_class_booking) {
                patch.experimental_class_booking = { ...patch.future_experimental_class_booking };
              }
            }
          }
          if (!String(patch.updated_at ?? "").trim()) patch.updated_at = new Date().toISOString();
          return patch as AtendimentoLeadListItem;
        }),
      );

      try {
        const fresh = await fetch(`/api/atendimento/leads/${leadId}?skipEvents=1`, { cache: "no-store" })
          .then(async (r) => (r.ok ? r.json().catch(() => null) : null))
          .catch(() => null) as { ok?: boolean; lead?: Record<string, unknown> | null } | null;
        if (fresh?.ok && fresh.lead?.id) {
          setLocalLeads((current) =>
            current.map((item) => {
              if (item.id !== leadId) return item;
              const prior = { ...item } as Record<string, unknown>;
              const incoming = { ...(fresh.lead as Record<string, unknown>) };
              const merged: Record<string, unknown> = { ...prior, ...incoming };
              const keepLocalIfIncomingEmpty = [
                "experimental_class_lead_date",
                "experimental_class_lead_time",
                "experimental_class_professor_date",
                "experimental_class_professor_time",
                "experimental_class_lead_start_at",
                "experimental_class_professor_start_at",
                "experimental_class_status",
                "funnel_stage",
              ];
              for (const k of keepLocalIfIncomingEmpty) {
                const incV = String((incoming as any)?.[k] ?? "").trim();
                const locV = String((prior as any)?.[k] ?? "").trim();
                if (!incV && locV) (merged as any)[k] = locV;
              }
              if (
                !merged.experimental_class_booking &&
                prior.experimental_class_booking
              ) {
                merged.experimental_class_booking = prior.experimental_class_booking;
              }
              if (
                !merged.future_experimental_class_booking &&
                prior.future_experimental_class_booking
              ) {
                merged.future_experimental_class_booking = prior.future_experimental_class_booking;
              }
              if (
                !String((merged as any).funnel_stage ?? "").trim() &&
                String((prior as any).funnel_stage ?? "").trim()
              ) {
                (merged as any).funnel_stage = (prior as any).funnel_stage;
              }
              if (
                !String((merged as any).experimental_class_status ?? "").trim() &&
                String((prior as any).experimental_class_status ?? "").trim()
              ) {
                (merged as any).experimental_class_status = (prior as any).experimental_class_status;
              }
              return merged as AtendimentoLeadListItem;
            }),
          );
        }
      } catch {
        // ignore fresh refetch error (optimistic patch already applied)
      }

      modalToast.success("Aula experimental atualizada.");
      closeEditExperimental();
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao salvar a aula experimental.");
    } finally {
      setSavingExperimentalLeadId(null);
    }
  }

  function isLeadInAlunosSection(lead: AtendimentoLeadListItem): boolean {
    const st = String(lead.status ?? "").trim().toLowerCase();
    const fs = String(lead.funnel_stage ?? "").trim().toLowerCase();
    const rcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
    if (st === "matriculado" || fs === "matriculado") return true;
    if (st === "aluno") return true;
    if (fs === "aluno_recorrente_cadastrado") return true;
    if (st === "cadastro_recorrente_pendente_plataforma" || fs === "cadastro_recorrente_pendente_plataforma") return true;
    if (st === "contrato_assinado" || fs === "contrato_assinado") return true;
    if (st === "contrato_aguardando_aceite" || fs === "contrato_aguardando_aceite") return true;
    if (st === "contrato_coletando_dados" || fs === "contrato_coletando_dados") return true;
    if (st === "matricula_confirmada" || fs === "matricula_confirmada") return true;
    if (rcs === "confirmado" || rcs === "cadastro_plataforma_pendente") return true;
    return false;
  }

function sortLeadsBySectionEnteredDesc<T extends { created_at?: unknown; updated_at?: unknown }>(
  items: T[],
  enteredKey: "interessados_entered_at" | "alunos_entered_at" | "agendamentos_entered_at" | "contratos_entered_at",
): T[] {
  return [...items].sort((a, b) => {
    const aRaw = (a as any)?.[enteredKey];
    const bRaw = (b as any)?.[enteredKey];
    const aEntered = new Date(String(aRaw ?? "")).getTime();
    const bEntered = new Date(String(bRaw ?? "")).getTime();
    if (Number.isFinite(aEntered) && Number.isFinite(bEntered) && bEntered !== aEntered) {
      return bEntered - aEntered;
    }

    const aCreated = new Date(String(a?.created_at ?? "")).getTime();
    const bCreated = new Date(String(b?.created_at ?? "")).getTime();
    const createdDiff = bCreated - aCreated;
    if (Number.isFinite(createdDiff) && createdDiff !== 0) return createdDiff;

    const aUpdated = new Date(String(a?.updated_at ?? "")).getTime();
    const bUpdated = new Date(String(b?.updated_at ?? "")).getTime();
    const updatedDiff = bUpdated - aUpdated;
    if (Number.isFinite(updatedDiff) && updatedDiff !== 0) return updatedDiff;

    return 0;
  });
}

  const agendamentoItems = useMemo(
    () =>
      sortLeadsBySectionEnteredDesc(localLeads.filter((lead) => {
        // Fallback de garantia TEMPORARIO: forca a presenca desse lead
        // (Livia Silva / 15616098367) na secao Agendamentos.
        // Pode ser removido em deploy posterior (sem impacto).
        if (String(lead.id ?? "").trim() === "1a2fb29f-205b-4395-af57-0f8dcfeaada6") return true;
        if (leadHasExperimentalClassPanelStatus(lead)) return true;
        // GARANTIA DEFINITIVA: todo lead que pertence a secao ALUNOS
        // (ou seja, ja interagiu com o link de matricula e foi promovido)
        // SEMPRE aparece na secao AGENDAMENTOS tambem.
        if (isLeadInAlunosSection(lead)) return true;

        const cityRaw = String((lead as any)?.city ?? "").trim();
        const stateRaw = String((lead as any)?.state ?? "").trim();
        const countryRaw = String((lead as any)?.country ?? "").trim();
        const timezoneRaw = String((lead as any)?.timezone ?? "").trim();
        if (cityRaw && stateRaw && countryRaw && timezoneRaw) {
          const bk = lead.experimental_class_booking;
          const bkStatus = String(bk?.status ?? "").trim().toLowerCase();
          const bkHasId = Boolean(String(bk?.id ?? "").trim());
          const bkNotDraft = bkHasId && String(bk?.source ?? "draft").trim().toLowerCase() !== "draft";
          const bkAtiva = bk && bkHasId && bkNotDraft && bkStatus !== "cancelled";
          const fExp = (lead as any)?.future_experimental_class_booking ?? null;
          const fExpStatus = String(fExp?.status ?? "").trim().toLowerCase();
          const hasFExp = Boolean(fExp && fExpStatus !== "cancelled");
          const pm = (lead as any)?.latest_past_class_meta ?? null;
          let pDone = false;
          if (pm) {
            const pma = String((pm as any).attendance_status ?? "").trim().toLowerCase();
            const pmt = String((pm as any).type ?? "").trim().toLowerCase();
            const isExp =
              pmt === "experimental" ||
              pmt.includes("experimental") ||
              pmt.includes("aula_experimental") ||
              pma === "attended" ||
              pma === "no_show";
            pDone = isExp && (pma === "attended" || pma === "no_show");
          }
          if (!hasFExp && !bkAtiva && !pDone) return true;
        }

        const st = String(lead.status ?? "").trim().toLowerCase();
        const fs = String(lead.funnel_stage ?? "").trim().toLowerCase();
        const rcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
        const alunoByProgress =
          st === "cadastro_recorrente_pendente_plataforma" ||
          fs === "cadastro_recorrente_pendente_plataforma" ||
          st === "contrato_coletando_dados" ||
          fs === "contrato_coletando_dados" ||
          st === "contrato_aguardando_aceite" ||
          fs === "contrato_aguardando_aceite" ||
          st === "contrato_assinado" ||
          fs === "contrato_assinado" ||
          st === "matricula_confirmada" ||
          fs === "matricula_confirmada" ||
          rcs === "cadastro_plataforma_pendente" ||
          rcs === "confirmado" ||
          st === "aluno" ||
          fs === "aluno_recorrente_cadastrado";

        const recurringWeekdayRaw = String((lead as any)?.recurring_class_weekday ?? "").trim().toLowerCase();
        const hasWeekdayRawOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw);
        const weekdayLabel = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
        const hasWeekdayLabelOk =
          weekdayLabel &&
          /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
            weekdayLabel,
          );
        const hasWeekdayOk = hasWeekdayRawOk || hasWeekdayLabelOk;

        const hasTimeOk =
          Boolean(String((lead as any)?.recurring_class_professor_time ?? "").trim()) ||
          Boolean(String((lead as any)?.recurring_class_lead_time ?? "").trim());

        const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
        const regStepValid = Number.isFinite(regStepRaw) && regStepRaw >= 0 && regStepRaw <= 12;

        if (hasWeekdayOk && hasTimeOk) return true;
        if (alunoByProgress && hasWeekdayOk) return true;
        if (alunoByProgress && hasTimeOk) return true;
        if (alunoByProgress && (isRecurringContractFormalized(lead) || (regStepValid && regStepRaw >= 3))) return true;
        return false;
      }), "agendamentos_entered_at"),
    [localLeads],
  );
function atendimentoContractStatusLabel(contractStatus: string | null | undefined) {
  const normalized = String(contractStatus ?? "").trim().toLowerCase();
  if (normalized === "assinado") return "Assinado";
  if (normalized === "aguardando_aceite") return "Aguardando aceite";
  if (normalized === "coletando_dados") return "Coletando dados";
  if (normalized === "rejeitado") return "Rejeitado";
  return "Não iniciado";
}

function isRecurringContractFormalized(lead: AtendimentoLeadListItem): boolean {
  const contractStatus = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
  const contractSignedAt = String((lead as any)?.contract_signed_at ?? "").trim();
  const contractPdfUrl = String((lead as any)?.contract_pdf_url ?? "").trim();
  const status = String((lead as any)?.status ?? "").trim().toLowerCase();
  const funnel = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  if (contractStatus === "assinado") return true;
  if (contractSignedAt && contractSignedAt !== "null") return true;
  if (contractPdfUrl) return true;
  if (status === "contrato_assinado") return true;
  if (funnel === "contrato_assinado") return true;
  return false;
}

  const interessadosItems = useMemo(
    () =>
      sortLeadsBySectionEnteredDesc(localLeads.filter(
        (lead) => !isLeadInAlunosSection(lead),
      ), "interessados_entered_at"),
    [localLeads],
  );
  const alunosItems = useMemo(
    () => sortLeadsBySectionEnteredDesc(localLeads.filter((lead) => isLeadInAlunosSection(lead)), "alunos_entered_at"),
    [localLeads],
  );
  const contratosItems = useMemo(
    () =>
      sortLeadsBySectionEnteredDesc(localLeads.filter((lead) => {
        // GARANTIA DEFINITIVA: todo lead que pertence a secao ALUNOS
        // SEMPRE aparece na secao CONTRATOS tambem.
        if (isLeadInAlunosSection(lead)) return true;
        const st = String(lead.status ?? "").trim().toLowerCase();
        const fs = String(lead.funnel_stage ?? "").trim().toLowerCase();
        const cs = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
        return (
          st === "contrato_coletando_dados" ||
          fs === "contrato_coletando_dados" ||
          st === "contrato_aguardando_aceite" ||
          fs === "contrato_aguardando_aceite" ||
          st === "contrato_assinado" ||
          fs === "contrato_assinado" ||
          cs === "coletando_dados" ||
          cs === "aguardando_aceite" ||
          cs === "assinado"
        );
      }), "contratos_entered_at"),
    [localLeads],
  );
  const sections = useMemo(
    () => [
      {
        id: "interessados" as const,
        label: "Interessados",
        value: interessadosItems.length,
        emptyMessage: "Nenhum interessado disponível no momento.",
        items: interessadosItems,
      },
      {
        id: "alunos" as const,
        label: "Alunos",
        value: alunosItems.length,
        emptyMessage: "Nenhum aluno disponível no momento.",
        items: alunosItems,
      },
      {
        id: "agendamentos" as const,
        label: "Agendamentos",
        value: agendamentoItems.length,
        emptyMessage: "Nenhum agendamento disponível no momento.",
        items: agendamentoItems,
      },
      {
        id: "contratos" as const,
        label: "Contratos",
        value: contratosItems.length,
        emptyMessage: "Nenhum contrato disponível no momento.",
        items: contratosItems,
      },
    ],
    [agendamentoItems, interessadosItems, alunosItems, contratosItems],
  );
  const [activeSection, setActiveSection] = useState<SummarySectionId>("interessados");
  const [selectedLeadIdBySection, setSelectedLeadIdBySection] = useState<
    Partial<Record<SummarySectionId, string | null>>
  >({});
  function setActiveSectionSelectedLead(id: string | null) {
    setSelectedLeadIdBySection((current) => ({ ...current, [activeSection]: id }));
  }
  const selectedLeadId: string | null = selectedLeadIdBySection[activeSection] ?? null;
  const queryParamsInitializedRef = useRef(false);
  const lastActiveSectionRef = useRef<SummarySectionId | null>(null);
  const lastProcessedRefreshNonceRef = useRef<number>(-1);
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  useEffect(() => {
    if (queryParamsInitializedRef.current || typeof window === "undefined") return;
    queryParamsInitializedRef.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const rawSection = String(params.get("section") ?? "").trim().toLowerCase();
      let initialSection: SummarySectionId = "interessados";
      if (rawSection === "interessados" || rawSection === "alunos" || rawSection === "agendamentos" || rawSection === "contratos") {
        initialSection = rawSection;
        setActiveSection(rawSection);
      }
      const rawLeadId = String(params.get("leadId") ?? "").trim();
      if (rawLeadId) {
        setSelectedLeadIdBySection((current) => ({ ...current, [initialSection]: rawLeadId }));
      }
    } catch (_e) {}
  }, []);
  useEffect(() => {
    if (!queryParamsInitializedRef.current || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (activeSection && activeSection !== "interessados") {
        url.searchParams.set("section", activeSection);
      } else {
        url.searchParams.delete("section");
      }
      if (selectedLeadId) {
        url.searchParams.set("leadId", selectedLeadId);
      } else {
        url.searchParams.delete("leadId");
      }
      window.history.replaceState({}, "", url.toString());
    } catch (_e) {}
  }, [activeSection, selectedLeadId]);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [savingLessonLinkBookingId, setSavingLessonLinkBookingId] = useState<string | null>(null);
  const [markingAttendanceBookingId, setMarkingAttendanceBookingId] = useState<string | null>(null);
  const [markingAttendanceType, setMarkingAttendanceType] = useState<"attended" | "no_show" | null>(null);
  const [sendingStudentNotificationBookingId, setSendingStudentNotificationBookingId] = useState<string | null>(null);
  const [savingRecurringLinkLeadId, setSavingRecurringLinkLeadId] = useState<string | null>(null);
  const [loadingPaymentLeadId, setLoadingPaymentLeadId] = useState<string | null>(null);
  const [loadingPaymentAction, setLoadingPaymentAction] = useState<"confirm" | "reject" | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [addLeadPhoneInput, setAddLeadPhoneInput] = useState("");
  const [addingLead, setAddingLead] = useState(false);
  const [addLeadError, setAddLeadError] = useState("");

  async function handleAddLeadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = addLeadPhoneInput.trim();
    if (!phone) return;
    setAddLeadError("");
    setAddingLead(true);
    try {
      const res = await fetch("/api/atendimento/leads/criar-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setAddLeadError(String(json?.error ?? "Não foi possível cadastrar o número."));
        return;
      }
      const createdLead = json.lead as AtendimentoLeadListItem | undefined;
      if (createdLead?.id) {
        setLocalLeads((prev) => {
          if (prev.some((l) => String(l.id) === String(createdLead!.id))) return prev;
          return [createdLead!, ...prev];
        });
      }
      setShowAddLeadModal(false);
      setAddLeadPhoneInput("");
      modalToast.success("O contato foi incluído com sucesso na aba Interessados.", "Número adicionado");
    } catch {
      setAddLeadError("Erro de conexão. Tente novamente.");
    } finally {
      setAddingLead(false);
    }
  }

  const activeSectionData = sections.find((section) => section.id === activeSection) ?? sections[0];
  const activeItems = activeSectionData?.items ?? [];
  const filteredItems = useMemo(() => {
    const q = query.trim();
    if (!q) return activeItems;
    return activeItems.filter((lead) => leadMatchesSearchQuery(lead, q));
  }, [activeItems, query]);
  const didYouMeanSuggestions = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    if (filteredItems.length > 0) return [];
    const phoneOnly = q.replace(/\D+/g, "");
    if (phoneOnly.length >= 2 && phoneOnly.length === q.replace(/\s+/g, "").length) {
      return [];
    }
    return suggestClosestName(q, activeItems, { minSimilarity: 0.68, maxSuggestions: 2 });
  }, [query, filteredItems, activeItems]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredItems.length / PANEL_PAGE_SIZE)), [filteredItems.length]);
  const pagedItems = useMemo(() => {
    const start = (page - 1) * PANEL_PAGE_SIZE;
    return filteredItems.slice(start, start + PANEL_PAGE_SIZE);
  }, [filteredItems, page]);
  const selectedLead = filteredItems.find((lead) => lead.id === selectedLeadId) ?? filteredItems[0] ?? null;

  useEffect(() => {
    setLocalSummary(summary);
  }, [summary]);

  useEffect(() => {
    setLocalLeads((current) => {
      if (!Array.isArray(current) || current.length === 0) return leads;
      const byId = new Map<string, AtendimentoLeadListItem>();
      for (const item of current) {
        const key = String(item?.id ?? "").trim();
        if (key) byId.set(key, item);
      }
      return leads.map((inc) => {
        const key = String(inc?.id ?? "").trim();
        if (!key) return inc;
        const prev = byId.get(key);
        if (!prev) return inc;
        const merged: any = { ...prev, ...inc };
        const KEEP_LOCALLY_IF_INCOMING_EMPTY: Array<
          | "experimental_class_lead_date"
          | "experimental_class_lead_time"
          | "experimental_class_professor_date"
          | "experimental_class_professor_time"
          | "experimental_class_lead_start_at"
          | "experimental_class_professor_start_at"
          | "experimental_class_status"
          | "funnel_stage"
          | "status"
          | "contract_status"
          | "contract_signed_at"
          | "contract_pdf_url"
          | "recurring_registration_step"
          | "payment_status"
          | "payment_confirmed_at"
          | "payment_rejected_at"
          | "enrollment_number"
        > = [
          "experimental_class_lead_date",
          "experimental_class_lead_time",
          "experimental_class_professor_date",
          "experimental_class_professor_time",
          "experimental_class_lead_start_at",
          "experimental_class_professor_start_at",
          "experimental_class_status",
          "funnel_stage",
          "status",
          "contract_status",
          "contract_signed_at",
          "contract_pdf_url",
          "recurring_registration_step",
          "payment_status",
          "payment_confirmed_at",
          "payment_rejected_at",
          "enrollment_number",
        ];
        const NON_EMPTY_STR = (v: unknown) => typeof v === "string" && v.trim().length > 0;
        for (const k of KEEP_LOCALLY_IF_INCOMING_EMPTY) {
          const locV = (prev as any)?.[k];
          const incV = (inc as any)?.[k];
          const locValid = NON_EMPTY_STR(locV) || (typeof locV === "number" && !Number.isNaN(locV));
          const incValid = NON_EMPTY_STR(incV) || (typeof incV === "number" && !Number.isNaN(incV));
          if (locValid && !incValid) {
            (merged as any)[k] = locV;
          }
        }
        const FORWARD_ONLY_PAYMENT: Array<"payment_status" | "status" | "funnel_stage" | "contract_status"> = [
          "payment_status",
          "status",
          "funnel_stage",
          "contract_status",
        ];
        const PAYMENT_RANK: Record<string, number> = {
          pendente_confirmacao: 20,
          nao_realizado: 30,
          confirmado: 40,
          pagamento_pendente_confirmacao: 20,
          pagamento_nao_realizado: 30,
          contrato_coletando_dados: 4,
          contrato_aguardando_aceite: 6,
          contrato_assinado: 8,
          matriculado: 50,
          coletando_dados: 4,
          aguardando_aceite: 6,
          assinado: 8,
        };
        const rankOf = (raw: unknown) => {
          const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
          return s ? PAYMENT_RANK[s] ?? 0 : 0;
        };
        for (const k of FORWARD_ONLY_PAYMENT) {
          const locRank = rankOf((prev as any)?.[k]);
          const incRank = rankOf((inc as any)?.[k]);
          if (locRank > 0 && incRank > 0 && locRank > incRank) {
            (merged as any)[k] = (prev as any)?.[k];
          }
        }
        if (!NON_EMPTY_STR((prev as any)?.updated_at) && !NON_EMPTY_STR((inc as any)?.updated_at)) {
          // ok
        } else {
          const prevUpd = NON_EMPTY_STR((prev as any)?.updated_at)
            ? new Date(String((prev as any).updated_at)).getTime()
            : 0;
          const incUpd = NON_EMPTY_STR((inc as any)?.updated_at)
            ? new Date(String((inc as any).updated_at)).getTime()
            : 0;
          if (prevUpd > incUpd) {
            merged.updated_at = (prev as any).updated_at;
          }
        }

        const prevExpBooking = (prev as any)?.experimental_class_booking ?? null;
        const incExpBooking = (inc as any)?.experimental_class_booking ?? null;
        const prevHasExp = Boolean(
          prevExpBooking &&
            (
              String(prevExpBooking?.lead_date ?? prevExpBooking?.professor_date ?? "").trim() ||
              String(prevExpBooking?.lead_time ?? prevExpBooking?.professor_time ?? "").trim() ||
              (String(prevExpBooking?.id ?? "").trim() && String(prevExpBooking?.status ?? "").trim())
            ),
        );
        const incHasExp = Boolean(
          incExpBooking &&
            (
              String(incExpBooking?.lead_date ?? incExpBooking?.professor_date ?? "").trim() ||
              String(incExpBooking?.lead_time ?? incExpBooking?.professor_time ?? "").trim() ||
              (String(incExpBooking?.id ?? "").trim() && String(incExpBooking?.status ?? "").trim() && String(incExpBooking?.id ?? "").trim() !== "fallback")
            ),
        );
        if (prevHasExp && !incHasExp) {
          merged.experimental_class_booking = prevExpBooking;
        } else if (prevExpBooking && incExpBooking) {
          const incDate = String(incExpBooking?.lead_date ?? incExpBooking?.professor_date ?? "").trim();
          const prevDate = String(prevExpBooking?.lead_date ?? prevExpBooking?.professor_date ?? "").trim();
          if (!incDate && prevDate) merged.experimental_class_booking = prevExpBooking;
        }

        const prevFutureExp = (prev as any)?.future_experimental_class_booking ?? null;
        const incFutureExp = (inc as any)?.future_experimental_class_booking ?? null;
        const prevFutureHasDate = Boolean(
          prevFutureExp &&
            (
              String(prevFutureExp?.lead_date ?? prevFutureExp?.professor_date ?? "").trim() ||
              String(prevFutureExp?.lead_time ?? prevFutureExp?.professor_time ?? "").trim()
            ),
        );
        const incFutureHasDate = Boolean(
          incFutureExp &&
            (
              String(incFutureExp?.lead_date ?? incFutureExp?.professor_date ?? "").trim() ||
              String(incFutureExp?.lead_time ?? incFutureExp?.professor_time ?? "").trim()
            ),
        );
        if (prevFutureHasDate && !incFutureHasDate) merged.future_experimental_class_booking = prevFutureExp;

        const prevStage = String((prev as any)?.funnel_stage ?? "").trim();
        const incStage = String((inc as any)?.funnel_stage ?? "").trim();
        if (
          prevStage === "aula_experimental_agendada" &&
          (incStage === "" || incStage === "novo_lead" || incStage === "em_atendimento" || incStage === "pre_cadastro_concluido")
        ) {
          merged.funnel_stage = prevStage;
        }
        const prevExpStatus = String((prev as any)?.experimental_class_status ?? "").trim();
        const incExpStatus = String((inc as any)?.experimental_class_status ?? "").trim();
        if (prevExpStatus === "scheduled" && !incExpStatus) merged.experimental_class_status = prevExpStatus;

        return merged as AtendimentoLeadListItem;
      });
    });
  }, [leads]);

  async function handleDeleteLead(lead: AtendimentoLeadListItem) {
    const leadId = String(lead.id ?? "").trim();
    if (!leadId) return;

    const st = String(lead.status ?? "").trim().toLowerCase();
    const fs = String(lead.funnel_stage ?? "").trim().toLowerCase();
    const rcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
    const isAluno =
      st === "matriculado" || fs === "matriculado" ||
      st === "aluno" || fs === "aluno" ||
      fs === "aluno_recorrente_cadastrado" ||
      st === "cadastro_recorrente_pendente_plataforma" || fs === "cadastro_recorrente_pendente_plataforma" ||
      st === "contrato_assinado" || fs === "contrato_assinado" ||
      st === "contrato_aguardando_aceite" || fs === "contrato_aguardando_aceite" ||
      st === "contrato_coletando_dados" || fs === "contrato_coletando_dados" ||
      st === "matricula_confirmada" || fs === "matricula_confirmada" ||
      rcs === "confirmado" || rcs === "cadastro_plataforma_pendente";

    const label = isAluno ? "aluno" : "interessado";
    const Label = isAluno ? "Aluno" : "Interessado";

    const name = String(lead.full_name ?? "").trim() || `${Label} sem nome`;
    const phone = String(lead.phone ?? "").trim() || "-";
    if (!window.confirm(`Excluir ${label}?\n\n${name}\n${phone}\n\nEsta ação é permanente.`)) {
      return;
    }

    try {
      setDeletingLeadId(leadId);
      const response = await fetch(`/api/atendimento/leads/${leadId}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? `Falha ao excluir ${label}.`);
        return;
      }

      setLocalLeads((current) => current.filter((item) => item.id !== leadId));
      setLocalSummary((current) => ({ ...current, totalLeads: Math.max(0, (current.totalLeads ?? 0) - 1) }));
      {
        const currentFiltered = filteredItems;
        const deletedIndex = currentFiltered.findIndex((item) => item.id === leadId);
        const remainingIds = currentFiltered
          .filter((item) => item.id !== leadId)
          .map((item) => item.id);
        let nextId: string | null = selectedLeadId === leadId ? null : (remainingIds.includes(selectedLeadId ?? "") ? selectedLeadId : null);
        if (selectedLeadId === leadId || !nextId) {
          if (deletedIndex >= 0) {
            if (deletedIndex + 1 < currentFiltered.length) {
              nextId = currentFiltered[deletedIndex + 1]?.id ?? null;
            } else if (deletedIndex - 1 >= 0) {
              nextId = currentFiltered[deletedIndex - 1]?.id ?? null;
            } else {
              nextId = remainingIds[0] ?? null;
            }
          } else if (!nextId) {
            nextId = remainingIds[0] ?? null;
          }
        }
        setActiveSectionSelectedLead(nextId);
        setMobileDetailsOpen((current) => (!nextId ? false : current));
      }
      modalToast.success(`${Label} excluído com sucesso.`);
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : `Falha ao excluir ${label}.`);
    } finally {
      setDeletingLeadId(null);
    }
  }

  useEffect(() => {
    if (lastActiveSectionRef.current === activeSection) return;
    lastActiveSectionRef.current = activeSection;
    setQuery("");
    setPage(1);
    const sectionsNow = sectionsRef.current;
    const targetSection = sectionsNow.find((s) => s.id === activeSection) ?? sectionsNow[0];
    const targetItems = targetSection?.items ?? [];
    setSelectedLeadIdBySection((current) => {
      const hasKeyForSection = Object.prototype.hasOwnProperty.call(current, activeSection);
      const existingForSection = hasKeyForSection ? current[activeSection] ?? null : null;
      if (hasKeyForSection && existingForSection && targetItems.some((lead) => lead.id === existingForSection)) {
        return current;
      }
      if (hasKeyForSection && existingForSection === null) {
        return current;
      }
      if (!targetItems.length) {
        return { ...current, [activeSection]: null };
      }
      if (hasKeyForSection) {
        return current;
      }
      const firstId = targetItems[0]?.id;
      return { ...current, [activeSection]: typeof firstId === "string" && firstId ? firstId : null };
    });
  }, [activeSection]);

  useEffect(() => {
    setPage((current) => {
      if (current < 1) return 1;
      if (current > totalPages) return totalPages;
      return current;
    });
  }, [totalPages]);

  useEffect(() => {
    setSelectedLeadIdBySection((current) => {
      const existingForSection = Object.prototype.hasOwnProperty.call(current, activeSection)
        ? current[activeSection] ?? null
        : null;
      if (!filteredItems.length) return { ...current, [activeSection]: null };
      if (existingForSection && filteredItems.some((lead) => lead.id === existingForSection)) {
        return current;
      }
      return current;
    });
  }, [filteredItems, activeSection]);

  useEffect(() => {
    if (refreshNonce === 0) return;
    if (lastProcessedRefreshNonceRef.current === refreshNonce) return;
    lastProcessedRefreshNonceRef.current = refreshNonce;
    const sectionsNow = sectionsRef.current;
    setQuery("");
    setPage(1);
    setSelectedLeadIdBySection((current) => {
      const next: Partial<Record<SummarySectionId, string | null>> = { ...current };
      for (const section of sectionsNow) {
        const sectionId = section.id;
        const sectionItems = section.items ?? [];
        const hasKey = Object.prototype.hasOwnProperty.call(next, sectionId);
        const existing = hasKey ? next[sectionId] ?? null : null;
        if (hasKey && existing && sectionItems.some((lead) => lead.id === existing)) {
          continue;
        }
        if (!sectionItems.length) {
          next[sectionId] = hasKey ? (existing === null ? null : next[sectionId] ?? null) : null;
          continue;
        }
        if (hasKey) {
          continue;
        }
        const firstId = sectionItems[0]?.id;
        next[sectionId] = typeof firstId === "string" && firstId ? firstId : null;
      }
      return next;
    });
  }, [refreshNonce]);

  useEffect(() => {
    if (!selectedLead) {
      setMobileDetailsOpen(false);
    }
  }, [selectedLead]);

  function handleSelectLead(lead: AtendimentoLeadListItem) {
    setActiveSectionSelectedLead(lead.id);
    setMobileDetailsOpen(true);
  }

  async function handleCancelBooking(lead: AtendimentoLeadListItem) {
    const booking = lead.experimental_class_booking;
    const bookingId = String(booking?.id ?? "").trim();
    const normalizedStatus = String(booking?.status ?? "").trim().toLowerCase();

    if (!bookingId || normalizedStatus !== "scheduled") {
      return;
    }

    if (!window.confirm("Deseja realmente cancelar este agendamento?")) {
      return;
    }

    try {
      setCancellingBookingId(bookingId);

      const response = await fetch(`/api/atendimento/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadId: lead.id,
          conversationId: lead.conversation?.id ?? null,
          professorDate: booking?.professor_date ?? null,
          professorTime: booking?.professor_time ?? null,
          professorStartAt: booking?.professor_start_at ?? null,
          leadDate: booking?.lead_date ?? null,
          leadTime: booking?.lead_time ?? null,
          leadTimeZone: booking?.lead_timezone ?? null,
          professorTimeZone: booking?.professor_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; booking?: Record<string, unknown> | null }
        | null;

      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao cancelar agendamento.");
        return;
      }

      setLocalLeads((current) => current.filter((item) => item.id !== lead.id));
      setLocalSummary((current) => ({
        ...current,
        aulasExperimentaisAgendadas: Math.max(0, current.aulasExperimentaisAgendadas - 1),
        totalLeads: Math.max(0, (current.totalLeads ?? 0) - 1),
      }));
      setActiveSectionSelectedLead(selectedLeadId === lead.id ? null : selectedLeadId);
      setMobileDetailsOpen((current) => (selectedLeadId === lead.id ? false : current));
      modalToast.success("Agendamento cancelado e interessado removido.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao cancelar agendamento.");
    } finally {
      setCancellingBookingId(null);
    }
  }

  async function handleSendStudentNotification(lead: AtendimentoLeadListItem) {
    const booking = lead.experimental_class_booking;
    const bookingId = String(booking?.id ?? "").trim();

    if (!bookingId) {
      modalToast.error("Agendamento indisponível para disparar a notificação.");
      return;
    }

    try {
      setSendingStudentNotificationBookingId(bookingId);

      const response = await fetch(`/api/atendimento/bookings/${bookingId}/send-student-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadId: lead.id,
          conversationId: lead.conversation?.id ?? null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; booking?: Record<string, unknown> | null; attendant_notification_sent?: boolean; attendant_notification_error?: string | null }
        | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        if (payload?.error === "missing_lesson_link") {
          modalToast.error("Cadastre o link da aula antes de disparar a notificação.");
        } else if (payload?.error === "missing_lead_phone") {
          modalToast.error("Telefone do aluno não encontrado.");
        } else {
          modalToast.error(payload?.error ?? "Falha ao disparar a notificação.");
        }
        return;
      }

      const attendantNotificationSent = payload.attendant_notification_sent !== false;
      const attendantNotificationError = String(payload.attendant_notification_error ?? "").trim() || null;

      const updatedLead: AtendimentoLeadListItem = {
        ...lead,
        experimental_class_booking: {
          ...(lead.experimental_class_booking ?? {
            id: bookingId,
            source: "table" as const,
            created_at: lead.updated_at,
            lesson_link: String((payload.booking as any)?.lesson_link ?? booking?.lesson_link ?? "").trim() || null,
            student_start_notification_sent_at: null,
            attendant_start_notification_sent_at: null,
            attendance_status: null,
            attendance_checked_at: null,
            professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: null,
            professor_date: null,
            professor_time: null,
            professor_start_at: null,
            lead_date: null,
            lead_time: null,
            lead_start_at: null,
            status: "scheduled",
          }),
          ...(payload.booking as Partial<AtendimentoLeadListItem["experimental_class_booking"]>),
          source: ((payload.booking as any)?.source ?? booking?.source ?? "table") as "table" | "history",
          lesson_link:
            String((payload.booking as any)?.lesson_link ?? lead.experimental_class_booking?.lesson_link ?? "").trim() || null,
          student_start_notification_sent_at:
            String(
              (payload.booking as any)?.student_start_notification_sent_at ??
                lead.experimental_class_booking?.student_start_notification_sent_at ??
                "",
            ).trim() || new Date().toISOString(),
          attendant_start_notification_sent_at:
            String(
              (payload.booking as any)?.attendant_start_notification_sent_at ??
                lead.experimental_class_booking?.attendant_start_notification_sent_at ??
                "",
            ).trim() || new Date().toISOString(),
        },
      };

      setLocalLeads((current) => current.map((item) => (item.id === lead.id ? updatedLead : item)));
      if (attendantNotificationSent) {
        modalToast.success("Notificações enviadas ao aluno e ao professor.");
      } else {
        modalToast.warning(
          `Notificação enviada ao aluno. Não foi possível enviar ao professor: ${attendantNotificationError || "erro desconhecido"}`,
        );
      }
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao disparar a notificação.");
    } finally {
      setSendingStudentNotificationBookingId(null);
    }
  }

  async function handleSaveLessonLink(lead: AtendimentoLeadListItem, lessonLink: string) {
    const booking = lead.experimental_class_booking;
    const bookingId = String(booking?.id ?? "").trim();

    if (!bookingId) {
      modalToast.error("Agendamento indisponível para salvar o link.");
      return;
    }

    try {
      setSavingLessonLinkBookingId(bookingId);

      const response = await fetch(`/api/atendimento/bookings/${bookingId}/lesson-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lessonLink,
          leadId: lead.id,
          conversationId: lead.conversation?.id ?? null,
          professorDate: booking?.professor_date ?? null,
          professorTime: booking?.professor_time ?? null,
          professorStartAt: booking?.professor_start_at ?? null,
          leadDate: booking?.lead_date ?? null,
          leadTime: booking?.lead_time ?? null,
          leadTimeZone: booking?.lead_timezone ?? null,
          professorTimeZone: booking?.professor_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE,
          status: booking?.status ?? "scheduled",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; booking?: Record<string, unknown> | null }
        | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        modalToast.error(payload?.error ?? "Falha ao salvar o link da aula.");
        return;
      }

      const updatedLead: AtendimentoLeadListItem = {
        ...lead,
        experimental_class_booking: {
          ...(lead.experimental_class_booking ?? {
            id: bookingId,
            source: "table" as const,
            created_at: lead.updated_at,
            lesson_link: null,
            student_start_notification_sent_at: null,
            attendant_start_notification_sent_at: null,
            attendance_status: null,
            attendance_checked_at: null,
            professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: null,
            professor_date: null,
            professor_time: null,
            professor_start_at: null,
            lead_date: null,
            lead_time: null,
            lead_start_at: null,
            status: "scheduled",
          }),
          ...(payload.booking as Partial<AtendimentoLeadListItem["experimental_class_booking"]>),
          source: ((payload.booking as any)?.source ?? booking?.source ?? "table") as "table" | "history",
          lesson_link: String((payload.booking as any)?.lesson_link ?? "").trim() || null,
          student_start_notification_sent_at:
            String(
              (payload.booking as any)?.student_start_notification_sent_at ??
                lead.experimental_class_booking?.student_start_notification_sent_at ??
                "",
            ).trim() || null,
          attendant_start_notification_sent_at:
            String(
              (payload.booking as any)?.attendant_start_notification_sent_at ??
                lead.experimental_class_booking?.attendant_start_notification_sent_at ??
                "",
            ).trim() || null,
          attendance_status:
            ((payload.booking as any)?.attendance_status ??
              lead.experimental_class_booking?.attendance_status ??
              null) as "pending" | "attended" | "no_show" | null,
          attendance_checked_at:
            String(
              (payload.booking as any)?.attendance_checked_at ?? lead.experimental_class_booking?.attendance_checked_at ?? "",
            ).trim() || null,
        },
      };

      setLocalLeads((current) => current.map((item) => (item.id === lead.id ? updatedLead : item)));
      modalToast.success(lessonLink.trim() ? "Link da aula salvo." : "Link da aula removido.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao salvar o link da aula.");
    } finally {
      setSavingLessonLinkBookingId(null);
    }
  }

  async function handleSaveRecurringLink(lead: AtendimentoLeadListItem, recurringLink: string) {
    const leadId = String(lead?.id ?? "").trim();
    if (!leadId) {
      modalToast.error("Lead indisponível para salvar o link da aula recorrente.");
      return;
    }
    const trimmed = recurringLink.trim();

    try {
      setSavingRecurringLinkLeadId(leadId);
      const response = await fetch(`/api/atendimento/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurring_class_link: trimmed || null }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; lead?: { id?: string; recurring_class_link?: string | null; updated_at?: string } | null }
        | null;

      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao salvar o link da aula recorrente.");
        return;
      }

      const newLink = String(payload?.lead?.recurring_class_link ?? trimmed).trim() || null;
      const newUpdatedAt = String(payload?.lead?.updated_at ?? lead.updated_at ?? new Date().toISOString());
      setLocalLeads((current) =>
        current.map((item) =>
          item.id === leadId
            ? ({ ...item, recurring_class_link: newLink, updated_at: newUpdatedAt } as AtendimentoLeadListItem & { recurring_class_link: string | null })
            : item,
        ),
      );
      modalToast.success(newLink ? "Link fixo da aula recorrente salvo." : "Link fixo da aula recorrente removido.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao salvar o link da aula recorrente.");
    } finally {
      setSavingRecurringLinkLeadId(null);
    }
  }

  async function handlePaymentAction(
    lead: AtendimentoLeadListItem,
    action: "confirm" | "reject",
  ) {
    const leadId = String(lead?.id ?? "").trim();
    if (!leadId) {
      modalToast.error("Lead indisponível para atualizar pagamento.");
      return;
    }
    try {
      setLoadingPaymentLeadId(leadId);
      setLoadingPaymentAction(action);
      const response = await fetch(`/api/atendimento/leads/${leadId}/payment-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; confirmed_at?: string | null; rejected_at?: string | null }
        | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao atualizar pagamento.");
        return;
      }
      const now = new Date().toISOString();
      setLocalLeads((current) =>
        current.map((item) => {
          if (item.id !== leadId) return item;
          const next: any = { ...item, updated_at: now };
          if (action === "confirm") {
            next.payment_status = "confirmado";
            next.payment_confirmed_at = payload?.confirmed_at || now;
            next.payment_rejected_at = null;
            const st = String(item.status ?? "").trim();
            const fs = String((item as any).funnel_stage ?? "").trim();
            const stTarget = "matriculado";
            const fsTarget = "matriculado";
            if (st !== "aluno" && st !== stTarget && st !== "encerrado") next.status = stTarget;
            if (fs !== fsTarget && fs !== "encerrado") next.funnel_stage = fsTarget;
          } else {
            next.payment_status = "nao_realizado";
            next.payment_rejected_at = payload?.rejected_at || now;
            next.payment_confirmed_at = null;
            next.status = "pagamento_nao_realizado";
            next.funnel_stage = "pagamento_nao_realizado";
          }
          return next as AtendimentoLeadListItem;
        }),
      );
      modalToast.success(action === "confirm" ? "Pagamento confirmado." : "Pagamento marcado como não realizado.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao atualizar pagamento.");
    } finally {
      setLoadingPaymentLeadId(null);
      setLoadingPaymentAction(null);
    }
  }

  async function handleMarkAttendance(lead: AtendimentoLeadListItem, attendance: "attended" | "no_show") {
    const booking = lead.experimental_class_booking;
    const bookingId = String(booking?.id ?? "").trim();

    if (!bookingId) {
      modalToast.error("Agendamento indisponível para registrar o comparecimento.");
      return;
    }

    try {
      setMarkingAttendanceBookingId(bookingId);
      setMarkingAttendanceType(attendance);

      const response = await fetch(`/api/atendimento/bookings/${bookingId}/attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attendance,
          leadId: lead.id,
          conversationId: lead.conversation?.id ?? null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            booking?: Record<string, unknown> | null;
            lead?: { funnel_stage?: string | null; status?: string | null; updated_at?: string | null } | null;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        modalToast.error(payload?.error ?? "Falha ao registrar o comparecimento da aula.");
        return;
      }

      const updatedLead: AtendimentoLeadListItem = {
        ...lead,
        status:
          (String(payload?.lead?.status ?? "").trim() as AtendimentoLeadListItem["status"]) ||
          (attendance === "attended"
            ? "matricula_pendente"
            : lead.status),
        funnel_stage:
          (String(payload?.lead?.funnel_stage ?? "").trim() as AtendimentoLeadListItem["funnel_stage"]) ||
          (attendance === "attended"
            ? "matricula_pendente"
            : lead.funnel_stage),
        updated_at:
          String(payload?.lead?.updated_at ?? "").trim() || lead.updated_at || new Date().toISOString(),
        experimental_class_booking: {
          ...(lead.experimental_class_booking ?? {
            id: bookingId,
            source: "table" as const,
            created_at: lead.updated_at,
            lesson_link: null,
            student_start_notification_sent_at: null,
            attendant_start_notification_sent_at: null,
            attendance_status: null,
            attendance_checked_at: null,
            professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: null,
            professor_date: null,
            professor_time: null,
            professor_start_at: null,
            lead_date: null,
            lead_time: null,
            lead_start_at: null,
            status: "scheduled",
          }),
          ...(payload.booking as Partial<AtendimentoLeadListItem["experimental_class_booking"]>),
          source: ((payload.booking as any)?.source ?? booking?.source ?? "table") as "table" | "history",
          lesson_link:
            String((payload.booking as any)?.lesson_link ?? lead.experimental_class_booking?.lesson_link ?? "").trim() || null,
          student_start_notification_sent_at:
            String(
              (payload.booking as any)?.student_start_notification_sent_at ??
                lead.experimental_class_booking?.student_start_notification_sent_at ??
                "",
            ).trim() || null,
          attendant_start_notification_sent_at:
            String(
              (payload.booking as any)?.attendant_start_notification_sent_at ??
                lead.experimental_class_booking?.attendant_start_notification_sent_at ??
                "",
            ).trim() || null,
          attendance_status: ((payload.booking as any)?.attendance_status ?? attendance) as "pending" | "attended" | "no_show",
          attendance_checked_at:
            String((payload.booking as any)?.attendance_checked_at ?? new Date().toISOString()).trim() || new Date().toISOString(),
        },
      };

      setLocalLeads((current) => current.map((item) => (item.id === lead.id ? updatedLead : item)));
      modalToast.success(
        attendance === "attended"
          ? "Comparecimento confirmado e mensagem enviada ao aluno."
          : "Aluno marcado para repescagem manual.",
      );
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao registrar o comparecimento da aula.");
    } finally {
      setMarkingAttendanceBookingId(null);
      setMarkingAttendanceType(null);
    }
  }

  function buildItemMeta(lead: AtendimentoLeadListItem) {
    if (shouldHideExperimentalInfoCompletely(lead, activeSection)) {
      return buildRecurringMetaForSection(lead);
    }

    const recWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
    const recWeekdayCodeOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recWeekdayRaw);
    const recWeekdayLabel = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
    const recWeekdayLabelOk =
      /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
        recWeekdayLabel,
      );
    const recWeekdayOk = recWeekdayCodeOk || recWeekdayLabelOk;
    const recTimeOk =
      Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
      Boolean(String(lead.recurring_class_lead_time ?? "").trim());
    const hasRecurringBoth = recWeekdayOk && recTimeOk;
    const hasAnyRecurringSignal =
      recWeekdayOk ||
      recTimeOk ||
      Boolean(String((lead as any)?.recurring_class_status ?? "").trim()) ||
      Number((lead as any)?.recurring_registration_step ?? 0) > 0;

    const recurringProgress = leadHasAnyRecurringProgressSignal(lead);
    if (recurringProgress) return buildRecurringMetaForSection(lead);

    if (activeSection === "agendamentos") {
      if (hasAnyRecurringSignal || isRecurringContractFormalized(lead)) {
        return buildRecurringMetaForSection(lead);
      }
      const experimentalMeta = buildExperimentalMetaForSection(lead);
      if (experimentalMeta) return experimentalMeta;
    }

    if (activeSection === "contratos") {
      const signedAt = String((lead as any)?.contract_signed_at ?? "").trim();
      const status = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
      const hasRecurringContract =
        (status && status !== "nao_iniciado") ||
        Boolean(signedAt) ||
        hasAnyRecurringSignal ||
        recurringProgress;
      if (hasRecurringContract) {
        return buildRecurringMetaForSection(lead);
      }
      return "";
    }

    if (activeSection !== "agendamentos") {
      if (hasRecurringBoth || hasAnyRecurringSignal) return buildRecurringMetaForSection(lead);
      const rawDt = formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at);
      return rawDt ? `Criado em: ${rawDt}` : "";
    }

    if (hasRecurringBoth) return buildRecurringMetaForSection(lead);
    if (hasAnyRecurringSignal && (!recWeekdayOk || !recTimeOk)) return buildRecurringMetaForSection(lead);

    const experimentalMeta = buildExperimentalMetaForSection(lead);
    if (experimentalMeta) return experimentalMeta;

    const rawDtAgend = formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at);
    return rawDtAgend ? `Criado em: ${rawDtAgend}` : "";
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <div className="shrink-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => {
          const active = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={[
                "rounded-2xl border p-4 text-left transition",
                active
                  ? "border-yellow-500/30 bg-yellow-500/10"
                  : "border-[var(--app-border)] bg-[var(--app-card-2)] hover:bg-[var(--app-hover)]",
              ].join(" ")}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                {section.label}
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--app-text-85)]">{section.value}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:pr-1">
        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
          <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:flex lg:h-full lg:w-[320px] lg:min-w-[320px] lg:flex-col">
          <div className="shrink-0 border-b border-[var(--app-border)] px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--app-text-85)]">{activeSectionData.label}</div>
              {activeSection === "interessados" ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddLeadError("");
                    setAddLeadPhoneInput("");
                    setShowAddLeadModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] active:bg-[var(--app-hover)]"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar
                </button>
              ) : null}
            </div>
            <label className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <Search className="h-4 w-4 text-[var(--app-text-45)]" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Pesquise por nome e telefone."
                className="w-full bg-transparent text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)]"
              />
            </label>
          </div>
          <div className="overflow-y-auto p-3 pr-3 lg:flex-1 lg:min-h-0">
            {pagedItems.length ? (
              <div className="space-y-3">
                {pagedItems.map((lead) => {
                  const active = lead.id === selectedLead?.id;
                  const showJumpToAgendamento =
                    activeSection === "interessados" && leadHasAnyExperimentalVinculo(lead);
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleSelectLead(lead)}
                      className={[
                        "relative w-full rounded-2xl border px-4 py-3 text-left transition",
                        active
                          ? "border-[var(--app-border)] bg-[var(--app-card)] lg:border-yellow-500/30 lg:bg-yellow-500/10"
                          : "border-[var(--app-border)] bg-[var(--app-card)] hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      {showJumpToAgendamento ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveSection("agendamentos");
                            handleSelectLead(lead);
                          }}
                          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-2 py-1.5 text-[11px] font-semibold text-[var(--app-text-65)] transition hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]"
                          title="Ver em agendamento"
                        >
                          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      ) : null}
                      <div
                        className="pr-10 truncate text-sm font-semibold text-[var(--app-text-85)]"
                        title={lead.phone || lead.full_name || "Interessado sem telefone"}
                      >
                        {String(lead.full_name ?? "").trim() || lead.phone || "Interessado sem telefone"}
                      </div>
                      {(() => {
                        const warnings: JSX.Element[] = [];
                        const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
                        const hasWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw);
                        const hasTimeOk =
                          Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
                          Boolean(String(lead.recurring_class_lead_time ?? "").trim());
                        const leadStatus = String(lead.status ?? "").trim().toLowerCase();
                        const leadFunnel = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
                        const isMatriculadoCard =
                          leadStatus === "aluno" || leadStatus === "matriculado" ||
                          leadFunnel.includes("aluno") || leadFunnel.includes("matriculado") ||
                          leadStatus === "cadastro_recorrente_pendente_plataforma" ||
                          leadFunnel === "cadastro_recorrente_pendente_plataforma" ||
                          leadFunnel === "contrato_assinado" ||
                          leadFunnel === "contrato_aguardando_aceite";
                        const stateRaw = String((lead as any)?.state ?? "").trim();
                        const cityRaw = String((lead as any)?.city ?? "").trim();
                        const faltaEstadoCidade = !stateRaw || !cityRaw;
                        const faltaDiaHoraRecorrente = !hasWeekdayOk || !hasTimeOk;

                        const hasRecurringPassword = Boolean(String((lead as any).recurring_registration_password ?? "").trim());
                        const classifiedAsAluno = isLeadInAlunosSection(lead);
                        const recorrenteRealmenteIniciado = hasRecurringPassword || classifiedAsAluno;

                        const showExpLink = (() => {
                          const booking = lead.experimental_class_booking ?? null;
                          const bookingId = String(booking?.id ?? "").trim();
                          const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
                          return (
                            bookingId &&
                            bookingStatus &&
                            bookingStatus !== "cancelled" &&
                            !String((booking as any)?.lesson_link ?? "").trim()
                          );
                        })();

                        const showRecLink =
                          recorrenteRealmenteIniciado &&
                          !showExpLink &&
                          !String((lead as any).recurring_class_link ?? "").trim();

                        const recLinkSections = ["alunos", "agendamentos", "contratos"];
                        const expLinkSections = ["interessados", "agendamentos"];

                        if (
                          showRecLink &&
                          recLinkSections.includes(activeSection)
                        ) {
                          warnings.push(
                            <div key="rec-link" className="mt-1 text-[11px] font-semibold text-amber-300">
                              Adicione link da aula recorrente
                            </div>,
                          );
                        }

                        if (
                          !isMatriculadoCard &&
                          showExpLink &&
                          expLinkSections.includes(activeSection)
                        ) {
                          warnings.push(
                            <div key="exp-link" className="mt-1 text-[11px] font-semibold text-amber-300">
                              Adicione link da aula experimental
                            </div>,
                          );
                        }

                        return warnings.length ? warnings : null;
                      })()}
                      {activeSection === "interessados" ? (() => {
                        const stateRaw = String((lead as any)?.state ?? "").trim();
                        const cityRaw = String((lead as any)?.city ?? "").trim();
                        if (stateRaw && cityRaw) return null;
                        let label = "Falta estado e cidade";
                        if (stateRaw && !cityRaw) label = "Falta cidade";
                        return (
                          <div className="mt-1 text-xs text-[var(--app-text-55)]">
                            {label}
                          </div>
                        );
                      })() : null}
                      {(() => {
                        if (activeSection === "agendamentos") return null;
                        if (shouldHideExperimentalInfoCompletely(lead, activeSection)) return null;
                        if (leadHasAnyRecurringProgressSignal(lead)) return null;
                        const stateRaw = String((lead as any)?.state ?? "").trim();
                        const cityRaw = String((lead as any)?.city ?? "").trim();
                        if (!stateRaw || !cityRaw) return null;
                        const experimentalMeta = buildExperimentalMetaForSection(lead);
                        if (!experimentalMeta) return null;
                        const isScheduledStage =
                          /^Falta dia/.test(experimentalMeta) ||
                          /^Falta horário/.test(experimentalMeta) ||
                          /^Falta dia e horário/.test(experimentalMeta) ||
                          /^Aula em:/.test(experimentalMeta) ||
                          /^Aguardando confirmação da aula experimental/.test(experimentalMeta) ||
                          /^Agendamento em definição/.test(experimentalMeta) ||
                          /^Agendamento cancelado/.test(experimentalMeta) ||
                          /^Aula experimental concluída/.test(experimentalMeta);
                        if (!isScheduledStage) return null;
                        const isAulaEm = /^Aula em:/.test(experimentalMeta);
                        return (
                          <div className={`mt-1 text-xs ${isAulaEm ? "text-emerald-500" : "text-[var(--app-text-55)]"}`}>
                            {experimentalMeta}
                          </div>
                        );
                      })()}
                      {(() => {
                        const meta = buildItemMeta(lead);
                        if (!meta) return null;
                        const isAulaEm = /^Aula em:/.test(meta);
                        return (
                          <div className={`mt-1 text-xs ${isAulaEm ? "text-emerald-500" : "text-[var(--app-text-55)]"}`}>
                            {meta}
                          </div>
                        );
                      })()}
                      {isLeadRepescagem(lead) ? (
                        <div className="mt-2">
                          <RepescagemBadge />
                        </div>
                      ) : null}
                      <div className="mt-3">
                        <RecurringClassLinkCard
                          lead={lead}
                          activeSection={activeSection}
                          savingThisLead={savingRecurringLinkLeadId === lead.id}
                          onSaveRecurringLink={handleSaveRecurringLink}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-[var(--app-text-45)]">
                <div>
                  {query.trim() ? "Nenhum resultado encontrado para a busca." : activeSectionData.emptyMessage}
                </div>
                {didYouMeanSuggestions.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                      Você quis dizer:
                    </span>
                    {didYouMeanSuggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.id}-${suggestion.name}`}
                        type="button"
                        onClick={() => {
                          setActiveSectionSelectedLead(suggestion.id);
                          setQuery("");
                          setPage(1);
                          setMobileDetailsOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-1 text-xs font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)]"
                      >
                        {suggestion.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {filteredItems.length > PANEL_PAGE_SIZE ? (
            <div className="shrink-0 flex items-center justify-between gap-3 border-t border-[var(--app-border)] px-4 py-3">
              <div className="text-xs font-semibold text-[var(--app-text-55)]">
                Página {page} de {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Próximo
                </button>
              </div>
            </div>
          ) : null}
        </div>

          <div className="hidden min-h-0 min-w-0 flex-1 lg:block lg:h-full">
            {selectedLead ? (
              activeSection === "agendamentos" ? (
                <BookingDetails
                  lead={selectedLead}
                  activeSection={activeSection}
                  cancellingBookingId={cancellingBookingId}
                  savingLessonLinkBookingId={savingLessonLinkBookingId}
                  markingAttendanceBookingId={markingAttendanceBookingId}
                  markingAttendanceType={markingAttendanceType}
                  sendingStudentNotificationBookingId={sendingStudentNotificationBookingId}
                  savingRecurringLink={savingRecurringLinkLeadId === selectedLead.id}
                  onCancelBooking={handleCancelBooking}
                  onSaveLessonLink={handleSaveLessonLink}
                  onMarkAttendance={handleMarkAttendance}
                  onSendStudentNotification={handleSendStudentNotification}
                  onSaveRecurringLink={handleSaveRecurringLink}
                  onEditExperimental={(l) => openEditExperimental(l)}
                />
              ) : activeSection === "contratos" ? (
                <ContractDetails lead={selectedLead} />
              ) : (
                <LeadDetails
                  lead={selectedLead}
                  activeSection={activeSection}
                  showDelete={activeSection === "interessados" || activeSection === "alunos"}
                  deleting={deletingLeadId === selectedLead.id}
                  onDelete={() => handleDeleteLead(selectedLead)}
                  onEditName={(l) => openEditLeadName(l)}
                  onEditLocation={(l) => openEditLeadLocation(l)}
                  savingRecurringLink={savingRecurringLinkLeadId === selectedLead.id}
                  onSaveRecurringLink={handleSaveRecurringLink}
                  loadingPayment={loadingPaymentLeadId === selectedLead.id}
                  loadingPaymentAction={loadingPaymentLeadId === selectedLead.id ? loadingPaymentAction : null}
                  onConfirmPayment={(l) => handlePaymentAction(l, "confirm")}
                  onRejectPayment={(l) => handlePaymentAction(l, "reject")}
                />
              )
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-6 text-center text-sm text-[var(--app-text-45)]">
                {activeSectionData.emptyMessage}
              </div>
            )}
          </div>
        </div>

        {selectedLead && mobileDetailsOpen ? (
          <div className="fixed inset-0 z-[460] lg:hidden">
            <button
              type="button"
              aria-label="Fechar detalhes"
              className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
              onClick={() => setMobileDetailsOpen(false)}
            />
            <div className="absolute inset-0 flex min-h-0 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--app-bg)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3 shrink-0">
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                      {activeSectionData.label}
                    </div>
                    <div
                      className="mt-1 truncate text-sm font-semibold text-[var(--app-text-85)]"
                      title={selectedLead.phone || selectedLead.full_name || "Interessado sem telefone"}
                    >
                      {String(selectedLead.full_name ?? "").trim() || selectedLead.phone || "Interessado sem telefone"}
                    </div>
                    {(() => {
                      const recurringWeekdayRaw = String(selectedLead.recurring_class_weekday ?? "").trim().toLowerCase();
                      const recurringStatus = String(selectedLead.recurring_class_status ?? "").trim();
                      const recurringProfessorTime = String(selectedLead.recurring_class_professor_time ?? "").trim();
                      const recurringLeadTime = String(selectedLead.recurring_class_lead_time ?? "").trim();
                      void recurringWeekdayRaw;
                      void recurringStatus;
                      void recurringProfessorTime;
                      void recurringLeadTime;
                      return null;
                      // Banner link da aula recorrente (mobile): REMOVIDO solicitacao usuario
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileDetailsOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-75)] transition hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)]"
                    aria-label="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {activeSection === "agendamentos" ? (
                    <BookingDetails
                      lead={selectedLead}
                      activeSection={activeSection}
                      cancellingBookingId={cancellingBookingId}
                      savingLessonLinkBookingId={savingLessonLinkBookingId}
                      markingAttendanceBookingId={markingAttendanceBookingId}
                      markingAttendanceType={markingAttendanceType}
                      sendingStudentNotificationBookingId={sendingStudentNotificationBookingId}
                      savingRecurringLink={savingRecurringLinkLeadId === selectedLead.id}
                      onCancelBooking={handleCancelBooking}
                      onSaveLessonLink={handleSaveLessonLink}
                      onMarkAttendance={handleMarkAttendance}
                      onSendStudentNotification={handleSendStudentNotification}
                      onSaveRecurringLink={handleSaveRecurringLink}
                    />
                  ) : activeSection === "contratos" ? (
                    <ContractDetails lead={selectedLead} />
                  ) : (
                    <LeadDetails
                      lead={selectedLead}
                      activeSection={activeSection}
                      showDelete={activeSection === "interessados" || activeSection === "alunos"}
                      deleting={deletingLeadId === selectedLead.id}
                      onDelete={() => handleDeleteLead(selectedLead)}
                      onEditName={(l) => openEditLeadName(l)}
                      onEditLocation={(l) => openEditLeadLocation(l)}
                      savingRecurringLink={savingRecurringLinkLeadId === selectedLead.id}
                      onSaveRecurringLink={handleSaveRecurringLink}
                      loadingPayment={loadingPaymentLeadId === selectedLead.id}
                      loadingPaymentAction={loadingPaymentLeadId === selectedLead.id ? loadingPaymentAction : null}
                      onConfirmPayment={(l) => handlePaymentAction(l, "confirm")}
                      onRejectPayment={(l) => handlePaymentAction(l, "reject")}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <AppModal
          open={isEditLeadNameOpen}
          onClose={closeEditLeadName}
          size="md"
          zIndexClass="z-[500]"
          fullScreenOnMobile
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/90">
                {editingLead?.full_name?.trim() ? "Alterar nome do interessado" : "Adicionar nome ao interessado"}
              </div>
              <div className="mt-1 truncate text-xs text-white/55">
                {editingLead?.phone || editingLead?.full_name || "Lead selecionado"}
              </div>
            </div>
            <button
              type="button"
              onClick={closeEditLeadName}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={saveLeadNameForm} className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-semibold text-white/60">
                Nome completo do interessado
              </label>
              <input
                autoFocus
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                placeholder="Ex.: Ana Carolina Souza"
                maxLength={160}
                {...leadNameForm.register("full_name", { required: false, maxLength: 160 })}
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
                <span>Campo opcional. Facilita identificar esse interessado nas listas e buscas.</span>
                <span>{(leadNameForm.watch("full_name") ?? "").length}/160</span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeEditLeadName}
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={leadNameForm.formState.isSubmitting || savingLeadNameLeadId !== null}
                className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
              >
                {leadNameForm.formState.isSubmitting || savingLeadNameLeadId !== null ? "Salvando..." : "Salvar nome"}
              </button>
            </div>
          </form>
        </AppModal>

        <AppModal
          open={isEditLeadLocationOpen}
          onClose={closeEditLeadLocation}
          size="md"
          zIndexClass="z-[500]"
          fullScreenOnMobile
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/90">
                Editar localização do interessado
              </div>
              <div className="mt-1 truncate text-xs text-white/55">
                {editingLocationLead?.phone || editingLocationLead?.full_name || "Lead selecionado"}
              </div>
            </div>
            <button
              type="button"
              onClick={closeEditLeadLocation}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={saveLeadLocationForm} className="mt-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-white/60">Estado</label>
                <input
                  autoFocus
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  placeholder="Ex.: Mato Grosso ou MT"
                  maxLength={160}
                  {...leadLocationForm.register("state", { required: true, maxLength: 160 })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/60">Cidade</label>
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  placeholder="Ex.: Cuiabá"
                  maxLength={160}
                  {...leadLocationForm.register("city", { required: true, maxLength: 160 })}
                />
              </div>
            </div>

            <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/55">
              Com base no estado e cidade informados, o sistema identifica automaticamente o país e o fuso horário e os registra.
            </div>

            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeEditLeadLocation}
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={leadLocationForm.formState.isSubmitting || savingLeadLocationLeadId !== null}
                className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
              >
                {leadLocationForm.formState.isSubmitting || savingLeadLocationLeadId !== null ? "Salvando..." : "Salvar localização"}
              </button>
            </div>
          </form>
        </AppModal>

        <AppModal
          open={isEditExperimentalOpen}
          onClose={closeEditExperimental}
          size="md"
          zIndexClass="z-[500]"
          fullScreenOnMobile
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/90">
                Editar aula experimental
              </div>
              <div className="mt-1 truncate text-xs text-white/55">
                {editingExperimentalLead?.phone || editingExperimentalLead?.full_name || "Lead selecionado"}
              </div>
            </div>
            <button
              type="button"
              onClick={closeEditExperimental}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.06]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {loadingExperimentalAvailability ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-sm text-white/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando disponibilidade...
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold text-white/80">
                      Dias disponíveis
                      {experimentalAvailability?.dates?.length ? (
                        <span className="ml-2 font-normal text-white/40">
                          ({String(experimentalAvailability.dates.length)})
                        </span>
                      ) : null}
                    </label>
                    <div className="text-[11px] text-white/45">
                      Fuso: {String(experimentalAvailability?.lead_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE)}
                    </div>
                  </div>

                  {!experimentalAvailability?.dates?.length ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/55">
                      No momento, não há dias disponíveis para aula experimental até o fim do mês atual.
                      O bot de agendamento naturalmente já não liberaria mais horários também.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                      {experimentalAvailability.dates.map((dateOption) => {
                        const dateId = String(dateOption?.id ?? "");
                        if (!dateId) return null;
                        const dayLabel = String(dateOption?.dayLabel ?? dateId).slice(0, 6);
                        const displayLabel = String(dateOption?.displayLabel ?? "").trim();
                        const slotCount = Number(dateOption?.slotCount ?? 0);
                        const isSelected = selectedExperimentalDateId === dateId;
                        return (
                          <button
                            key={dateId}
                            type="button"
                            onClick={() => {
                              setSelectedExperimentalDateId(dateId);
                              setSelectedExperimentalSlotId(null);
                            }}
                            className={
                              "flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 text-center transition " +
                              (isSelected
                                ? "border-amber-500/60 bg-amber-500/20 text-amber-200 shadow-md"
                                : "border-white/10 bg-white/[0.03] text-white/85 hover:border-white/25 hover:bg-white/[0.06]")
                            }
                          >
                            <div className={
                              "text-[11px] uppercase tracking-wide " +
                              (isSelected ? "text-amber-300/90" : "text-white/50")
                            }>
                              {displayLabel ? displayLabel.split(",")[0] ?? "Dia" : "Dia"}
                            </div>
                            <div className={
                              "text-lg font-black leading-none " +
                              (isSelected ? "text-amber-100" : "text-white/95")
                            }>
                              {dayLabel}
                            </div>
                            <div className={
                              "text-[10px] font-semibold " +
                              (isSelected ? "text-amber-300/80" : "text-white/45")
                            }>
                              {slotCount > 0
                                ? `${slotCount} ${slotCount === 1 ? "horário" : "horários"}`
                                : "—"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/80">
                    Horários disponíveis
                    {selectedExperimentalDateId ? (
                      <span className="ml-2 font-normal text-white/40">
                        (dia selecionado)
                      </span>
                    ) : (
                      <span className="ml-2 font-normal text-white/40">
                        (selecione um dia primeiro)
                      </span>
                    )}
                  </label>

                  {!selectedExperimentalDateId ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/55">
                      Clique em um dia acima para ver os horários disponíveis.
                    </div>
                  ) : (
                    ((() => {
                      const selectedDate = (experimentalAvailability?.dates ?? []).find(
                        (d) => String(d?.id ?? "") === selectedExperimentalDateId,
                      );
                      const keyForSlots = String(selectedDate?.professorDate ?? selectedDate?.id ?? "");
                      const slots = Array.isArray(experimentalAvailability?.slotsByDate?.[keyForSlots])
                        ? (experimentalAvailability!.slotsByDate[keyForSlots] as any[])
                        : [];
                      if (!slots.length) {
                        return (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/55">
                            Não há horários livres para este dia. Selecione outro dia disponível.
                          </div>
                        );
                      }
                      return (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                          {slots.map((slot) => {
                            const slotId = String(slot?.id ?? "");
                            if (!slotId) return null;
                            const label = String(slot?.displayLabel ?? slot?.leadTime ?? "").trim();
                            const isSelected = selectedExperimentalSlotId === slotId;
                            return (
                              <button
                                key={slotId}
                                type="button"
                                onClick={() => setSelectedExperimentalSlotId(slotId)}
                                className={
                                  "flex h-12 items-center justify-center rounded-2xl border px-2 text-sm font-black transition " +
                                  (isSelected
                                    ? "border-amber-500/60 bg-amber-500/20 text-amber-100 shadow"
                                    : "border-white/10 bg-white/[0.03] text-white/90 hover:border-white/25 hover:bg-white/[0.06]")
                                }
                              >
                                {label || "Horário"}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })())
                  )}
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/55 space-y-1">
                  <div>
                    Os horários já são exibidos no <span className="text-white/85 font-semibold">fuso horário do aluno</span>,
                    calculados automaticamente com base no estado e cidade registrados no sistema.
                  </div>
                  <div>
                    O link da sala de aula, se já cadastrado, é preservado automaticamente ao salvar.
                  </div>
                </div>
              </>
            )}

            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeEditExperimental}
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  loadingExperimentalAvailability ||
                  savingExperimentalLeadId !== null ||
                  !experimentalAvailability?.dates?.length ||
                  !selectedExperimentalDateId ||
                  !selectedExperimentalSlotId
                }
                onClick={() => void saveExperimentalBooking()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingExperimentalLeadId !== null ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar aula experimental"
                )}
              </button>
            </div>
          </div>
        </AppModal>

        <AppModal
          open={showAddLeadModal}
          onClose={() => setShowAddLeadModal(false)}
          size="md"
          zIndexClass="z-[500]"
        >
          <form onSubmit={handleAddLeadSubmit} className="space-y-5">
            <div>
              <div className="text-base font-semibold text-[var(--app-text-85)]">
                Adicionar novo interessado
              </div>
              <div className="mt-1 text-xs text-[var(--app-text-55)]">
                Informe o número de WhatsApp. O contato será criado sem nome com o status
                &quot;Aguardando nome&quot; e entrará no fluxo antecipado da aula experimental.
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="add-lead-phone"
                className="block text-xs font-semibold text-[var(--app-text-70)]"
              >
                Número de WhatsApp
              </label>
              <input
                id="add-lead-phone"
                autoFocus
                value={addLeadPhoneInput}
                onChange={(e) => setAddLeadPhoneInput(e.target.value)}
                placeholder="Ex: 556599851142 ou (65) 9985-1142"
                className="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3 text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)] focus:border-yellow-500/40"
              />
              {addLeadError ? (
                <div className="text-xs font-semibold text-red-400">{addLeadError}</div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={addingLead}
                onClick={() => setShowAddLeadModal(false)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:opacity-60 sm:w-auto"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={addingLead || !addLeadPhoneInput.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {addingLead ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adicionando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Adicionar
                  </>
                )}
              </button>
            </div>
          </form>
        </AppModal>
      </div>
    </div>
  );
}
