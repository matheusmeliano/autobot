"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Check, Copy, ExternalLink, Loader2, Pencil, Save, Search, Trash2, X, Zap } from "lucide-react";
import { modalToast } from "@/lib/modalToast";
import { AppModal } from "@/components/app/AppModal";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import {
  deriveExperimentalClassBookingDisplayStatus,
  experimentalClassBookingDisplayStatusLabel,
  calculateNextRecurringOccurrence,
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
}: {
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
}) {
  const displayValue = value || "-";
  const canCopy = Boolean(copyable && value && String(value).trim());

  async function handleCopy() {
    if (!canCopy) return;
    await navigator.clipboard.writeText(String(value).trim());
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

type LeadNameValues = { full_name: string };

function LeadDetails({
  lead,
  showDelete,
  deleting,
  onDelete,
  onEditName,
}: {
  lead: AtendimentoLeadListItem;
  showDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onEditName: (lead: AtendimentoLeadListItem) => void;
}) {
  const hasName = Boolean(String(lead.full_name ?? "").trim());
  const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
  const hasRecurring =
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw) ||
    Boolean(String(lead.recurring_class_status ?? "").trim()) ||
    Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
    Boolean(String(lead.recurring_class_lead_time ?? "").trim());
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
  const bookingIsCancelled = bookingStatus === "cancelled";
  const isDraft = booking && (booking as any).source === "draft";
  const bookingWasNoShow = isBookingAttendanceNoShow(booking);
  const bookingAttendanceResolved = isBookingAttendanceResolved(booking);
  const showDraftSection =
    !bookingIsCancelled && !bookingWasNoShow && !bookingAttendanceResolved && showDelete && (experimentalStatus || draftDate || draftTime || isDraft);

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
        {!isLeadRepescagem(lead) && !bookingWasNoShow ? (
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <Field label="CPF" value={lead.cpf} copyable />
            <Field label="Origem" value={atendimentoOriginLabel(lead.origin)} />
            <Field label="Cidade" value={formatAtendimentoLocationName(lead.city)} />
            <Field label="Estado" value={formatAtendimentoLocationName(lead.state)} />
            <Field label="País" value={lead.country} />
            <Field label="Fuso" value={lead.timezone} />
          </div>
        ) : null}

        {lead.recurring_class_status ||
        lead.recurring_class_weekday ||
        lead.recurring_class_professor_time ||
        lead.recurring_class_lead_time ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-6">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 pr-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100/85">
                  Aula recorrente / fixa
                </div>
              </div>
              <div className="shrink-0">
                <div className="inline-flex rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-1.5 text-xs font-semibold text-emerald-100">
                  Aluno(a) confirmado
                </div>
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

function BookingDetails({
  lead,
  cancellingBookingId,
  savingLessonLinkBookingId,
  markingAttendanceBookingId,
  markingAttendanceType,
  sendingStudentNotificationBookingId,
  onCancelBooking,
  onSaveLessonLink,
  onMarkAttendance,
  onSendStudentNotification,
}: {
  lead: AtendimentoLeadListItem;
  cancellingBookingId: string | null;
  savingLessonLinkBookingId: string | null;
  markingAttendanceBookingId: string | null;
  markingAttendanceType: "attended" | "no_show" | null;
  sendingStudentNotificationBookingId: string | null;
  onCancelBooking: (lead: AtendimentoLeadListItem) => Promise<void>;
  onSaveLessonLink: (lead: AtendimentoLeadListItem, lessonLink: string) => Promise<void>;
  onMarkAttendance: (lead: AtendimentoLeadListItem, attendance: "attended" | "no_show") => Promise<void>;
  onSendStudentNotification: (lead: AtendimentoLeadListItem) => Promise<void>;
}) {
  const booking = lead.experimental_class_booking;
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
  const showAttendanceCard = hasStudentNotification || hasAttendantNotification || hasAttendanceStatus;
  const attendanceStatus = booking?.attendance_status ?? null;
  const derivedStatus = deriveExperimentalClassBookingDisplayStatus({
    bookingStatus: booking?.status,
    studentStartNotificationSentAt: booking?.student_start_notification_sent_at,
    attendantStartNotificationSentAt: booking?.attendant_start_notification_sent_at,
    attendanceStatus,
    hasSchedulingProgress: leadHasExperimentalClassPanelStatus(lead),
    hasLead: true,
  });
  const showIncompleteState = derivedStatus === "incomplete" && !bookingId;
  const displayDash = "-";

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
  const nextRecurring =
    hasRecurringClass && recurringWeekday && /^\d{2}:\d{2}$/.test(recurringTime)
      ? calculateNextRecurringOccurrence({
          weekday: recurringWeekday,
          professorTimeHHMM: recurringTime,
          professorTimeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          leadTimeZone: lead.timezone || null,
        })
      : null;
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
        {booking || showAttendanceCard || showIncompleteState ? (
          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
            <div className="flex flex-wrap items-center gap-2 min-[600px]:justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                Histórico — Aula experimental
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

        {canEditLessonLink ? (
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

        {hasRecurringClass ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-6">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 pr-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100/85">
                  Agendamentos em andamento — Próxima aula recorrente
                </div>
              </div>
              <div className="shrink-0">
                <div className="inline-flex rounded-full border border-emerald-300/25 bg-emerald-300/12 px-4 py-1.5 text-xs font-semibold text-emerald-100">
                  Aluno(a) confirmado
                </div>
              </div>
            </div>

            <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">
              <Field
                label="Dia fixo da semana"
                value={String(lead.recurring_class_weekday_label ?? "").trim() || nextRecurring?.weekdayLabel || null}
              />
              {nextRecurring?.professorDate ? (
                <Field label="Próxima aula" value={formatAtendimentoDate(nextRecurring.professorDate)} />
              ) : null}
              <Field
                label="Horário fixo"
                value={atendimentoTimeLabel(
                  String(lead.recurring_class_lead_time ?? "").trim() ||
                    String(lead.recurring_class_professor_time ?? "").trim() ||
                    nextRecurring?.professorTime ||
                    null,
                )}
              />
              <Field
                label="Fuso horário"
                value={nextRecurring?.professorTimeZone || ATENDIMENTO_PROFESSOR_TIME_ZONE}
              />
              {nextRecurring?.leadDate && nextRecurring?.leadDate !== nextRecurring?.professorDate ? (
                <Field label="Dia (horário do aluno)" value={formatAtendimentoDate(nextRecurring.leadDate)} />
              ) : null}
              {nextRecurring?.leadTime &&
              nextRecurring.leadTime !== String(lead.recurring_class_professor_time ?? "").trim() ? (
                <Field label="Horário (fuso do aluno)" value={atendimentoTimeLabel(nextRecurring.leadTime)} />
              ) : null}
              {String(lead.recurring_class_created_at ?? "").trim() ? (
                <Field
                  label="Cadastrado em"
                  value={formatAtendimentoDateTime(String(lead.recurring_class_created_at ?? "").trim())}
                />
              ) : null}
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
}: {
  summary: AtendimentoSummary;
  leads: AtendimentoLeadListItem[];
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
        const hasRecurring =
          Boolean(String((lead as any)?.recurring_class_status ?? "").trim()) ||
          Boolean(String((lead as any)?.recurring_class_weekday ?? "").trim()) ||
          Boolean(String((lead as any)?.recurring_class_professor_time ?? "").trim()) ||
          Boolean(String((lead as any)?.recurring_class_lead_time ?? "").trim());
        return hasRecurring;
      }),
    [localLeads],
  );
  const interessadosItems = useMemo(
    () =>
      localLeads.filter(
        (lead) => lead.status !== "matriculado" && lead.funnel_stage !== "matriculado",
      ),
    [localLeads],
  );
  const alunosItems = useMemo(
    () =>
      localLeads.filter(
        (lead) =>
          lead.status === "matriculado" ||
          (lead as any).funnel_stage === "matriculado" ||
          (lead as any).status === "aluno" ||
          (lead as any).funnel_stage === "aluno_recorrente_cadastrado",
      ),
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
        value: 0,
        emptyMessage: "Nenhum contrato disponível no momento.",
        items: [],
      },
    ],
    [agendamentoItems, interessadosItems, alunosItems],
  );
  const [activeSection, setActiveSection] = useState<SummarySectionId>("interessados");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const queryParamsInitializedRef = useRef(false);
  useEffect(() => {
    if (queryParamsInitializedRef.current || typeof window === "undefined") return;
    queryParamsInitializedRef.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const rawSection = String(params.get("section") ?? "").trim().toLowerCase();
      if (rawSection === "interessados" || rawSection === "alunos" || rawSection === "agendamentos" || rawSection === "contratos") {
        setActiveSection(rawSection);
      }
      const rawLeadId = String(params.get("leadId") ?? "").trim();
      if (rawLeadId) {
        setSelectedLeadId(rawLeadId);
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

    const name = String(lead.full_name ?? "").trim() || "Interessado sem nome";
    const phone = String(lead.phone ?? "").trim() || "-";
    if (!window.confirm(`Excluir interessado?\n\n${name}\n${phone}\n\nEsta ação é permanente.`)) {
      return;
    }

    try {
      setDeletingLeadId(leadId);
      const response = await fetch(`/api/atendimento/leads/${leadId}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao excluir interessado.");
        return;
      }

      setLocalLeads((current) => current.filter((item) => item.id !== leadId));
      setLocalSummary((current) => ({ ...current, totalLeads: Math.max(0, (current.totalLeads ?? 0) - 1) }));
      setSelectedLeadId((current) => (current === leadId ? null : current));
      setMobileDetailsOpen((current) => (selectedLeadId === leadId ? false : current));
      modalToast.success("Interessado excluído com sucesso.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao excluir interessado.");
    } finally {
      setDeletingLeadId(null);
    }
  }

  useEffect(() => {
    setQuery("");
    setPage(1);
  }, [activeSection]);

  useEffect(() => {
    setPage((current) => {
      if (current < 1) return 1;
      if (current > totalPages) return totalPages;
      return current;
    });
  }, [totalPages]);

  useEffect(() => {
    setSelectedLeadId((currentSelectedLeadId) => {
      if (!filteredItems.length) return null;
      return filteredItems.some((lead) => lead.id === currentSelectedLeadId) ? currentSelectedLeadId : filteredItems[0]?.id ?? null;
    });
  }, [filteredItems]);

  useEffect(() => {
    if (!selectedLead) {
      setMobileDetailsOpen(false);
    }
  }, [selectedLead]);

  function handleSelectLead(lead: AtendimentoLeadListItem) {
    setSelectedLeadId(lead.id);
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

      if (!response.ok || !payload?.ok || !payload.booking) {
        modalToast.error(payload?.error ?? "Falha ao cancelar agendamento.");
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
            status: "cancelled",
          }),
          ...(payload.booking as Partial<AtendimentoLeadListItem["experimental_class_booking"]>),
          source: ((payload.booking as any)?.source ?? booking?.source ?? "table") as "table" | "history",
          lesson_link:
            String((payload.booking as any)?.lesson_link ?? lead.experimental_class_booking?.lesson_link ?? "").trim() || null,
          status: "cancelled",
        },
      };

      setLocalLeads((current) => current.map((item) => (item.id === lead.id ? updatedLead : item)));
      setLocalSummary((current) => ({
        ...current,
        aulasExperimentaisAgendadas: Math.max(0, current.aulasExperimentaisAgendadas - 1),
      }));
      modalToast.success("Agendamento cancelado.");
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
    const recurringWeekdayRaw = String(lead.recurring_class_weekday ?? "").trim().toLowerCase();
    const hasRecurring =
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recurringWeekdayRaw) ||
      Boolean(String(lead.recurring_class_status ?? "").trim()) ||
      Boolean(String((lead as any)?.recurring_class_weekday_label ?? "").trim()) ||
      Boolean(String(lead.recurring_class_professor_time ?? "").trim()) ||
      Boolean(String(lead.recurring_class_lead_time ?? "").trim());
    if (hasRecurring) {
      return "Aluno(a) confirmado";
    }

    if (activeSection === "agendamentos") {
      const booking = lead.experimental_class_booking;
      const hasBook = Boolean(
        booking &&
          String(booking.id ?? "").trim() &&
          String(booking?.source ?? "draft").trim().toLowerCase() !== "draft" &&
          String(booking?.status ?? "").trim().toLowerCase() !== "cancelled",
      );
      if (hasBook) {
        const dateLabel = formatAtendimentoDate(booking?.lead_date || booking?.professor_date);
        const timeLabel = String(booking?.lead_time ?? booking?.professor_time ?? "").trim();
        return [dateLabel, timeLabel].filter((v) => v && v !== "-").join(", ") || "";
      }
      return "";
    }

    return formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at);
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
                      <div className="mt-1 text-xs text-[var(--app-text-55)]">
                        {buildItemMeta(lead)}
                      </div>
                      {isLeadRepescagem(lead) ? (
                        <div className="mt-2">
                          <RepescagemBadge />
                        </div>
                      ) : null}
                      {activeSection === "agendamentos" &&
                      !String(lead.experimental_class_booking?.lesson_link ?? "")
                        .trim() ? (
                        <div className="mt-2 text-[11px] font-semibold text-amber-300">Adicione o link da aula</div>
                      ) : null}
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
                  onCancelBooking={handleCancelBooking}
                  onSaveLessonLink={handleSaveLessonLink}
                  onMarkAttendance={handleMarkAttendance}
                  onSendStudentNotification={handleSendStudentNotification}
                />
              ) : (
                <LeadDetails
                  lead={selectedLead}
                  showDelete={activeSection === "interessados" || activeSection === "alunos"}
                  deleting={deletingLeadId === selectedLead.id}
                  onDelete={() => handleDeleteLead(selectedLead)}
                  onEditName={(l) => openEditLeadName(l)}
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
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                      {activeSectionData.label}
                    </div>
                    <div
                      className="mt-1 truncate text-sm font-semibold text-[var(--app-text-85)]"
                      title={selectedLead.phone || selectedLead.full_name || "Interessado sem telefone"}
                    >
                      {String(selectedLead.full_name ?? "").trim() || selectedLead.phone || "Interessado sem telefone"}
                    </div>
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
                      onCancelBooking={handleCancelBooking}
                      onSaveLessonLink={handleSaveLessonLink}
                      onMarkAttendance={handleMarkAttendance}
                      onSendStudentNotification={handleSendStudentNotification}
                    />
                  ) : (
                    <LeadDetails
                      lead={selectedLead}
                      showDelete={activeSection === "interessados" || activeSection === "alunos"}
                      deleting={deletingLeadId === selectedLead.id}
                      onDelete={() => handleDeleteLead(selectedLead)}
                      onEditName={(l) => openEditLeadName(l)}
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
