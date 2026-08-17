"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AlertTriangle, Check, Copy, Download, ExternalLink, FileText, Loader2, Pencil, Save, Search, Trash2, X, Zap } from "lucide-react";
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
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDate, formatAtendimentoDateTime, formatAtendimentoLocationName } from "@/lib/atendimento/utils";

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
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
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
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 text-[11px] font-semibold text-amber-700/90">
        Link de matrícula: aguardando {missing.join(" + ")}.
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

  const savedLink = String((lead as any)?.recurring_class_link ?? "").trim();
  const finalLink = urlEncoded;

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-50 px-3 py-2.5 space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700/85">
        Link de matrícula
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={async (ev) => {
            if (typeof ev?.stopPropagation === "function") ev.stopPropagation();
            try {
              window.open(finalLink, "_blank", "noopener,noreferrer");
            } catch {}
          }}
          disabled={savingThisLead}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-700 disabled:opacity-60"
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
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60"
        >
          {savingThisLead ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          Copiar
        </button>
        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700/80 ml-0.5">
          <Check className="h-3 w-3" /> salvo
        </div>
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
  savingRecurringLink,
  onSaveRecurringLink,
}: {
  lead: AtendimentoLeadListItem;
  activeSection: SummarySectionId;
  showDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onEditName: (lead: AtendimentoLeadListItem) => void;
  savingRecurringLink: boolean;
  onSaveRecurringLink: (lead: AtendimentoLeadListItem, recurringLink: string) => Promise<void>;
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
  const isMatriculado = statusRaw === "matriculado" || statusRaw === "aluno" || funnelRaw.includes("aluno") || hasRecurring;
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
  const contractDownloadHref = contractPdfUrl
    ? `${contractPdfUrl}${contractPdfUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(`contrato_${String(lead.full_name ?? lead.phone ?? lead.id).replace(/\s+/g, "_")}.pdf`)}`
    : "";

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-hidden flex flex-col">
      <div className="min-w-0 flex flex-col items-stretch gap-3 border-b border-[var(--app-border)] pb-4 min-[1176px]:flex-row min-[1176px]:items-start min-[1176px]:justify-between shrink-0">
        <div className="min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
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
            <Field label="CPF" value={formatCpf(lead.cpf)} copyable copyValue={digitsOnly(lead.cpf)} />
            <Field label="Origem" value={atendimentoOriginLabel(lead.origin)} />
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

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-hidden flex flex-col">
      <div className="min-w-0 flex flex-col items-stretch gap-3 border-b border-[var(--app-border)] pb-4 min-[1176px]:flex-row min-[1176px]:items-start min-[1176px]:justify-between shrink-0">
        <div className="min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
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
              {(() => {
                if (!legalRespName && !legalRespCpf) return null;
                const hasBoth = Boolean(legalRespName && legalRespCpf);
                const gridClass = hasBoth ? "md:grid-cols-2" : "";
                return (
                  <div className={`grid min-w-0 gap-3 ${gridClass}`}>
                    {legalRespName ? (
                      <Field label="Responsável legal" value={legalRespName} copyable />
                    ) : null}
                    {legalRespCpf ? (
                      <Field label="CPF do responsável" value={formatCpf(legalRespCpf)} copyable copyValue={digitsOnly(legalRespCpf)} />
                    ) : null}
                  </div>
                );
              })()}
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
}: {
  lead: AtendimentoLeadListItem;
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
}) {
  const booking = lead.experimental_class_booking;
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

  const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const recurringWeekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(
    recurringWeekdayRaw,
  )
    ? (recurringWeekdayRaw as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")
    : null;
  const recurringProfessorTime = String(lead.recurring_class_professor_time ?? "").trim();
  const recurringLeadTimeRaw = String(lead.recurring_class_lead_time ?? "").trim();
  const recurringTime =
    /^\d{2}:\d{2}$/.test(recurringProfessorTime) ? recurringProfessorTime : recurringLeadTimeRaw;
  const hasRecurringClass = Boolean(
    recurringWeekday && /^\d{2}:\d{2}$/.test(recurringTime),
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
    !leadIsRecurringAlunoNow &&
    (hasStudentNotification || hasAttendantNotification || hasAttendanceStatus);
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
  const canCancel = derivedStatus === "scheduled" && Boolean(bookingId) && !hasRecurringClass;
  const canEditLessonLink =
    Boolean(bookingId) && bookingStatus !== "cancelled" && !bookingIsNoShow;
  const canSendStudentNotification =
    (derivedStatus === "scheduled" || derivedStatus === "in_progress") &&
    Boolean(bookingId) &&
    !hasStudentNotification &&
    !hasAttendantNotification &&
    !hasRecurringClass;

  useEffect(() => {
    setLessonLinkDraft(savedLessonLink);
  }, [savedLessonLink, bookingId]);

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-hidden flex flex-col">
      <div className="min-w-0 flex flex-col items-stretch gap-3 border-b border-[var(--app-border)] pb-4 min-[1176px]:flex-row min-[1176px]:items-start min-[1176px]:justify-between shrink-0">
        <div className="min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
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
        {hasRecurringClass ? (
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
                {canOpenSavedRecurringLink ? (
                  <a
                    href={savedRecurringLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-1 text-[11px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)]"
                    title="Abrir link da aula recorrente"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    Abrir aula
                  </a>
                ) : null}
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

        {hasRecurringClass && pastRecurringPaged.length ? (
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

        {booking || showIncompleteState ? (
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
                value={formatAtendimentoDate(booking?.lead_date || booking?.professor_date)}
              />
              <Field
                label="Horário"
                value={atendimentoTimeLabel(booking?.lead_time ?? booking?.professor_time ?? null)}
              />
            </div>
          </div>
        ) : null}

        {canEditLessonLink && !hasAttendanceStatus ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
            <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                Link da aula
              </div>
              {effectiveSavedLessonLink ? (
                <a
                  href={effectiveSavedLessonLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-1 text-[11px] font-semibold text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)]"
                  title="Abrir link da aula"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  Abrir aula
                </a>
              ) : null}
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

  const agendamentoItems = useMemo(
    () =>
      localLeads.filter((lead) => {
        if (leadHasExperimentalClassPanelStatus(lead)) return true;
        const recurringWeekdayRaw = String((lead as any)?.recurring_class_weekday ?? "").trim().toLowerCase();
        const hasWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw);
        const hasTimeOk =
          Boolean(String((lead as any)?.recurring_class_professor_time ?? "").trim()) ||
          Boolean(String((lead as any)?.recurring_class_lead_time ?? "").trim());
        return hasWeekdayOk && hasTimeOk;
      }),
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
      localLeads.filter(
        (lead) => {
          const st = String(lead.status ?? "").trim().toLowerCase();
          const fs = String(lead.funnel_stage ?? "").trim().toLowerCase();
          const rcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
          if (st === "matriculado" || fs === "matriculado") return false;
          if (st === "aluno" || fs === "aluno") return false;
          if (fs === "aluno_recorrente_cadastrado") return false;
          if (st === "contrato_assinado" || fs === "contrato_assinado") return false;
          if (st === "cadastro_recorrente_pendente_plataforma" || fs === "cadastro_recorrente_pendente_plataforma") return false;
          if (st === "contrato_aguardando_aceite" || fs === "contrato_aguardando_aceite") return false;
          if (st === "contrato_coletando_dados" || fs === "contrato_coletando_dados") return false;
          if (st === "matricula_confirmada" || fs === "matricula_confirmada") return false;
          if (rcs === "confirmado" || rcs === "cadastro_plataforma_pendente") return false;
          return true;
        },
      ),
    [localLeads],
  );
  const alunosItems = useMemo(
    () =>
      localLeads.filter(
        (lead) => {
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
        },
      ),
    [localLeads],
  );
  const contratosItems = useMemo(
    () =>
      localLeads.filter((lead) => {
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
      }),
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
  const [sendingStudentNotificationBookingId, setSendingStudentNotificationBookingId] =
    useState<string | null>(null);
  const [savingRecurringLinkLeadId, setSavingRecurringLinkLeadId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  const activeSectionData = sections.find((section) => section.id === activeSection) ?? sections[0];
  const activeItems = activeSectionData?.items ?? [];
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return activeItems;
    return activeItems.filter((lead) =>
      [lead.full_name, lead.phone, lead.cpf].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    );
  }, [activeItems, query]);
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
    setLocalLeads(leads);
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
      setActiveSectionSelectedLead(selectedLeadId === leadId ? null : selectedLeadId);
      setMobileDetailsOpen((current) => (selectedLeadId === leadId ? false : current));
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
      const existingForSection = Object.prototype.hasOwnProperty.call(current, activeSection)
        ? current[activeSection] ?? null
        : null;
      if (existingForSection && targetItems.some((lead) => lead.id === existingForSection)) {
        return current;
      }
      if (!targetItems.length) {
        return { ...current, [activeSection]: null };
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
    setSelectedLeadIdBySection({});
    const target = sectionsNow.find((s) => s.id === activeSection) ?? sectionsNow[0];
    const items = target?.items ?? [];
    if (!items.length) {
      return;
    }
    setQuery("");
    setPage(1);
    const firstId = items[0]?.id;
    if (typeof firstId === "string" && firstId) {
      setSelectedLeadIdBySection((current) => ({ ...current, [activeSection]: firstId }));
    }
  }, [refreshNonce, activeSection]);

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
    const booking = lead.experimental_class_booking;
    const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
    const bookingHasId = Boolean(String(booking?.id ?? "").trim());
    const bookingIsNotDraft = bookingHasId && String(booking?.source ?? "draft").trim().toLowerCase() !== "draft";
    const latestCancelledAt = String((lead as any)?.latest_experimental_class_cancelled_at ?? "").trim();
    const hasLatestCancelledMarker = Boolean(latestCancelledAt && latestCancelledAt !== "null");
    if (
      (bookingHasId && bookingIsNotDraft && bookingStatus === "cancelled") ||
      hasLatestCancelledMarker
    ) {
      return "Agendamento cancelado";
    }

    const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
    const hasWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw);
    const hasTimeOk =
      Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
      Boolean(String(lead.recurring_class_lead_time ?? "").trim());
    const hasRecurring = hasWeekdayOk && hasTimeOk;
    const isAlunoOrMatriculado =
      lead.status === "aluno" ||
      lead.status === "matriculado" ||
      (lead as any).funnel_stage === "aluno_recorrente_cadastrado" ||
      lead.status === "cadastro_recorrente_pendente_plataforma" ||
      lead.funnel_stage === "cadastro_recorrente_pendente_plataforma";
    if (isAlunoOrMatriculado) {
      if (!hasWeekdayOk || !hasTimeOk) {
        if (!hasWeekdayOk && !hasTimeOk) return "Falta dia e horário recorrentes";
        if (!hasWeekdayOk) return "Falta dia recorrente";
        return "Falta horário recorrente";
      }
      return isRecurringContractFormalized(lead) ? "Falta confirmar pagamento" : "Falta contrato";
    }

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
    const hasExpContext =
      expStatusRaw === "date_selected" ||
      expStatusRaw === "time_selected" ||
      ["aula_experimental_convidada", "pre_cadastro_concluido", "aula_experimental_agendada"].includes(expStage) ||
      Boolean(expDraftDate) ||
      Boolean(expDraftTime);
    const hasExpDate = Boolean(expDraftDate);
    const hasExpTime = Boolean(expDraftTime);

    if (activeSection !== "agendamentos") {
      if (activeSection === "contratos") {
        const signedAt = String((lead as any)?.contract_signed_at ?? "").trim();
        if (signedAt) {
          const dt = formatAtendimentoDateTime(signedAt);
          return dt ? `Criado em: ${dt}` : "";
        }
        const status = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
        if (status && status !== "nao_iniciado") {
          const rawDt = formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at);
          return rawDt ? `Criado em: ${rawDt}` : "";
        }
        return "";
      }
      const rawDt = formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at);
      return rawDt ? `Criado em: ${rawDt}` : "";
    }

    const recWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
    const recWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recWeekdayRaw);
    const recTimeOk =
      Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
      Boolean(String(lead.recurring_class_lead_time ?? "").trim());
    const hasRecurringOk = recWeekdayOk && recTimeOk;

    const futureExp = (lead as any)?.future_experimental_class_booking ?? null;
    const futureExpStatus = String(futureExp?.status ?? "").trim().toLowerCase();
    const hasFutureExp = Boolean(futureExp && futureExpStatus !== "cancelled");
    if (!hasRecurringOk && hasFutureExp) {
      const dateLabel = formatAtendimentoDate(futureExp?.lead_date || futureExp?.professor_date);
      const timeLabel = String(futureExp?.lead_time ?? futureExp?.professor_time ?? "").trim();
      const body = [dateLabel, timeLabel].filter((v) => v && v !== "-").join(", ");
      return body ? `Aula em: ${body}` : "";
    }

    const pastMeta = (lead as any)?.latest_past_class_meta ?? null;
    if (pastMeta) {
      const dateLabel = formatAtendimentoDate(String((pastMeta as any).date ?? ""));
      const timeLabel = String((pastMeta as any).time ?? "").trim();
      const body = [dateLabel, timeLabel].filter((v) => v && v !== "-").join(", ");
      return body ? `Última aula em: ${body}` : "";
    }

    const hasBook = Boolean(
      booking &&
        bookingHasId &&
        bookingIsNotDraft &&
        bookingStatus !== "cancelled",
    );
    if (hasBook) {
      const dateLabel = formatAtendimentoDate(booking?.lead_date || booking?.professor_date);
      const timeLabel = String(booking?.lead_time ?? booking?.professor_time ?? "").trim();
      const body = [dateLabel, timeLabel].filter((v) => v && v !== "-").join(", ");
      const prefix = hasRecurringOk ? "Última aula em:" : "Aula em:";
      return body ? `${prefix} ${body}` : "";
    }
    const recBothOk = recWeekdayOk && recTimeOk;
    if (recBothOk || hasRecurring) {
      return isRecurringContractFormalized(lead) ? "Falta confirmar pagamento" : "Falta contrato";
    }
    const isRecorrente =
      hasWeekdayOk ||
      hasTimeOk ||
      Boolean(String((lead as any)?.recurring_class_status ?? "").trim()) ||
      Boolean(String((lead as any)?.recurring_class_weekday_label ?? "").trim());
    if (isRecorrente && (!recWeekdayOk || !recTimeOk)) {
      if (!recWeekdayOk && !recTimeOk) return "Falta dia e horário recorrentes";
      if (!recWeekdayOk) return "Falta dia recorrente";
      return "Falta horário recorrente";
    }
    if (hasExpContext && (!hasExpDate || !hasExpTime)) {
      if (!hasExpDate && !hasExpTime) return "Falta dia e horário";
      if (!hasExpDate) return "Falta dia";
      return "Falta horário";
    }
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
            <div className="text-sm font-semibold text-[var(--app-text-85)]">{activeSectionData.label}</div>
            <label className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <Search className="h-4 w-4 text-[var(--app-text-45)]" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Pesquisar por nome, telefone ou CPF"
                className="w-full bg-transparent text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)]"
              />
            </label>
          </div>
          <div className="overflow-y-auto p-3 pr-1.5 lg:flex-1 lg:min-h-0">
            {pagedItems.length ? (
              <div className="space-y-3">
                {pagedItems.map((lead) => {
                  const active = lead.id === selectedLead?.id;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleSelectLead(lead)}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        active
                          ? "border-[var(--app-border)] bg-[var(--app-card)] lg:border-yellow-500/30 lg:bg-yellow-500/10"
                          : "border-[var(--app-border)] bg-[var(--app-card)] hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      <div
                        className="truncate text-sm font-semibold text-[var(--app-text-85)]"
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
                        if (hasWeekdayOk && hasTimeOk && !String((lead as any).recurring_class_link ?? "").trim()) {
                          warnings.push(
                            <div key="rec-link" className="mt-1 text-[11px] font-semibold text-amber-300">
                              Adicione link da aula recorrente
                            </div>,
                          );
                        }
                        const booking = lead.experimental_class_booking ?? null;
                        const bookingId = String(booking?.id ?? "").trim();
                        const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
                        if (bookingId && bookingStatus && bookingStatus !== "cancelled" && !String(booking?.lesson_link ?? "").trim()) {
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
                      <div className="mt-1 text-xs text-[var(--app-text-55)]">
                        {buildItemMeta(lead)}
                      </div>
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
              <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm text-[var(--app-text-45)]">
                {query.trim() ? "Nenhum resultado encontrado para a busca." : activeSectionData.emptyMessage}
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
                  savingRecurringLink={savingRecurringLinkLeadId === selectedLead.id}
                  onSaveRecurringLink={handleSaveRecurringLink}
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
                      savingRecurringLink={savingRecurringLinkLeadId === selectedLead.id}
                      onSaveRecurringLink={handleSaveRecurringLink}
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
      </div>
    </div>
  );
}
