"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, BarChart3, Bot, Calendar as CalendarIcon, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Eraser, ExternalLink, FileText, GraduationCap, Info, Loader2, MapPin, Palette, Pencil, Plus, RefreshCw, Save, Search, Sparkles, Trash2, UserRound, X, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE, STAGE_LABELS, STATUS_LABELS } from "@/lib/atendimento/constants";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveTimeZoneFromCityInput, zonedDateTimeToUtcIso } from "@/lib/timezone";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { modalToast } from "@/lib/modalToast";
import { formatAtendimentoDate, formatAtendimentoDateTime, leadMatchesSearchQuery } from "@/lib/atendimento/utils";
import { buildExperimentalClassPostAttendanceWhatsAppMessages } from "@/lib/atendimento/experimentalClass";
import { AppModal } from "@/components/app/AppModal";
import { AppDateRangePicker, type AppDateRange } from "@/components/app/AppDateRangePicker";

const EMPTY_SUMMARY: AtendimentoSummary = {
  totalLeads: 0,
  novosLeads: 0,
  emAtendimento: 0,
  aulasExperimentaisAgendadas: 0,
  matriculasPendentes: 0,
  matriculados: 0,
  conversasNaoLidas: 0,
};

const EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT: Array<{ name: string; phone: string; short: string }> = [
  { name: "Lucas Brum", phone: "+55 65 9807-9407", short: "9807-9407" },
  { name: "Nathan Camargo", phone: "+55 65 9952-0166", short: "9952-0166" },
];

function experimentalAssignedProfessorForLead(lead: AtendimentoLeadListItem | null | undefined): { name: string; phone: string; short: string } | null {
  if (!lead) return null;
  const flatName = String((lead as any)?.experimental_class_professor_name ?? "").trim();
  const flatPhone = String((lead as any)?.experimental_class_professor_phone ?? "").trim();
  if (flatName && flatPhone) {
    const m = EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT.find((p) => p.phone === flatPhone && p.name === flatName);
    if (m) return m;
  }
  if (flatPhone) {
    const m = EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT.find((p) => p.phone === flatPhone);
    if (m) return m;
  }
  const bk = lead.experimental_class_booking as any;
  const bkName = String(bk?.assigned_professor_name ?? "").trim();
  const bkPhone = String(bk?.assigned_professor_phone ?? "").trim();
  if (bkName && bkPhone) {
    const m = EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT.find((p) => p.phone === bkPhone && p.name === bkName);
    if (m) return m;
  }
  if (bkPhone) {
    const m = EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT.find((p) => p.phone === bkPhone);
    if (m) return m;
  }
  return null;
}

function experimentalLessonLinkForLead(lead: AtendimentoLeadListItem | null | undefined): string {
  if (!lead) return "";
  const bk = lead.experimental_class_booking as any;
  const fromBk = String(bk?.lesson_link ?? "").trim();
  if (fromBk) return fromBk;
  return String((lead as any)?.experimental_class_link ?? "").trim();
}

function experimentalBookingIdForLead(lead: AtendimentoLeadListItem | null | undefined): string {
  if (!lead) return "";
  const idFromLead = String((lead as any)?.experimental_class_booking_id ?? "").trim();
  if (idFromLead) return idFromLead;
  const bk = lead.experimental_class_booking as any;
  const fromBk = String(bk?.id ?? "").trim();
  if (fromBk) return fromBk;
  return "";
}

function experimentalHasAnyDisparoConcluido(lead: AtendimentoLeadListItem | null | undefined): boolean {
  if (!lead) return false;
  const bk = lead.experimental_class_booking as any;
  const sStu = String(bk?.student_start_notification_sent_at ?? "").trim();
  const sAtt = String(bk?.attendant_start_notification_sent_at ?? "").trim();
  const att = String(bk?.attendance_status ?? "").trim();
  const st = String(bk?.status ?? "").trim().toLowerCase();
  const flatStu = String((lead as any)?.experimental_class_student_notification_sent_at ?? "").trim();
  const flatAtt = String((lead as any)?.experimental_class_attendant_notification_sent_at ?? "").trim();
  return Boolean(sStu || sAtt || flatStu || flatAtt || att === "attended" || att === "no_show" || st === "cancelled");
}

type LeadDetailsTab = "visao_geral" | "agendamentos" | "historico" | "observacoes";
const LEAD_DETAILS_TABS: ReadonlyArray<{ id: LeadDetailsTab; label: string; icon: JSX.Element }> = [
  { id: "visao_geral", label: "Visão geral", icon: <UserRound className="h-4 w-4" /> },
  { id: "agendamentos", label: "Agendamentos", icon: <CalendarIcon className="h-4 w-4" /> },
  { id: "historico", label: "Contrato", icon: <FileText className="h-4 w-4" /> },
  { id: "observacoes", label: "Observações", icon: <Pencil className="h-4 w-4" /> },
];

function buildInitials(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  if (!clean) return "??";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function deriveLeadEffectiveTimeZone(lead: AtendimentoLeadListItem | null | undefined): string {
  if (!lead) return ATENDIMENTO_PROFESSOR_TIME_ZONE;
  const cityRaw = String((lead as any).city ?? "").trim();
  const stateRaw = String((lead as any).state ?? "").trim();
  const phoneRaw = String(lead.phone ?? "").trim();
  if (cityRaw) {
    const r = resolveTimeZoneFromCityInput({
      city: cityRaw,
      state: stateRaw || null,
      phone: phoneRaw || null,
      allowPhoneCountryFallback: true,
    });
    if (r?.timeZone) return r.timeZone;
  }
  const savedTz = String((lead as any).timezone ?? "").trim();
  return savedTz || ATENDIMENTO_PROFESSOR_TIME_ZONE;
}

function extractLocalDateFromUtcIso(iso: string, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(iso));
  } catch {
    return "";
  }
}

function extractLocalTimeFromUtcIso(iso: string, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const out = fmt.format(new Date(iso));
    return out.replace(/\s+/g, "");
  } catch {
    return "";
  }
}

function isExperimentalClassPast(lead: AtendimentoLeadListItem | null | undefined): boolean {
  if (!lead) return false;
  const l = lead as any;
  const nowMs = Date.now();
  const tryIso = (iso: unknown): number | null => {
    const s = String(iso ?? "").trim();
    if (!s) return null;
    const d = new Date(s).getTime();
    if (!Number.isFinite(d) || d <= 0) return null;
    return d;
  };
  const tryFromDateParts = (date: unknown, time: unknown, tz: unknown): number | null => {
    const d = String(date ?? "").trim();
    const t = String(time ?? "").trim();
    if (!d || !t) return null;
    try {
      const utcIso = zonedDateTimeToUtcIso({
        date: d,
        time: t,
        timeZone: String(tz ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
      });
      const n = new Date(utcIso).getTime();
      if (!Number.isFinite(n) || n <= 0) return null;
      return n;
    } catch {
      return null;
    }
  };
  let bestMs: number | null = null;
  const profStartMs = tryIso(l.experimental_class_professor_start_at ?? l.professor_start_at);
  if (profStartMs) bestMs = bestMs == null ? profStartMs : Math.min(bestMs, profStartMs);
  const leadStartMs = tryIso(l.experimental_class_lead_start_at ?? l.lead_start_at);
  if (leadStartMs) bestMs = bestMs == null ? leadStartMs : Math.min(bestMs, leadStartMs);
  const bkProfStartMs = tryIso(l.experimental_class_booking?.professor_start_at ?? l.latest_experimental_class_booking?.professor_start_at ?? l.future_experimental_class_booking?.professor_start_at);
  if (bkProfStartMs) bestMs = bestMs == null ? bkProfStartMs : Math.min(bestMs, bkProfStartMs);
  const bkLeadStartMs = tryIso(l.experimental_class_booking?.lead_start_at ?? l.latest_experimental_class_booking?.lead_start_at ?? l.future_experimental_class_booking?.lead_start_at);
  if (bkLeadStartMs) bestMs = bestMs == null ? bkLeadStartMs : Math.min(bestMs, bkLeadStartMs);
  if (bestMs == null) {
    const profTz = String(l.experimental_class_booking?.professor_timezone ?? l.latest_experimental_class_booking?.professor_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
    const flatProfMs = tryFromDateParts(l.experimental_class_professor_date, l.experimental_class_professor_time, profTz);
    if (flatProfMs) bestMs = bestMs == null ? flatProfMs : Math.min(bestMs, flatProfMs);
    const bkProfDate = String(l.experimental_class_booking?.professor_date ?? l.latest_experimental_class_booking?.professor_date ?? "").trim();
    const bkProfTime = String(l.experimental_class_booking?.professor_time ?? l.latest_experimental_class_booking?.professor_time ?? "").trim();
    const bkProfMs = tryFromDateParts(bkProfDate, bkProfTime, profTz);
    if (bkProfMs) bestMs = bestMs == null ? bkProfMs : Math.min(bestMs, bkProfMs);
  }
  if (bestMs == null) return false;
  return bestMs < nowMs;
}

function applyPhoneMask(input: string): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("55")) {
    const rest = digits.slice(2);
    if (rest.length === 0) return "+55";
    if (rest.length <= 2) return `+55 ${rest}`;
    const ddd = rest.slice(0, 2);
    const local = rest.slice(2);
    const has9 = local.length >= 9 && local.startsWith("9");
    if (rest.length === 3) return `+55 ${ddd} ${local}`;
    if (has9) {
      if (local.length <= 5) return `+55 (${ddd}) 9 ${local.slice(1)}`;
      if (local.length <= 9)
        return `+55 (${ddd}) 9 ${local.slice(1, 5)}-${local.slice(5)}`;
      const extra = local.slice(10);
      return `+55 (${ddd}) 9 ${local.slice(1, 5)}-${local.slice(5, 9)} ${extra}`;
    } else {
      if (local.length <= 4) return `+55 ${ddd} ${local}`;
      if (local.length <= 8) return `+55 ${ddd} ${local.slice(0, 4)}-${local.slice(4)}`;
      const extra = local.slice(8);
      return `+55 ${ddd} ${local.slice(0, 4)}-${local.slice(4, 8)} ${extra}`;
    }
  }

  if (digits.startsWith("1")) {
    const rest = digits.slice(1);
    if (rest.length === 0) return "+1";
    if (rest.length <= 3) return `+1 ${rest}`;
    const area = rest.slice(0, 3);
    const local = rest.slice(3);
    if (rest.length === 4) return `+1 ${area} ${local}`;
    if (rest.length <= 6) return `+1 ${area} ${local}`;
    if (rest.length === 7) return `+1 ${area} ${local.slice(0, 3)}-${local.slice(3)}`;
    if (rest.length <= 10)
      return `+1 ${area} ${local.slice(0, 3)}-${local.slice(3)}`;
    const extra = rest.slice(10);
    return `+1 ${area} ${local.slice(0, 3)}-${local.slice(3, 7)} ${extra}`;
  }

  if (digits.startsWith("7")) {
    const rest = digits.slice(1);
    if (rest.length === 0) return "+7";
    if (rest.length <= 3) return `+7 ${rest}`;
    const area = rest.slice(0, 3);
    const local = rest.slice(3);
    if (rest.length <= 6) return `+7 ${area} ${local}`;
    if (rest.length <= 10) return `+7 ${area} ${local.slice(0, 3)}-${local.slice(3)}`;
    const extra = rest.slice(10);
    return `+7 ${area} ${local.slice(0, 3)}-${local.slice(3, 7)} ${extra}`;
  }

  if (digits.length <= 3) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
  const country = digits.slice(0, 2);
  const num = digits.slice(2);
  if (num.length <= 4) return `+${country} ${num}`;
  if (num.length <= 8) return `+${country} ${num.slice(0, 4)}-${num.slice(4)}`;
  const groups: string[] = [];
  groups.push(num.slice(0, 4));
  const restG = num.slice(4);
  for (let i = 0; i < restG.length; i += 4) groups.push(restG.slice(i, i + 4));
  return `+${country} ${groups.join("-")}`;
}

function buildExperimentalMetaForList(lead: AtendimentoLeadListItem): { label: string; tone: "success" | "warning" | "default" } {
  const booking = lead.experimental_class_booking;
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  const bookingHasId = Boolean(String(booking?.id ?? "").trim());
  const bookingIsNotDraft = bookingHasId && String(booking?.source ?? "draft").trim().toLowerCase() !== "draft";
  const latestCancelledAt = String((lead as any)?.latest_experimental_class_cancelled_at ?? "").trim();
  const hasLatestCancelledMarker = Boolean(latestCancelledAt && latestCancelledAt !== "null");
  const futureExp = (lead as any)?.future_experimental_class_booking ?? null;
  const futureExpStatus = String(futureExp?.status ?? "").trim().toLowerCase();
  const hasFutureExp = Boolean(futureExp && futureExpStatus !== "cancelled");

  const bookingProfDate = (booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled")
    ? String((booking as any)?.professor_date ?? "").slice(0, 10).trim()
    : "";
  const bookingProfTime = (booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled")
    ? String((booking as any)?.professor_time ?? "").trim()
    : "";
  const futureBookingProfDate = hasFutureExp
    ? String((futureExp as any)?.professor_date ?? "").slice(0, 10).trim()
    : "";
  const futureBookingProfTime = hasFutureExp
    ? String((futureExp as any)?.professor_time ?? "").trim()
    : "";
  const leadFlatProfDate = hasLatestCancelledMarker
    ? ""
    : String((lead as any)?.experimental_class_professor_date ?? "").slice(0, 10).trim();
  const leadFlatProfTime = hasLatestCancelledMarker
    ? ""
    : String((lead as any)?.experimental_class_professor_time ?? "").trim();

  const bestProfDate = bookingProfDate || futureBookingProfDate || leadFlatProfDate;
  const bestProfTime = bookingProfTime || futureBookingProfTime || leadFlatProfTime;

  let dateRawOk = "";
  let timeRawOk = "";
  if (bestProfDate && bestProfTime) {
    try {
      const leadEffectiveTz = deriveLeadEffectiveTimeZone(lead);
      const utcIso = zonedDateTimeToUtcIso({
        date: bestProfDate,
        time: bestProfTime,
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      });
      if (utcIso) {
        dateRawOk = extractLocalDateFromUtcIso(utcIso, leadEffectiveTz);
        timeRawOk = extractLocalTimeFromUtcIso(utcIso, leadEffectiveTz);
      }
    } catch {
      dateRawOk = "";
      timeRawOk = "";
    }
  }
  if (!dateRawOk || !timeRawOk) {
    const leadFlatDate = hasLatestCancelledMarker
      ? ""
      : String((lead as any)?.experimental_class_lead_date ?? "").trim();
    const leadFlatTime = hasLatestCancelledMarker
      ? ""
      : String((lead as any)?.experimental_class_lead_time ?? "").trim();
    const futureBookingLeadDate = hasFutureExp
      ? String((futureExp as any)?.lead_date ?? "").trim()
      : "";
    const futureBookingLeadTime = hasFutureExp
      ? String((futureExp as any)?.lead_time ?? "").trim()
      : "";
    const bookingLeadDate = (booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled")
      ? String((booking as any)?.lead_date ?? "").trim()
      : "";
    const bookingLeadTime = (booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled")
      ? String((booking as any)?.lead_time ?? "").trim()
      : "";
    dateRawOk = leadFlatDate || futureBookingLeadDate || bookingLeadDate;
    timeRawOk = leadFlatTime || futureBookingLeadTime || bookingLeadTime;
  }
  if (dateRawOk && timeRawOk) {
    const dmy = formatAtendimentoDate(dateRawOk);
    const hm = String(timeRawOk).replace(/h/gi, "").trim();
    return { label: `Aula em: ${dmy}, ${hm}h`, tone: "success" };
  }
  const recurringWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(String(lead.recurring_class_weekday ?? "").trim().toLowerCase());
  const recurringTimeOk = Boolean(String(lead.recurring_class_professor_time ?? "").trim()) || Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  if (!stateRaw && !cityRaw) return { label: "Falta estado e cidade", tone: "warning" };
  if (stateRaw && !cityRaw) return { label: "Falta cidade", tone: "warning" };
  if (!stateRaw && cityRaw) return { label: "Falta estado", tone: "warning" };
  if (!recurringWeekdayOk && !recurringTimeOk && !hasFutureExp && !dateRawOk && !timeRawOk) {
    return { label: "Falta dia e horário", tone: "warning" };
  }
  if (!recurringWeekdayOk && !recurringTimeOk && !hasFutureExp && dateRawOk && !timeRawOk) {
    return { label: "Falta horário", tone: "warning" };
  }
  if (!recurringWeekdayOk && !recurringTimeOk && !hasFutureExp && !dateRawOk && timeRawOk) {
    return { label: "Falta dia", tone: "warning" };
  }
  return { label: "Novo registro", tone: "default" };
}

function buildRecurringMetaForVisaoGeral(lead: AtendimentoLeadListItem): { title: string; body: string; tone: "warning" | "success" | "default" } | null {
  const st = String(lead.status ?? "").trim().toLowerCase();
  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  const locationOk = Boolean(stateRaw) && Boolean(cityRaw);
  const ps = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmed = ps === "confirmado" || ps === "matriculado" || st === "matriculado" || st === "aluno";
  if (payConfirmed) return { title: "Matrícula concluída", body: "Todos os dados foram confirmados.", tone: "success" };
  if (!stateRaw && !cityRaw) {
    return { title: "Falta estado e cidade", body: "Clique em Editar no card Informações para preencher.", tone: "warning" };
  }
  if (stateRaw && !cityRaw) {
    return { title: "Falta cidade", body: "Clique em Editar no card Informações para preencher a cidade.", tone: "warning" };
  }
  if (!stateRaw && cityRaw) {
    return { title: "Falta estado", body: "Clique em Editar no card Informações para preencher o estado.", tone: "warning" };
  }
  const recurringWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(String(lead.recurring_class_weekday ?? "").trim().toLowerCase());
  const recurringTimeOk = Boolean(String(lead.recurring_class_professor_time ?? "").trim()) || Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const regStepOk = Number.isFinite(regStepRaw) && regStepRaw >= 1 && regStepRaw <= 12;
  const rcsRaw = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const rec = recurringWeekdayOk || recurringTimeOk || regStepOk || Boolean(rcsRaw);
  if (rec && !recurringWeekdayOk && !recurringTimeOk) {
    return { title: "Falta dia e horário recorrentes", body: "Defina dia e horário para continuar.", tone: "warning" };
  }
  if (rec && recurringWeekdayOk && !recurringTimeOk) {
    return { title: "Falta horário recorrente", body: "Defina o horário da aula recorrente.", tone: "warning" };
  }
  if (rec && !recurringWeekdayOk && recurringTimeOk) {
    return { title: "Falta dia recorrente", body: "Defina o dia da semana da aula recorrente.", tone: "warning" };
  }
  const expMeta = buildExperimentalMetaForList(lead);
  if (!rec && expMeta.tone === "warning") {
    return { title: expMeta.label, body: "Complete os dados para agendar a aula experimental.", tone: "warning" };
  }
  return null;
}

function buildRecurringClassUrl(lead: AtendimentoLeadListItem): string {
  const nomeStr = String(lead.full_name ?? "").trim();
  const telStr = String(lead.phone ?? "").replace(/\D/g, "").trim();
  const baseOrigin = typeof window !== "undefined" && window?.location?.origin ? String(window.location.origin) : "";
  const qs = new URLSearchParams();
  if (nomeStr) qs.set("nome", nomeStr);
  if (telStr) qs.set("telefone", telStr);
  const rel = `/cadastro/recorrente?${qs.toString()}`;
  if (baseOrigin) return new URL(rel, baseOrigin).toString();
  return rel;
}

function isLeadMatriculaConcluida(lead: AtendimentoLeadListItem): boolean {
  const payStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const leadStatusRaw = String((lead as any)?.status ?? "").trim().toLowerCase();
  const funnelRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  return (
    payStatusRaw === "confirmado" ||
    payStatusRaw === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    leadStatusRaw === "matriculado" ||
    leadStatusRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    funnelRaw === "matricula_confirmada"
  );
}

export function AtendimentoClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Retorna TRUE se houver QUALQUER filtro ativo (qualquer tipo).
  // Quando === FALSE (tudo vazio), a URL deve ser a base /app/atendimento (sem query params).
  // Usado pelos handlers de Limpar e Aplicar do filtro avançado e do onChange do calendário.
  const hasAnyFilterActive = useCallback((f: LeadFilters): boolean => {
    if (f.createdFrom || f.createdTo) return true;
    if (
      f.bookingDateFrom ||
      f.bookingDateTo ||
      f.bookingProfessorName ||
      f.bookingPhone ||
      f.bookingPN ||
      Array.isArray(f.bookingLeadIds) && f.bookingLeadIds.length > 0
    ) {
      return true;
    }
    for (const k of ADVANCED_FILTER_KEYS) {
      const v = (f as any)[k];
      if (Array.isArray(v) && v.length > 0) return true;
      if (typeof v === "boolean" && v === true) return true;
    }
    return false;
  }, []);
  const [summary, setSummary] = useState<AtendimentoSummary>(EMPTY_SUMMARY);
  const [panelLeads, setPanelLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<LeadDetailsTab>("visao_geral");
  const tabsScrollDesktopRef = useRef<HTMLDivElement | null>(null);
  const tabsScrollMobileRef = useRef<HTMLDivElement | null>(null);
  const [desktopTabsCanLeft, setDesktopTabsCanLeft] = useState(false);
  const [desktopTabsCanRight, setDesktopTabsCanRight] = useState(false);
  const [mobileTabsCanLeft, setMobileTabsCanLeft] = useState(false);
  const [mobileTabsCanRight, setMobileTabsCanRight] = useState(false);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadPhone, setCreateLeadPhone] = useState("");
  const [createLeadName, setCreateLeadName] = useState("");
  const [createLeadSaving, setCreateLeadSaving] = useState(false);
  const [observacoesDraft, setObservacoesDraft] = useState<string>("");
  const [observacoesSaving, setObservacoesSaving] = useState(false);
  const [showMobileLeadModal, setShowMobileLeadModal] = useState(false);
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showColorLegendModal, setShowColorLegendModal] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [botExperimentalDisabled, setBotExperimentalDisabled] = useState<boolean>(false);
  const [botExperimentalLoading, setBotExperimentalLoading] = useState<boolean>(false);
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  const [editLeadName, setEditLeadName] = useState("");
  const [editLeadPhone, setEditLeadPhone] = useState("");
  const [editLeadCity, setEditLeadCity] = useState("");
  const [editLeadState, setEditLeadState] = useState("");
  const [editLeadCountry, setEditLeadCountry] = useState("");
  const [editLeadTimezone, setEditLeadTimezone] = useState("");
  const [editLeadSaving, setEditLeadSaving] = useState(false);

  const [editLocationOpen, setEditLocationOpen] = useState(false);
  const [editLocationCity, setEditLocationCity] = useState("");
  const [editLocationState, setEditLocationState] = useState("");
  const [editLocationSaving, setEditLocationSaving] = useState(false);

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

  const [isExpInfoOpen, setIsExpInfoOpen] = useState(false);
  const [expInfoLead, setExpInfoLead] = useState<AtendimentoLeadListItem | null>(null);

  const [isEditSenhaOpen, setIsEditSenhaOpen] = useState(false);
  const [editSenhaValue, setEditSenhaValue] = useState("");
  const [editSenhaSaving, setEditSenhaSaving] = useState(false);

  const LIST_PAGE_SIZE = 20;
  const [leadListPage, setLeadListPage] = useState(1);
  // ==================== FORÇADOR DE QUICK FILTER POR URL ====================
  // User confirmou: "funcionava em filtros avançados" e "muda a url, faz alguma coisa".
  // Motivo: SEMPRE que o usuário clicar no GraduationCap, atualizamos a URL.
  // O applyFiltersToLeads agora LER SEMPRE a URL atual (window.location.search)
  // independentemente do que chegar no objeto f — assim se f.quickStatusList for
  // apagado por qualquer reset/Spread acidental, o quick ainda funciona.
  // Além disso, mantemos state `quickUrlForceTick` como dependência extra do
  // useMemo de filteredLeads para garantir re-execução.
  const [quickUrlForceTick, setQuickUrlForceTick] = useState(0);
  const bumpQuickUrlForceTick = useCallback(() => {
    setQuickUrlForceTick((x) => x + 1);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    bumpQuickUrlForceTick();
    const handler = () => bumpQuickUrlForceTick();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [bumpQuickUrlForceTick]);
  // Leitor de quick SEMPRE VIVO (direto de window.location.search — independe de searchParams e f):
  const currentUrlQuickIdsDirect = (): string[] => {
    const out: string[] = [];
    if (typeof window === "undefined") return out;
    try {
      const qs = new URLSearchParams(window.location.search);
      const raw = qs.get("quickStatusList") ?? qs.get("quick") ?? qs.get("qs") ?? "";
      if (!raw) return out;
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!p) continue;
        if (p.startsWith("quick__")) out.push(p);
        else out.push(`quick__${p}`);
      }
    } catch {}
    return Array.from(new Set(out));
  };
  // =========================================================================

  // Campos 100% CONTROLADOS PELO MODAL DE FILTROS AVANÇADOS.
  // Estes são os ÚNICOS campos que o modal de filtros avançados tem permissão de
  // ler/escrever. Os campos de calendário (createdFrom/createdTo) e de filtro de
  // aula (booking*) são COMPARTILHADOS com outros componentes e NUNCA devem ser
  // tocados pelo filtro avançado — garante independência TOTAL entre eles.
  const ADVANCED_FILTER_KEYS = [
    "quickStatusList",
    "statusList",
    "stageList",
    "countries",
    "states",
    "onlyWithUnread",
    "onlyWithPhone",
    "onlyWithEmail",
    "onlyWithScheduledClass",
    "onlyWithContract",
  ] as const;
  type AdvancedFilterKey = (typeof ADVANCED_FILTER_KEYS)[number];

  type LeadFilters = {
    quickStatusList?: string[];
    statusList: string[];
    stageList: string[];
    countries: string[];
    states: string[];
    onlyWithUnread: boolean;
    onlyWithPhone: boolean;
    onlyWithEmail: boolean;
    onlyWithScheduledClass: boolean;
    onlyWithContract: boolean;
    createdFrom: string;
    createdTo: string;
    // Filtro NOVO (botão Ver do modal programação-do-dia):
    // mostra SÓ os leads cuja AULA EXPERIMENTAL aconteceu no dia escolhido (professor_date do booking)
    // e professor escolhido (qualquer match nome/telefone). Exatamente a lista do modal.
    bookingDateFrom: string;
    bookingDateTo: string;
    bookingProfessorName: string;
    bookingPhone?: string;
    bookingPN?: boolean;
    bookingLeadIds?: string[];
    bookingPhoneDigits?: string;
  };
  const EMPTY_FILTERS: LeadFilters = {
    quickStatusList: [],
    statusList: [],
    stageList: [],
    countries: [],
    states: [],
    onlyWithUnread: false,
    onlyWithPhone: false,
    onlyWithEmail: false,
    onlyWithScheduledClass: false,
    onlyWithContract: false,
    createdFrom: "",
    createdTo: "",
    bookingDateFrom: "",
    bookingDateTo: "",
    bookingProfessorName: "",
    bookingPhone: "",
    bookingPN: false,
    bookingLeadIds: [],
    bookingPhoneDigits: "",
  };
  // EMPTY_ADVANCED_FILTERS: objeto com SÓ os 9+1 campos do filtro avançado, todos vazios.
  // Usado para iniciar um draft novo SEM herdar valores do calendário (createdFrom/createdTo etc).
  const EMPTY_ADVANCED_FILTERS: Pick<LeadFilters, AdvancedFilterKey> = {
    quickStatusList: [],
    statusList: [],
    stageList: [],
    countries: [],
    states: [],
    onlyWithUnread: false,
    onlyWithPhone: false,
    onlyWithEmail: false,
    onlyWithScheduledClass: false,
    onlyWithContract: false,
  };

  // Extrai de um filters SÓ os 9 campos do filtro avançado (ignora resto).
  const pickAdvancedOnly = (f: LeadFilters): Pick<LeadFilters, AdvancedFilterKey> => {
    const out = { ...EMPTY_ADVANCED_FILTERS };
    for (const k of ADVANCED_FILTER_KEYS) out[k] = (f as any)[k] ?? EMPTY_ADVANCED_FILTERS[k];
    return out;
  };
  // Mescla apenas os 9 campos avançados do draft em activeFilters — PRESERVA intactos
  // createdFrom/createdTo (calendário de cadastro) e booking* (botão Ver, limpo separadamente).
  const mergeAdvancedOnly = (active: LeadFilters, advancedDraft: Pick<LeadFilters, AdvancedFilterKey>): LeadFilters => {
    const next: any = { ...active };
    for (const k of ADVANCED_FILTER_KEYS) next[k] = (advancedDraft as any)[k];
    return next;
  };
  const [activeFilters, setActiveFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSubscribedRef = useRef(false);
  const initialLoadCompletedRef = useRef(false);
  const suppressAutoSelectUntilRef = useRef<number>(0);
  const explicitSelectLockRef = useRef<boolean>(false);
  // Lock para PROTEGER o setLeadListPage() do handleDeleteSelected de ser
  // ZERADO (para 1) pelo useEffect() L2002 que roda ao panelLeads.length mudar.
  // Sempre que excluirmos um registro, setamos o safePageAfter manualmente e
  // travamos esse lock por ~50ms → o useEffect pula o reset. Depois expira e
  // tudo volta ao normal (reset page=1 ao mudar filtro/busca continua OK).
  const preventResetPageUntilRef = useRef<number>(0);

  // Detecta viewport <1201px (tamanho MOBILE para layout atendimento)
  useEffect(() => {
    function updateViewport() {
      if (typeof window === "undefined") return;
      setIsMobileViewport(window.innerWidth < 1201);
    }
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // HIDRATA FILTROS INICIAIS a partir dos query params (botão "Ver" do modal programação-do-dia):
  //   ?stage=aula_experimental_agendada&bookingProfessor=Nathan+Camargo&bookingFrom=YYYY-MM-DD&bookingTo=YYYY-MM-DD
  // Roda UMA VEZ no mount (initialUrlFiltersAppliedRef), nunca mais depois.
  const initialUrlFiltersAppliedRef = useRef<boolean>(false);
  useEffect(() => {
    if (initialUrlFiltersAppliedRef.current) return;
    try {
      const stageQ = String(searchParams?.get("stage") ?? searchParams?.get("stageList") ?? "").trim();
      const statusQ = String(searchParams?.get("status") ?? searchParams?.get("statusList") ?? "").trim();
      const qQ = String(searchParams?.get("q") ?? searchParams?.get("query") ?? searchParams?.get("search") ?? "").trim();
      const fromQ = String(searchParams?.get("from") ?? searchParams?.get("createdFrom") ?? "").trim().slice(0, 10);
      const toQ = String(searchParams?.get("to") ?? searchParams?.get("createdTo") ?? "").trim().slice(0, 10);
      // NOVOS params do botão Ver (filtrar POR AULA do dia/professor, não por data de cadastro):
      const bookingFromQ = String(searchParams?.get("bookingFrom") ?? searchParams?.get("bookingDate") ?? "").trim().slice(0, 10);
      const bookingToQ = String(searchParams?.get("bookingTo") ?? searchParams?.get("bookingDate") ?? "").trim().slice(0, 10);
      const bookingProfQ = String(searchParams?.get("bookingProfessor") ?? searchParams?.get("teacher") ?? searchParams?.get("prof") ?? "").trim();
      const bookingPhoneQ = String(searchParams?.get("bookingPhone") ?? searchParams?.get("phone") ?? "").trim();
      const bookingPNQ = String(searchParams?.get("bookingPN") ?? "").trim().toLowerCase() === "1";
      // ===== NOVO PARAM EXATO (conjunto explícito do botão Ver do modal programação) =====
      // Evita bugs de falsos positivos/negativos do includesProf client-side:
      //   - Aline Faustino (LB) aparecendo no Ver de "Professor não atribuído" (23/09);
      //   - José Marcos (composite PN) não aparecendo no Ver do PN (26/09, colunas físicas não tem booking composite);
      //   - Marcela (PN rec) aparecendo no Ver de NC (26/09).
      const bookingLeadIdsRaw = String(searchParams?.get("bookingLeadIds") ?? searchParams?.get("leadIds") ?? searchParams?.get("ids") ?? "").trim();
      const bookingLeadIdsQ: string[] = bookingLeadIdsRaw
        ? Array.from(new Set(bookingLeadIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)))
        : [];
      // Quick filter por URL (bypass: ?quickStatusList=quick__matriculado ou ?quick=matriculado)
      const quickRaw = String(searchParams?.get("quickStatusList") ?? searchParams?.get("quick") ?? searchParams?.get("qs") ?? "").trim();
      const quickStatusListQ: string[] = quickRaw
        ? Array.from(
            new Set(
              quickRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((p) => (p.startsWith("quick__") ? p : `quick__${p}`)),
            ),
          )
        : [];
      const nextActive = { ...EMPTY_FILTERS };
      const nextDraft = { ...EMPTY_FILTERS };
      let changed = false;
      if (quickStatusListQ.length > 0) {
        nextActive.quickStatusList = quickStatusListQ;
        nextDraft.quickStatusList = quickStatusListQ;
        changed = true;
      }
      if (stageQ) {
        const candidates = stageQ.split(",").map((s) => s.trim()).filter(Boolean);
        if (candidates.length) {
          nextActive.stageList = candidates;
          nextDraft.stageList = candidates;
          changed = true;
        }
      }
      if (statusQ) {
        const candidates = statusQ.split(",").map((s) => s.trim()).filter(Boolean);
        if (candidates.length) {
          nextActive.statusList = candidates;
          nextDraft.statusList = candidates;
          changed = true;
        }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromQ)) {
        nextActive.createdFrom = fromQ;
        nextDraft.createdFrom = fromQ;
        changed = true;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(toQ)) {
        nextActive.createdTo = toQ;
        nextDraft.createdTo = toQ;
        changed = true;
      }
      // NOVO: filtro de aula (experimental OU recorrente) do dia + professor (exatamente os bookings do modal)
      const hasBookingFilter =
        /^\d{4}-\d{2}-\d{2}$/.test(bookingFromQ) ||
        /^\d{4}-\d{2}-\d{2}$/.test(bookingToQ) ||
        Boolean(bookingProfQ) ||
        Boolean(bookingPhoneQ) ||
        Boolean(bookingPNQ) ||
        Boolean(bookingLeadIdsQ.length);
      if (hasBookingFilter) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(bookingFromQ)) nextActive.bookingDateFrom = bookingFromQ;
        if (/^\d{4}-\d{2}-\d{2}$/.test(bookingToQ)) nextActive.bookingDateTo = bookingToQ;
        if (bookingProfQ) nextActive.bookingProfessorName = bookingProfQ;
        if (bookingPNQ) nextActive.bookingProfessorName = "Professor não atribuído";
        nextDraft.bookingDateFrom = nextActive.bookingDateFrom;
        nextDraft.bookingDateTo = nextActive.bookingDateTo;
        nextDraft.bookingProfessorName = nextActive.bookingProfessorName;
        // Phone passa por casting pois não está no tipo principal (não exposto na UI, só via URL)
        (nextActive as any).bookingPhone = bookingPhoneQ;
        (nextDraft as any).bookingPhone = bookingPhoneQ;
        (nextActive as any).bookingPN = bookingPNQ;
        (nextDraft as any).bookingPN = bookingPNQ;
        // ===== bookingLeadIdsQ: array explícito de ids alvo MAIOR PRIORIDADE que includesProf client-side =====
        // Lista exata enviada pelo botão Ver do modal programação-do-dia (ocupadosList[].aluno.id).
        // 100% match com o que aparece no card, sem falsos positivos/negativos por colunas faltantes.
        (nextActive as any).bookingLeadIds = bookingLeadIdsQ;
        (nextDraft as any).bookingLeadIds = bookingLeadIdsQ;
        changed = true;
        // ⚠️ ATENÇÃO: NÃO setar stageList=["aula_experimental_agendada"] automaticamente aqui.
        // No mesmo dia/professor pode ter EXPERIMENTAIS (agendados) E RECORRENTES (Aluno).
        // O filtro de bookingDateFrom/To + professor name/phone já é restritivo o suficiente para
        // retornar exatamente os leads das aulas que aparecem NO MODAL "Programação do dia".
        // Setar stage hardcoded causava o bug "Aparece X aulas no modal mas Ver leva pra 0 registros"
        // quando alguma aula era RECORRENTE (Aluno).
      }
      if (changed) {
        setActiveFilters(nextActive);
        setDraftFilters(nextDraft);
      }
      if (qQ && !hasBookingFilter) {
        // Q search só mantemos se NÃO temos booking filter (booking filter já garante o conjunto certo,
        // o search q=NomeProfessor estava bagunçando e mostrando "nenhum registro ainda")
        setSearchQuery(qQ);
      }
    } catch {}
    initialUrlFiltersAppliedRef.current = true;
  }, [searchParams]);

  // Quando troca pra desktop, fecha modal (nao precisa mais, section esta visivel!)
  useEffect(() => {
    if (!isMobileViewport) setShowMobileLeadModal(false);
  }, [isMobileViewport]);

  const selectedLead = useMemo<AtendimentoLeadListItem | null>(() => {
    if (!selectedLeadId) return null;
    return panelLeads.find((l) => l.id === selectedLeadId) ?? null;
  }, [panelLeads, selectedLeadId]);

  const bookingLocationOk = useMemo<boolean>(() => {
    if (!selectedLead) return false;
    const stateRaw = String((selectedLead as any)?.state ?? "").trim();
    const cityRaw = String((selectedLead as any)?.city ?? "").trim();
    return Boolean(stateRaw) && Boolean(cityRaw);
  }, [selectedLead]);

  // Quando TRUE: interessado acessou link matricula, concluiu cadastro inicial e VIRou ALUNO recorrente
  // Nesse momento:
  //   1. CARD RECORRENTE PASSA A EXISTIR (antes ficava oculto para interessados/experimental)
  //   2. CARD EXPERIMENTAL some completamente (é substituido pelo recorrente)
  // Regra 100% igual ao SummaryCards::isLeadInAlunosSection — garantir consistencia visual
  const showRecurringCard = useMemo<boolean>(() => {
    const lead = selectedLead as any;
    if (!lead) return false;
    const st = String(lead.status ?? "").trim().toLowerCase();
    const fs = String(lead?.funnel_stage ?? "").trim().toLowerCase();
    const rcs = String(lead?.recurring_class_status ?? "").trim().toLowerCase();
    const ps = String(lead?.payment_status ?? "").trim().toLowerCase();
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
  }, [selectedLead]);

  // ---- Controladores do card "Aulas experimentais" (tab Agendamentos) DESKTOP + MOBILE ----
  const [expAssignProfDropdownOpen, setExpAssignProfDropdownOpen] = useState<boolean>(false);
  const [expAssigningProfessor, setExpAssigningProfessor] = useState<boolean>(false);
  const [expSavingLessonLink, setExpSavingLessonLink] = useState<boolean>(false);
  const [expSendingNotification, setExpSendingNotification] = useState<boolean>(false);
  const [expCancellingBookingId, setExpCancellingBookingId] = useState<string | null>(null);
  const [expSendingPostAttendanceId, setExpSendingPostAttendanceId] = useState<string | null>(null);
  const [expLessonLinkDraftByLeadId, setExpLessonLinkDraftByLeadId] = useState<Record<string, string>>({});

  const experimentalLessonLinkDraft = useMemo<string>(() => {
    const current = expLessonLinkDraftByLeadId[selectedLead?.id ?? ""];
    if (typeof current === "string") return current;
    return experimentalLessonLinkForLead(selectedLead);
  }, [expLessonLinkDraftByLeadId, selectedLead]);

  useEffect(() => {
    if (!selectedLead?.id) return;
    setExpAssignProfDropdownOpen(false);
    setExpLessonLinkDraftByLeadId((prev) => {
      if (typeof prev[selectedLead.id] === "string") return prev;
      return { ...prev, [selectedLead.id]: experimentalLessonLinkForLead(selectedLead) };
    });
  }, [selectedLead?.id]);

  const experimentalLockedProf = useMemo<boolean>(() => {
    return experimentalHasAnyDisparoConcluido(selectedLead);
  }, [selectedLead]);

  async function handleAssignProfessorExperimental(lead: AtendimentoLeadListItem, prof: { name: string; phone: string }) {
    if (expAssigningProfessor) return;
    if (experimentalLockedProf) {
      modalToast.warning("Professor não pode ser alterado após o disparo ser realizado.");
      return;
    }
    setExpAssigningProfessor(true);
    try {
      const res = await fetch(`/api/atendimento/leads/${encodeURIComponent(lead.id)}/experimental-booking/assign-professor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professor_name: prof.name, professor_phone: prof.phone, scope: "experimental" }),
      });
      const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao vincular professor à aula experimental.");
        return;
      }
      setPanelLeads((cur) =>
        cur.map((l) =>
          l.id === lead.id
            ? ({
                ...l,
                experimental_class_professor_name: prof.name,
                experimental_class_professor_phone: prof.phone,
              } as AtendimentoLeadListItem)
            : l,
        ),
      );
      const fresh = await fetch(`/api/atendimento/leads/${encodeURIComponent(lead.id)}?skipEvents=1`, { cache: "no-store" })
        .then(async (r) => (r.ok ? r.json().catch(() => null) : null))
        .catch(() => null) as { ok?: boolean; lead?: Record<string, unknown> | null } | null;
      if (fresh?.ok && fresh.lead?.id) {
        setPanelLeads((cur) => cur.map((l) => (l.id === lead.id ? ({ ...l, ...fresh.lead } as AtendimentoLeadListItem) : l)));
      }
      modalToast.success("Professor vinculado à aula experimental.");
    } finally {
      setExpAssigningProfessor(false);
    }
  }

  async function handleSaveLessonLinkExperimental(lead: AtendimentoLeadListItem) {
    if (expSavingLessonLink) return;
    const saved = experimentalLessonLinkForLead(lead);
    const draft = experimentalLessonLinkDraft.trim();
    if (experimentalLockedProf) {
      modalToast.warning("Link não pode ser alterado após o disparo ser realizado.");
      return;
    }
    if (!draft && !saved) {
      modalToast.warning("Informe o link da aula antes de salvar.");
      return;
    }
    if (draft === saved) {
      modalToast.info("Nenhuma alteração no link da aula.");
      return;
    }
    const bookingId = experimentalBookingIdForLead(lead);
    const safeBookingId = bookingId || `draft-${lead.id}`;
    setExpSavingLessonLink(true);
    try {
      const res = await fetch(`/api/atendimento/bookings/${encodeURIComponent(safeBookingId)}/lesson-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonLink: draft || null,
          leadId: lead.id,
          conversationId: String((lead as any).conversation_id ?? "").trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao salvar o link da aula.");
        return;
      }
      const fresh = await fetch(`/api/atendimento/leads/${encodeURIComponent(lead.id)}?skipEvents=1`, { cache: "no-store" })
        .then(async (r) => (r.ok ? r.json().catch(() => null) : null))
        .catch(() => null) as { ok?: boolean; lead?: Record<string, unknown> | null } | null;
      if (fresh?.ok && fresh.lead?.id) {
        setPanelLeads((cur) => cur.map((l) => (l.id === lead.id ? ({ ...l, ...fresh.lead } as AtendimentoLeadListItem) : l)));
      }
      modalToast.success(draft ? "Link da aula salvo." : "Link da aula removido.");
    } finally {
      setExpSavingLessonLink(false);
    }
  }

  async function handleSendStudentNotificationExperimental(lead: AtendimentoLeadListItem) {
    if (expSendingNotification) return;
    const professorOk = experimentalAssignedProfessorForLead(lead);
    const linkOk = experimentalLessonLinkForLead(lead);
    if (!professorOk) {
      modalToast.warning("Selecione o professor responsável antes de disparar agora.");
      return;
    }
    if (!linkOk) {
      modalToast.warning("Adicione o link da aula experimental antes de disparar a notificação.");
      return;
    }
    if (!String(lead.phone ?? "").trim()) {
      modalToast.warning("Registro não possui telefone cadastrado para receber a notificação.");
      return;
    }
    const bookingId = experimentalBookingIdForLead(lead);
    const safeBookingId = bookingId || `draft-${lead.id}`;
    setExpSendingNotification(true);
    try {
      const res = await fetch(`/api/atendimento/bookings/${encodeURIComponent(safeBookingId)}/send-student-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          conversationId: String((lead as any).conversation_id ?? "").trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        student_notification_sent?: boolean;
        attendant_notification_sent?: boolean;
      } | null;
      if (!res.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao disparar as notificações.");
        return;
      }
      const fresh = await fetch(`/api/atendimento/leads/${encodeURIComponent(lead.id)}?skipEvents=1`, { cache: "no-store" })
        .then(async (r) => (r.ok ? r.json().catch(() => null) : null))
        .catch(() => null) as { ok?: boolean; lead?: Record<string, unknown> | null } | null;
      if (fresh?.ok && fresh.lead?.id) {
        setPanelLeads((cur) => cur.map((l) => (l.id === lead.id ? ({ ...l, ...fresh.lead } as AtendimentoLeadListItem) : l)));
      }
      modalToast.success("Notificações disparadas.");
    } finally {
      setExpSendingNotification(false);
    }
  }

  async function handleCancelExperimentalBooking(lead: AtendimentoLeadListItem) {
    const bk = (lead as any).experimental_class_booking as any;
    const bookingId = String(bk?.id ?? "").trim();
    const statusRaw = String(bk?.status ?? "").trim().toLowerCase();
    if (!bookingId) {
      modalToast.warning("Nenhum agendamento encontrado para cancelar.");
      return;
    }
    if (statusRaw === "cancelled") {
      modalToast.info("Agendamento já está cancelado.");
      return;
    }
    if (statusRaw !== "scheduled") {
      modalToast.warning("Apenas agendamentos confirmados podem ser cancelados.");
      return;
    }
    const assigned = experimentalAssignedProfessorForLead(lead);
    if (!assigned) {
      modalToast.error("Selecione o professor responsável antes de cancelar o agendamento.");
      return;
    }
    if (!window.confirm("Deseja realmente cancelar este agendamento de aula experimental?")) {
      return;
    }
    try {
      setExpCancellingBookingId(bookingId);
      const res = await fetch(`/api/atendimento/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          conversationId: String((lead as any).conversation?.id ?? (lead as any).conversation_id ?? "").trim() || null,
          professorDate: bk?.professor_date ?? null,
          professorTime: bk?.professor_time ?? null,
          professorStartAt: bk?.professor_start_at ?? null,
          leadDate: bk?.lead_date ?? null,
          leadTime: bk?.lead_time ?? null,
          leadTimeZone: bk?.lead_timezone ?? null,
          professorTimeZone: bk?.professor_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string | null }
        | null;
      if (!res.ok || !payload?.ok) {
        if (payload?.error === "missing_experimental_professor_for_cancel") {
          modalToast.error(
            payload?.message ??
              "Selecione o professor responsável antes de cancelar o agendamento.",
          );
        } else {
          modalToast.error(payload?.error ?? "Falha ao cancelar agendamento.");
        }
        return;
      }
      setPanelLeads((cur) =>
        cur.map((l) => {
          if (l.id !== lead.id) return l;
          const next = { ...l } as any;
          if (next.experimental_class_booking && typeof next.experimental_class_booking === "object") {
            next.experimental_class_booking = {
              ...next.experimental_class_booking,
              status: "cancelled",
            };
          }
          next.latest_experimental_class_cancelled_at = new Date().toISOString();
          next.latest_experimental_class_event = "experimental_class_cancelled";
          next.experimental_class_status = "cancelled";
          return next as AtendimentoLeadListItem;
        }),
      );
      setSummary((cur) => ({
        ...cur,
        aulasExperimentaisAgendadas: Math.max(0, cur.aulasExperimentaisAgendadas - 1),
      }));
      modalToast.success("Agendamento cancelado.");
    } catch (err) {
      modalToast.error(err instanceof Error ? err.message : "Falha ao cancelar agendamento.");
    } finally {
      setExpCancellingBookingId(null);
    }
  }

  async function handleSendExperimentalPostAttendanceMessage(lead: AtendimentoLeadListItem) {
    const conversationIdRaw =
      String((lead as any).conversation?.id ?? (lead as any).conversation_id ?? "").trim() || null;
    const phoneRaw = String(lead.phone ?? "").trim();
    const expBestBooking =
      (lead as any).latest_experimental_class_booking ??
      (lead as any).experimental_class_booking ??
      (lead as any).future_experimental_class_booking;
    const bk = expBestBooking as any;
    let att =
      String(bk?.attendance_status ?? (lead as any).experimental_class_attendance_status ?? "").trim();
    if (!att) {
      const bookingIdCandidate =
        String(bk?.id ?? (lead as any).experimental_class_booking_id ?? "").trim() ||
        `draft-${String(lead.id ?? "").trim()}`;
      if (bookingIdCandidate && bookingIdCandidate !== "draft-") {
        try {
          const resAtt = await fetch(`/api/atendimento/bookings/${encodeURIComponent(bookingIdCandidate)}/attendance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attendance: "attended",
              leadId: String(lead.id ?? "").trim() || null,
              conversationId: conversationIdRaw,
            }),
          });
          if (resAtt.ok) {
            att = "attended";
          }
        } catch {
          att = "";
        }
      }
    }
    if (!att) {
      modalToast.warning("Marque o comparecimento da aula experimental antes de enviar a mensagem de matrícula.");
      return;
    }
    if (!conversationIdRaw) {
      modalToast.warning("Nenhuma conversa vinculada a este registro para enviar a mensagem.");
      return;
    }
    if (!phoneRaw) {
      modalToast.warning("Registro não possui telefone cadastrado para receber a mensagem.");
      return;
    }
    if (expSendingPostAttendanceId) return;
    const nowIso = new Date().toISOString();
    setExpSendingPostAttendanceId(lead.id);
    try {
      const safeOrigin =
        typeof window !== "undefined" && window?.location?.origin ? String(window.location.origin) : "https://www.autobot.business";
      const [message] = buildExperimentalClassPostAttendanceWhatsAppMessages(String(lead.full_name ?? "").trim(), {
        phone: phoneRaw,
        baseUrl: safeOrigin || "https://www.autobot.business",
      });
      const res = await fetch(`/api/atendimento/conversas/${encodeURIComponent(conversationIdRaw)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_text: String(message ?? "").trim() }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: Record<string, unknown> | null }
        | null;
      if (!res.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao enviar a mensagem de matrícula.");
        return;
      }
      setPanelLeads((cur) =>
        cur.map((l) => {
          if (l.id !== lead.id) return l;
          const next = { ...l } as any;
          next.experimental_class_post_attendance_message_sent_at = nowIso;
          next.experimental_class_attendance_status = next.experimental_class_attendance_status || att;
          next.last_interaction_at = nowIso;
          next.updated_at = nowIso;
          if (typeof next.experimental_class_booking === "object" && next.experimental_class_booking) {
            next.experimental_class_booking = {
              ...next.experimental_class_booking,
              post_attendance_message_sent_at: nowIso,
              attendance_status: next.experimental_class_booking.attendance_status || att,
            };
          }
          if (typeof next.latest_experimental_class_booking === "object" && next.latest_experimental_class_booking) {
            next.latest_experimental_class_booking = {
              ...next.latest_experimental_class_booking,
              post_attendance_message_sent_at: nowIso,
              attendance_status: next.latest_experimental_class_booking.attendance_status || att,
            };
          }
          return next as AtendimentoLeadListItem;
        }),
      );
      modalToast.success("Mensagem de matrícula enviada.");
    } catch (err) {
      modalToast.error(err instanceof Error ? err.message : "Falha ao enviar a mensagem de matrícula.");
    } finally {
      setExpSendingPostAttendanceId(null);
    }
  }

  const applyFiltersToLeads = (
    leads: AtendimentoLeadListItem[],
    f: LeadFilters,
  ): AtendimentoLeadListItem[] => {
    // ================== FONTE 0 DA VERDADE: DIRETO DA URL (window.location) ==================
    // User pediu explicitamente: "Muda a url, força o registro a aparecer".
    // Essa é a garantia NUCLEAR. Mesmo que f.quickStatusList seja apagado por
    // spread/reset acidental, SE A URL TIVER ?quickStatusList=quick__matriculado
    // OU ?quick=matriculado, o filtro FUNCIONA MESMO ASSIM.
    // ----------------------------------------------------------------------------------------
    let urlQuickIds: string[] = [];
    if (typeof window !== "undefined") {
      try {
        const qs = new URLSearchParams(window.location.search);
        const raw = qs.get("quickStatusList") ?? qs.get("quick") ?? qs.get("qs") ?? "";
        if (raw) {
          const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
          for (const p of parts) {
            if (!p) continue;
            if (p.startsWith("quick__")) urlQuickIds.push(p);
            else urlQuickIds.push(`quick__${p}`);
          }
          urlQuickIds = Array.from(new Set(urlQuickIds));
        }
      } catch {}
    }
    const hasQuickUrl = urlQuickIds.length > 0;
    const hasAnyFilter = (() => {
      const vals = [
        f.statusList.length,
        f.stageList.length,
        f.countries.length,
        f.states.length,
        f.onlyWithUnread,
        f.onlyWithPhone,
        f.onlyWithEmail,
        f.onlyWithScheduledClass,
        f.onlyWithContract,
        f.createdFrom,
        f.createdTo,
        f.bookingDateFrom,
        f.bookingDateTo,
        f.bookingProfessorName,
        f.bookingPhone ?? "",
        f.bookingPhoneDigits ?? "",
        Array.isArray(f.bookingLeadIds) ? f.bookingLeadIds.length : 0,
        Array.isArray((f as any).quickStatusList) ? (f as any).quickStatusList.length : 0,
        urlQuickIds.length,
      ];
      return vals.some((v) => (typeof v === "number" ? v > 0 : typeof v === "boolean" ? v : Boolean(String(v ?? "").trim())));
    })();
    if (!hasAnyFilter) return leads;
    const statusMatches = (statusId: string, l: AtendimentoLeadListItem): boolean => {
      const st = String(l.status ?? "").trim().toLowerCase();
      const fs = String(l.funnel_stage ?? "").trim().toLowerCase();
      const sid = String(statusId ?? "").trim().toLowerCase();
      if (!sid) return false;
      return st === sid || fs === sid;
    };

    // ===== DETECT TEACHER KEY (MESMO ALGORITMO do endpoint /programacao-diaria L520-L576) =====
    // Match robusto por NOME SUBSTRING (lucas brum / nathan camargo / variantes) OU
    // 4 ÚLTIMOS DÍGITOS do TELEFONE (9407 = LB, 0166 = NC). Fallback "PN" = professor não atribuído.
    // Essa função garante alinhamento EXATO entre "o que o modal mostra" e "o que o filtro encontra".
    const detectTeacherKeyFromRow = (nameRaw: string | null | undefined, phoneRaw: string | null | undefined): "LB" | "NC" | "PN" => {
      const name = String(nameRaw ?? "").trim().toUpperCase();
      const phone = String(phoneRaw ?? "").replace(/\D/g, "");
      const last4 = phone.length >= 4 ? phone.slice(-4) : "";

      // 4 últimos dígitos (MAIS ROBUSTO, telefone não tem typos)
      if (last4 === "9407") return "LB"; // Lucas Brum
      if (last4 === "0166") return "NC"; // Nathan Camargo

      // Nome substring (contra typos "LUCAS BRUM", "LUCAS B.", "NATHAM", "NATAN" etc)
      if (name.includes("LUCAS") && name.includes("BRUM")) return "LB";
      if (name.includes("LUCAS BRUM")) return "LB";
      if (name.includes("LUCAS")) {
        // Evita falso positivo "Lucas XYZ" — se tem só "Lucas" sem outro sobrenome forte, pede também não ter "Camargo"
        if (!name.includes("CAMARGO")) return "LB";
      }
      if (name.includes("NATHAN") || name.includes("NATAN") || name.includes("NATHAM")) return "NC";
      if (name.includes("CAMARGO")) return "NC";

      // Nenhum match → Professor Não Atribuído (PN).
      // IMPORTANTE: NÃO retorna null. Toda aula no modal tem UM professor (mesmo que "não atribuído").
      return "PN";
    };
    const PROF_NAMES: Record<"LB" | "NC" | "PN", string> = {
      LB: "Lucas Brum",
      NC: "Nathan Camargo",
      PN: "Professor não atribuído",
    };
    const PROF_PHONES: Record<"LB" | "NC" | "PN", string> = {
      LB: "+55 65 9807-9407",
      NC: "+55 65 9952-0166",
      PN: "Número indisponível",
    };

    // Helper: gera TODAS as datas YYYY-MM-DD no intervalo [from, to] (inclusivo) cujo weekday bate (se weekday != null)
    // Usa a norma: 0 = sun, 1 = mon, 2 = tue, 3 = wed, 4 = thu, 5 = fri, 6 = sat
    const datesInRangeByWeekday = (fromISO: string, toISO: string, weekdayNumber: number | null): string[] => {
      const startStr = String(fromISO ?? "").slice(0, 10);
      const endStr = String(toISO ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) return [];
      const out: string[] = [];
      const [ys, ms, ds] = startStr.split("-").map(Number);
      const [ye, me, de] = endStr.split("-").map(Number);
      let d = new Date(ys, ms - 1, ds);
      const endD = new Date(ye, me - 1, de);
      if (Number.isNaN(d.getTime()) || Number.isNaN(endD.getTime())) return [];
      // Safe-loop: máximo de 365 iterações (1 ano)
      let guard = 0;
      while (d <= endD && guard++ < 366) {
        const wd = d.getDay();
        if (weekdayNumber === null || wd === weekdayNumber) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          out.push(`${yyyy}-${mm}-${dd}`);
        }
        d.setDate(d.getDate() + 1);
      }
      return out;
    };
    const weekdayToNum = (w: string | null | undefined): number | null => {
      const s = String(w ?? "").trim().toLowerCase();
      if (!s) return null;
      if (s.startsWith("sun") || s.startsWith("dom")) return 0;
      if (s.startsWith("mon") || s.startsWith("seg")) return 1;
      if (s.startsWith("tue") || s.startsWith("ter")) return 2;
      if (s.startsWith("wed") || s.startsWith("qua")) return 3;
      if (s.startsWith("thu") || s.startsWith("qui")) return 4;
      if (s.startsWith("fri") || s.startsWith("sex")) return 5;
      if (s.startsWith("sat") || s.startsWith("sab")) return 6;
      return null;
    };

    // Helper: extrai TODOS os professores/datas de AULA (TANTO EXPERIMENTAIS composite/flat QUANTO RECORRENTES).
    // Agora também:
    //  - Recebe bookingFrom / bookingTo para CALCULAR datas semanais recorrentes (weekday) DENTRO do intervalo
    //    → resolve o bug que "recorrente com weekday sat não tinha nenhuma data no 26/09 e o filtro rejeitava".
    //  - Usa detectTeacherKeyFromRow para MESMO algoritmo do modal programação-do-dia
    //    → resolve bug de "nome vazio (null) vira PN" e match por 4 dígitos/variações de nome
    //  - Experimental tabela (composite) com assigned_professor_name=null também cai corretamente em PN.
    const getAulaProfDateList = (
      l: AtendimentoLeadListItem,
      rangeFrom?: string | null,
      rangeTo?: string | null,
    ): Array<{ date: string; profName: string; profPhone: string; status: string; key: "LB" | "NC" | "PN" }> => {
      const out: Array<{ date: string; profName: string; profPhone: string; status: string; key: "LB" | "NC" | "PN" }> = [];
      const push = (dateStr: string, nm: string | null | undefined, ph: string | null | undefined, status: string | null | undefined) => {
        const key = detectTeacherKeyFromRow(nm, ph);
        const dateClean = String(dateStr ?? "").trim().slice(0, 10);
        out.push({
          date: dateClean,
          profName: nm && String(nm).trim() ? String(nm).trim() : PROF_NAMES[key],
          profPhone: ph && String(ph).trim() ? String(ph).trim() : PROF_PHONES[key],
          status: String(status ?? "").trim().toLowerCase(),
          key,
        });
      };

      // ========== FONTE 1A: EXPERIMENTAIS COMPOSITE (tabela atendimento_experimental_class_bookings) ==========
      const b1 = (l as any)?.experimental_class_booking as any;
      const b2 = (l as any)?.latest_experimental_class_booking as any;
      const b3 = (l as any)?.future_experimental_class_booking as any;
      for (const b of [b1, b2, b3]) {
        if (!b) continue;
        const dt = String(b?.professor_date ?? b?.lead_date ?? "").trim().slice(0, 10);
        const nm = String(b?.assigned_professor_name ?? "").trim() || null;
        const ph = String(b?.assigned_professor_phone ?? "").trim() || null;
        const st = String(b?.status ?? "").trim();
        if (dt) push(dt, nm, ph, st);
        else if (nm || ph) push("", nm, ph, st);
      }

      // ========== FONTE 1B: EXPERIMENTAIS FLAT (colunas experimental_class_* direto no atendimento_leads) ==========
      {
        const dt = String((l as any)?.experimental_class_professor_date ?? (l as any)?.experimental_class_lead_date ?? "").trim().slice(0, 10);
        const nm = String((l as any)?.experimental_class_professor_name ?? "").trim() || null;
        const ph = String((l as any)?.experimental_class_professor_phone ?? "").trim() || null;
        const st = String((l as any)?.experimental_class_status ?? l?.funnel_stage ?? "").trim();
        if (dt || nm || ph) push(dt, nm, ph, st);
      }

      // ========== FONTE 2: RECORRENTES (Aluno) ==========
      {
        const nmRaw = String((l as any)?.recurring_class_professor_name ?? "").trim() || null;
        const phRaw = String((l as any)?.recurring_class_professor_phone ?? "").trim() || null;
        const st = String((l as any)?.recurring_class_status ?? l?.funnel_stage ?? "").trim();
        const weekdayNum = weekdayToNum((l as any)?.recurring_class_weekday ?? (l as any)?.recurring_class_weekday_label);
        const hasRec = Boolean(
          nmRaw || phRaw || weekdayNum !== null ||
          (l.funnel_stage && ["aluno", "matriculado", "matricula_confirmada", "aluno_recorrente_cadastrado", "pagamento_pendente_confirmacao"].includes(l.funnel_stage)),
        );
        if (!hasRec) {
          // ok
        } else {
          // Coleta datas FIXAS (as que existem como colunas)
          const fixedDates: string[] = [];
          const pushD = (v: unknown) => {
            const s = String(v ?? "").trim();
            if (!s) return;
            let dstr = "";
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) dstr = s.slice(0, 10);
            else {
              const d = new Date(s);
              if (!Number.isNaN(d.getTime())) {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                dstr = `${yyyy}-${mm}-${dd}`;
              }
            }
            if (dstr) fixedDates.push(dstr);
          };
          // Colunas FÍSICAS EXISTENTES (confirmadas no Supabase query):
          pushD((l as any)?.recurring_class_created_at);
          // Tenta pushD também nas colunas que podem ou não existir (sem try/catch, só acessa como any — ignora null/undefined)
          pushD((l as any)?.recurring_class_next_date);
          pushD((l as any)?.recurring_class_last_date);
          pushD((l as any)?.next_charge_date);
          pushD((l as any)?.recurring_payment_next_date);

          const uniqFixed = Array.from(new Set(fixedDates.filter(Boolean)));

          // ===== INJEÇÃO SEMANAL: calcula dias do rangeFrom..rangeTo (se vierem) que batem com weekday =====
          // Esse é o PONTO CRÍTICO do bug: recorrente weekday=sat criada em 24/09 (quinta) para começar em 26/09 (sábado)
          // — NÃO tinha nenhuma data fixa igual a 26/09, então o dateInRange sempre falhava.
          // Agora, se tiver bookingFrom/To e weekday, geramos TODAS as datas do intervalo com aquele weekday.
          if (rangeFrom && rangeTo && weekdayNum !== null) {
            const weekly = datesInRangeByWeekday(rangeFrom, rangeTo, weekdayNum);
            for (const d of weekly) uniqFixed.push(d);
          }
          // Fallback: se tiver rangeFrom/To mas SEM weekday (improvável mas seguro), puxa TUDO do intervalo
          else if (rangeFrom && rangeTo && weekdayNum === null && uniqFixed.length === 0) {
            const all = datesInRangeByWeekday(rangeFrom, rangeTo, null);
            for (const d of all) uniqFixed.push(d);
          }

          const uniq = Array.from(new Set(uniqFixed.filter(Boolean)));
          if (uniq.length > 0) {
            for (const dt of uniq) push(dt, nmRaw, phRaw, st);
          } else {
            // Sem datas — pode ser que o filtro não tenha from/to (só filtra professor). Push date vazio.
            push("", nmRaw, phRaw, st);
          }
        }
      }

      return out;
    };
    const normName = (s: string) => String(s ?? "").trim().toLowerCase();
    const normPhone = (s: string) => String(s ?? "").replace(/\D+/g, "");
    const includesProf = (
      profRow: { profName: string; profPhone: string; key?: "LB" | "NC" | "PN" },
      target: { name: string; phone: string; phoneDigitsOnly: string },
    ): boolean => {
      // === FASE 1: detectTeacherKey IGUAL no ROW e no TARGET (robusto e MESMO algorítmo do modal)
      // Essa é a MELHOR camada. Se o professor é LB no ROW e LB no TARGET → match imediato (mesmo se nomes/phones
      // forem formatados de forma diferente ou um lado for vazio e tivermos apenas key via fallback).
      const rowKey: "LB" | "NC" | "PN" =
        profRow.key && ["LB", "NC", "PN"].includes(profRow.key)
          ? profRow.key
          : detectTeacherKeyFromRow(profRow.profName, profRow.profPhone);
      const tgtKey: "LB" | "NC" | "PN" = target.name || target.phone || target.phoneDigitsOnly
        ? detectTeacherKeyFromRow(target.name, target.phone || target.phoneDigitsOnly)
        : "PN";
      if (rowKey === tgtKey) return true;

      // === FASE 2 (fallback): match por telefone digits only (melhor que nome)
      if (target.phoneDigitsOnly) {
        const rp = normPhone(profRow?.profPhone ?? "");
        if (rp && (rp.includes(target.phoneDigitsOnly) || target.phoneDigitsOnly.includes(rp))) return true;
      }
      // === FASE 3 (fallback): match por nome substring
      const tn = normName(target.name);
      const rn = normName(profRow?.profName ?? "");
      if (tn && rn && (rn === tn || rn.includes(tn) || tn.includes(rn))) return true;
      return false;
    };
    const dateInRange = (dt: string, from: string, to: string): boolean => {
      const d = String(dt ?? "").trim().slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    // ==== CORREÇÃO: filtro De/Até do calendário AGORA É SÓ SOBRE AULAS (experimental + recorrente)
    // = OU, SE NÃO TIVER AULA NENHUMA, data de cadastro do lead (fallback).
    // (A versão anterior era WIDE DEMAIS: updated_at, mensagens, histórico, tudo entrava → trazia aulas FORA do período.)
    // Semântica exata do usuário (print: 25/09 → 26/09):
    //   "Só registros QUE TEM AULA DENTRO desse intervalo. Não trazer aulas de FORA."
    const extractAulaDatesOnly = (l: AtendimentoLeadListItem): string[] => {
      const rawDates: string[] = [];
      const push = (v: string | undefined | null) => {
        const s = String(v ?? "").trim();
        if (!s) return;
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          rawDates.push(s.slice(0, 10));
        } else {
          const d = new Date(s);
          if (!Number.isNaN(d.getTime())) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            rawDates.push(`${yyyy}-${mm}-${dd}`);
          }
        }
      };
      // 1) AULAS EXPERIMENTAIS: data que FOI ou VAI SER DADA A AULA (professor_date = data real daula)
      const bookingsArr: unknown[] = [];
      if ((l as any)?.experimental_class_booking) bookingsArr.push((l as any).experimental_class_booking);
      if ((l as any)?.latest_experimental_class_booking) bookingsArr.push((l as any).latest_experimental_class_booking);
      if ((l as any)?.future_experimental_class_booking) bookingsArr.push((l as any).future_experimental_class_booking);
      for (const b of bookingsArr) {
        const bb = b as any;
        push(bb?.professor_date);      // ⭐ PRINCIPAL: data da aula para o professor (America/Cuiabá)
        push(bb?.lead_date);           // ⭐ Data da aula para o aluno (se tz diferente)
        push(bb?.scheduled_at);        // Data/hora agendado (fallback)
        push(bb?.rescheduled_at);
        push(bb?.completed_at);        // Aula concluída
        push(bb?.attendance_marked_at); // Presença marcada
        push(bb?.professor_start_at);  // start ISO (fallback)
        push(bb?.lead_start_at);       // start ISO aluno
      }
      // Flat experimental
      push((l as any)?.experimental_class_professor_date);
      push((l as any)?.experimental_class_lead_date);
      push((l as any)?.experimental_class_lead_date_scheduled_at);
      push((l as any)?.experimental_class_scheduled_at);
      push((l as any)?.experimental_class_attendance_marked_at);
      push((l as any)?.experimental_class_professor_start_at);
      push((l as any)?.experimental_class_lead_start_at);

      // 2) AULAS RECORRENTES (aulas de aluno matriculado) — data das aulas recorrentes
      push((l as any)?.recurring_class_next_date);
      push((l as any)?.recurring_class_last_date);
      push((l as any)?.recurring_payment_next_date);
      push((l as any)?.recurring_payment_last_date);
      push((l as any)?.next_charge_date);
      push((l as any)?.last_charge_date);
      push((l as any)?.schedule_charge_at);
      push((l as any)?.next_renewal_at);

      // FALLBACK (se não tiver NENHUMA data de aula registrada): cai em data de cadastro do lead
      // Assim, recém-lead sem agendamento ainda aparece se a data de cadastro for no período.
      let hasAnyAula = rawDates.length > 0;
      if (!hasAnyAula) {
        push(l.created_at);
        push((l as any)?.converted_at);
      }

      return Array.from(
        new Set(
          rawDates
            .map((s) => String(s ?? "").trim())
            .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
        ),
      );
    };

    // ==================== NOVA REGRA DO ZERO: STATUS QUICK (4 opções sintéticas) ====================
    // - quick__experimental_agendada  : tem aula experimental válida agendada (não cancelada)
    // - quick__experimental_incompleta: NÃO É (agendada válida / matrícula incompleta / matriculado)
    //                                   → todo lead do funil que ainda não concluiu experimental
    // - quick__matricula_incompleta   : iniciou matrícula (stage/status pré-matrícula) mas NÃO concluída
    // - quick__matriculado            : matrícula CONCLUÍDA (aluno / contrato assinado / enrollment etc)
    // ================================================================================================
    //
    // BUILD DIRETO SEM CASTS AMBÍGUOS.
    // hasAnyFilter acima lê (f as any).quickStatusList diretamente e dá true mesmo quando o quickSet
    // (antes construído por cast string[]|string) ficava size=0. Isso causava o bug "botão laranja mas
    // lista continuava igual" — pipeline não retornava cedo, filter body não entrava no quick pois
    // quickSet.size === 0, e todos os outros filtros estavam vazios → todo mundo passava.
    // Agora: 3 camadas de fallback + re-check dentro do filter body.
    const buildQuickSetFromSource = (src: unknown): Set<string> => {
      const out = new Set<string>();
      if (!src) return out;
      if (Array.isArray(src)) {
        for (const raw of src) {
          const k = String(raw ?? "").trim();
          if (k) out.add(k);
        }
        if (out.size > 0) return out;
      }
      if (typeof src === "string") {
        const k = src.trim();
        if (k) out.add(k);
      }
      return out;
    };
    // FONTE 0 DA VERDADE (URL): injeta diretamente no quickSet, independente de tudo.
    const quickSet = new Set<string>();
    if (hasQuickUrl) {
      for (const id of urlQuickIds) quickSet.add(id);
    }
    // FONTE 1: propriedade plana do objeto (mais seguro)
    const directArr = Array.isArray((f as any)?.quickStatusList) ? (f as any).quickStatusList as unknown[] : null;
    if (directArr && directArr.length) {
      for (const raw of directArr) {
        const k = String(raw ?? "").trim();
        if (k) quickSet.add(k);
      }
    }
    // FONTE 2: fallback por Object.getOwnPropertyDescriptor (caso spread perca a propriedade mas o objeto ainda a tenha — só segurança)
    if (quickSet.size === 0 && f && typeof f === "object") {
      try {
        const ownDesc = Object.prototype.hasOwnProperty.call(f, "quickStatusList");
        if (ownDesc) {
          const src2 = (f as Record<string, unknown>)["quickStatusList"];
          const tmp = buildQuickSetFromSource(src2);
          tmp.forEach((k) => quickSet.add(k));
        }
      } catch {}
    }
    // FONTE 3: fallback cast antigo (redundante, segurança)
    if (quickSet.size === 0) {
      try {
        const quickRaw = (f as any)?.quickStatusList as string[] | string | undefined;
        const tmp = buildQuickSetFromSource(quickRaw);
        tmp.forEach((k) => quickSet.add(k));
      } catch {}
    }
    // FONTE 4: ÚLTIMA GARANTIA — checa keys "quick__*" em Object.keys(f) e values (nunca se sabe — catch-all total)
    if (quickSet.size === 0 && f && typeof f === "object") {
      try {
        for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
          if (k.startsWith("quick")) {
            const tmp = buildQuickSetFromSource(v);
            tmp.forEach((x) => quickSet.add(x));
          }
        }
      } catch {}
    }

    const stageAndStatusNorm = (l: AtendimentoLeadListItem) => {
      const s1 = String(l.funnel_stage ?? "").trim().toLowerCase();
      const s2 = String((l as any)?.status ?? "").trim().toLowerCase();
      return [s1, s2];
    };
    const hasValidExperimentalBooking = (l: AtendimentoLeadListItem): boolean => {
      const fb = (l as any)?.future_experimental_class_booking as any;
      if (fb) {
        const s = String(fb?.status ?? "").trim().toLowerCase();
        if (s && s !== "cancelled") return true;
      }
      const booking =
        ((l as any)?.latest_experimental_class_booking as any) ??
        ((l as any)?.experimental_class_booking as any);
      if (!booking) return false;
      const bStatus = String(booking?.status ?? "").trim().toLowerCase();
      const attendance = String(booking?.attendance_status ?? "").trim().toLowerCase();
      const source = String(booking?.source ?? "draft").trim().toLowerCase();
      if (source === "draft" || !bStatus || bStatus === "draft") return false;
      if (bStatus === "cancelled" || attendance === "no_show") return false;
      if (["booked", "confirmed", "professor_confirmed", "lead_confirmed"].includes(bStatus)) return true;
      if (attendance === "attended") return true;
      return false;
    };
    const isMatriculado = (l: AtendimentoLeadListItem): boolean => {
      const [st, fs] = stageAndStatusNorm(l);
      const terminalStage = new Set([
        "matricula_confirmada",
        "matriculado",
        "aluno",
        "aluno_recorrente_cadastrado",
        "contrato_assinado",
      ]);
      const terminalStatusFlat = new Set([
        "matricula_confirmada",
        "matriculado",
        "aluno",
        "aluno_recorrente_cadastrado",
        "contrato_assinado",
      ]);
      const sRaw = String(l.status ?? "").trim().toLowerCase();
      const fsRaw = String(l.funnel_stage ?? "").trim().toLowerCase();
      if (
        terminalStage.has(fsRaw) ||
        terminalStatusFlat.has(sRaw) ||
        terminalStage.has(st) ||
        terminalStatusFlat.has(fs)
      ) {
        return true;
      }
      if (
        fsRaw.includes("aluno") ||
        fsRaw.includes("matriculado") ||
        fsRaw.includes("matricula_confirmada") ||
        fsRaw.includes("contrato_assinado") ||
        sRaw.includes("aluno") ||
        sRaw.includes("matriculado") ||
        sRaw.includes("matricula_confirmada") ||
        sRaw.includes("contrato_assinado") ||
        st.includes("aluno") ||
        st.includes("matriculado") ||
        fs.includes("aluno") ||
        fs.includes("matriculado")
      ) {
        return true;
      }

      if (
        Boolean((l as any)?.enrollment_number) ||
        Boolean((l as any)?.contract_signed_at) ||
        String((l as any)?.contract_status ?? "").trim() === "assinado" ||
        Boolean((l as any)?.contract_pdf_url)
      ) {
        return true;
      }
      const contractStatusNorm = String((l as any)?.contract_status ?? "").trim().toLowerCase();
      if (
        contractStatusNorm === "assinado" ||
        contractStatusNorm === "confirmado" ||
        contractStatusNorm === "ativo" ||
        contractStatusNorm.includes("assina") ||
        contractStatusNorm.includes("matricula") ||
        contractStatusNorm.includes("confirmad")
      ) {
        return true;
      }

      const rcs = String((l as any)?.recurring_class_status ?? "").trim().toLowerCase();
      const rw = String((l as any)?.recurring_class_weekday ?? "").trim();
      const rwl = String((l as any)?.recurring_class_weekday_label ?? "").trim();
      const rpt = String((l as any)?.recurring_class_professor_time ?? "").trim();
      const rlt = String((l as any)?.recurring_class_lead_time ?? "").trim();
      const rca = String((l as any)?.recurring_class_created_at ?? "").trim();
      const hasRecurringClass = Boolean(rcs || rw || rwl || rpt || rlt || rca);
      if (hasRecurringClass) return true;
      if (
        rcs === "ativo" ||
        rcs === "confirmado" ||
        rcs === "agendado" ||
        rcs.includes("ativ") ||
        rcs.includes("cadastrad") ||
        rcs.includes("aluno") ||
        rcs.includes("matriculad")
      ) {
        return true;
      }
      if (Number.isFinite(Number((l as any)?.recurring_registration_step))) {
        const step = Number((l as any)?.recurring_registration_step);
        if (step > 0) return true;
      }
      if (String((l as any)?.recurring_registration_step ?? "").trim()) {
        return true;
      }

      const rpn = String((l as any)?.recurring_class_professor_name ?? "").trim();
      const rpp = String((l as any)?.recurring_class_professor_phone ?? "").trim();
      const nrn = String((l as any)?.recurring_payment_next_date ?? (l as any)?.next_charge_date ?? (l as any)?.next_renewal_at ?? "").trim();
      const lrd = String((l as any)?.recurring_payment_last_date ?? (l as any)?.last_charge_date ?? "").trim();
      const hasRecurringPlataforma =
        Boolean(rpn || rpp) ||
        Boolean(nrn) ||
        Boolean(lrd) ||
        Boolean((l as any)?.alunos_entered_at);
      if (hasRecurringPlataforma) return true;

      const pStatus = String((l as any)?.payment_status ?? "").trim().toLowerCase();
      if (
        pStatus === "confirmado" ||
        pStatus === "pago" ||
        pStatus === "matriculado" ||
        pStatus === "assinado" ||
        pStatus === "ativo" ||
        pStatus.includes("confirmad") ||
        pStatus.includes("pag") ||
        pStatus.includes("matriculad") ||
        pStatus.includes("assina") ||
        pStatus.includes("ativ")
      ) {
        return true;
      }
      const planoRaw = String(
        (l as any)?.plano ??
          (l as any)?.recurring_plan ??
          (l as any)?.plano_aluno ??
          (l as any)?.selected_plan ??
          "",
      ).trim();
      if (planoRaw) return true;
      const turmaRaw = String(
        (l as any)?.turma ??
          (l as any)?.class_code ??
          (l as any)?.turma_aluno ??
          "",
      ).trim();
      if (turmaRaw) return true;

      return false;
    };
    const isMatriculaIncompleta = (l: AtendimentoLeadListItem): boolean => {
      const [st, fs] = stageAndStatusNorm(l);
      const incompletos = new Set([
        "pre_cadastro_concluido",
        "matricula_pendente",
        "matricula_pendente_recusada",
        "cadastro_recorrente_pendente_plataforma",
        "contrato_coletando_dados",
        "contrato_aguardando_aceite",
        "pagamento_pendente_confirmacao",
        "pagamento_nao_realizado",
      ]);
      if (incompletos.has(st) || incompletos.has(fs)) return true;
      const hasStartMarker =
        Boolean((l as any)?.contract_created_at) ||
        Boolean((l as any)?.proposta_aceita_em) ||
        Boolean((l as any)?.pre_cadastro_completed_at) ||
        Boolean((l as any)?.pagamento_pendente_valor);
      if (hasStartMarker && !isMatriculado(l)) return true;
      return false;
    };

    return leads.filter((l) => {
      // ===== GARANTIA DE ÚLTIMA INSTÂNCIA (ANTES DE CADA LEAD) =====
      // Se o build inicial do quickSet deu 0 mas a propriedade quickStatusList TEM CONTEÚDO
      // (bug do cast ambíguo → tem que já estar resolvido com as 4 fontes acima),
      // reconstruímos o quickSet AGORA antes de avaliar o lead.
      // Depois de tudo, se quickSet ainda for 0 MAS tem algo em quickStatusList →
      // CAI FORA (return false) p/ evitar cair no bug "todo mundo passa pq stageList/statusList vazios".
      const hasQuickDirect = (() => {
        try {
          const arr = Array.isArray((f as any).quickStatusList) ? (f as any).quickStatusList as unknown[] : null;
          if (arr && arr.length > 0) return true;
          const s = String((f as any).quickStatusList ?? "").trim();
          return Boolean(s);
        } catch {
          return false;
        }
      })();
      if (quickSet.size === 0 && hasQuickDirect) {
        try {
          const arr = Array.isArray((f as any).quickStatusList) ? (f as any).quickStatusList as unknown[] : null;
          if (arr && arr.length) {
            for (const raw of arr) {
              const k = String(raw ?? "").trim();
              if (k) quickSet.add(k);
            }
          } else {
            const s = String((f as any).quickStatusList ?? "").trim();
            if (s) quickSet.add(s);
          }
        } catch {}
      }
      const quickActive = quickSet.size > 0 || hasQuickDirect;
      if (quickActive) {
        let ok = false;
        const [st, fs] = stageAndStatusNorm(l);
        if (quickSet.has("quick__experimental_agendada") || (hasQuickDirect && String((f as any).quickStatusList ?? "").includes("quick__experimental_agendada"))) {
          const flatAgendada = st === "aula_experimental_agendada" || fs === "aula_experimental_agendada";
          if (hasValidExperimentalBooking(l) || flatAgendada) ok = true;
        }
        if (quickSet.has("quick__experimental_incompleta") || (hasQuickDirect && String((f as any).quickStatusList ?? "").includes("quick__experimental_incompleta"))) {
          const ehAgendada = (() => {
            const flatAgendada =
              st === "aula_experimental_agendada" || fs === "aula_experimental_agendada";
            return hasValidExperimentalBooking(l) || flatAgendada;
          })();
          const ehMatriculadoFinal = isMatriculado(l);
          const terminalFora = new Set(["encerrado", "repescagem"]);
          const isTerminalFora = terminalFora.has(st) || terminalFora.has(fs);

          const semNome = !String(l.full_name ?? "").trim();
          const semEstadoOuCidade =
            !String(l.state ?? "").trim() || !String(l.city ?? "").trim();
          const semDiaOuHorario = (() => {
            const temQualquerData = Boolean(
              String((l as any)?.experimental_class_lead_date ?? "").trim() ||
                String((l as any)?.experimental_class_professor_date ?? "").trim() ||
                String((l as any)?.experimental_class_lead_start_at ?? "").trim() ||
                String((l as any)?.experimental_class_professor_start_at ?? "").trim() ||
                String((l as any)?.latest_past_class_meta?.date ?? "").trim(),
            );
            const temQualquerHorario = Boolean(
              String((l as any)?.experimental_class_lead_time ?? "").trim() ||
                String((l as any)?.experimental_class_professor_time ?? "").trim() ||
                String((l as any)?.latest_past_class_meta?.time ?? "").trim(),
            );
            return !ehAgendada && (!temQualquerData || !temQualquerHorario);
          })();

          if (!isTerminalFora && !ehAgendada && !ehMatriculadoFinal) {
            ok = true;
          }
          if (
            !ok &&
            !isTerminalFora &&
            !ehAgendada &&
            !ehMatriculadoFinal &&
            (semNome || semEstadoOuCidade || semDiaOuHorario)
          ) {
            ok = true;
          }
        }
        if (quickSet.has("quick__matricula_incompleta") || (hasQuickDirect && String((f as any).quickStatusList ?? "").includes("quick__matricula_incompleta"))) {
          if (isMatriculaIncompleta(l) && !isMatriculado(l)) ok = true;
        }
        if (quickSet.has("quick__matriculado") || (hasQuickDirect && String((f as any).quickStatusList ?? "").includes("quick__matriculado"))) {
          if (isMatriculado(l)) ok = true;
        }
        if (!ok) return false;
      }
      if (f.statusList.length > 0 && !f.statusList.some((sid) => statusMatches(sid, l))) return false;
      if (f.stageList.length > 0 && !f.stageList.some((sid) => statusMatches(sid, l))) return false;
      if (f.countries.length > 0 && !f.countries.includes(String(l.country ?? "").trim())) return false;
      if (f.states.length > 0 && !f.states.includes(String(l.state ?? "").trim())) return false;
      if (f.onlyWithUnread && Number(l.unread_count ?? 0) <= 0) return false;
      if (f.onlyWithPhone && !String(l.phone ?? "").trim()) return false;
      if (f.onlyWithEmail && !String(l.email ?? "").trim()) return false;
      if (f.onlyWithScheduledClass) {
        const hasBooking = Boolean(
          l.future_experimental_class_booking ??
            l.latest_experimental_class_booking ??
            l.experimental_class_booking,
        );
        if (!hasBooking) return false;
      }
      if (f.onlyWithContract) {
        const hasContract = Boolean(l.contract_status ?? l.contract_signed_at ?? l.contract_pdf_url);
        if (!hasContract) return false;
      }
      // ===== bookingLeadIds (LISTA EXATA DE IDS do botão Ver do modal programação) =====
      // Maior prioridade: se veio conjunto explícito de ids (comma-separado),
      // SÓ retorna leads cujo id ESTÁ nesse conjunto. 100% match com o que aparece no card.
      // Elimina TODOS os falsos positivos/negativos do includesProf client-side.
      const leadIds = (f as any)?.bookingLeadIds as string[] | null | undefined;
      if (leadIds && leadIds.length > 0) {
        if (!leadIds.includes(String(l.id ?? "").trim())) return false;
        // ⚠️ IMPORTANTE: se bookingLeadIds está presente, PULA (não aplica) wantsBookingFilter abaixo.
        // A lista exata de ids do modal já é suficiente e correta. Apenas queremos manter
        // os outros filtros (status/stage/country etc — que não conflitam).
      } else {
        const wantsPeriodFilter = Boolean(f.createdFrom || f.createdTo);
        if (wantsPeriodFilter) {
          const aulaDates = extractAulaDatesOnly(l);
          const periodMatches = aulaDates.some((d) => dateInRange(d, f.createdFrom, f.createdTo));
          if (!periodMatches) return false;
        }
        const wantsBookingFilter = Boolean(
          f.bookingDateFrom ||
            f.bookingDateTo ||
            (f as any)?.bookingPhone ||
            (f as any)?.bookingPhoneDigits ||
            f.bookingProfessorName,
        );
        if (wantsBookingFilter) {
          const list = getAulaProfDateList(l, f.bookingDateFrom || null, f.bookingDateTo || null);
          if (list.length === 0) return false;
          const profFilter = {
            name: String(f.bookingProfessorName ?? "").trim(),
            phone: String((f as any)?.bookingPhone ?? "").trim(),
            phoneDigitsOnly: normPhone(String((f as any)?.bookingPhone ?? (f as any)?.bookingPhoneDigits ?? "")),
          };
          const needsProf = Boolean(profFilter.name || profFilter.phone || profFilter.phoneDigitsOnly);
          const match = list.some((row) => {
            const needsDate = Boolean(f.bookingDateFrom || f.bookingDateTo);
            if (needsDate && !dateInRange(row.date, f.bookingDateFrom, f.bookingDateTo)) return false;
            if (needsProf && !includesProf(row, profFilter)) return false;
            return true;
          });
          if (!match) return false;
        }
      }
      return true;
    });
  };

  // Contagem AO VIVO do rodapé do modal de filtros (baseado em DRAFT filters, NÃO os aplicados!)
  const liveFilteredCount = useMemo<number>(() => {
    return applyFiltersToLeads(panelLeads, draftFilters).length;
  }, [panelLeads, draftFilters]);

  const filteredLeads = useMemo<AtendimentoLeadListItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    // Força a injetar a leitura da URL DENTRO do objeto f também, além da leitura
    // interna do applyFiltersToLeads. Dupla garantia.
    const filtersWithQuickInjected: LeadFilters = { ...activeFilters };
    if (typeof window !== "undefined") {
      try {
        const qs = new URLSearchParams(window.location.search);
        const raw = qs.get("quickStatusList") ?? qs.get("quick") ?? qs.get("qs") ?? "";
        if (raw) {
          const parts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const ids: string[] = [];
          for (const p of parts) {
            if (!p) continue;
            if (p.startsWith("quick__")) ids.push(p);
            else ids.push(`quick__${p}`);
          }
          if (ids.length > 0) {
            (filtersWithQuickInjected as any).quickStatusList = Array.from(new Set([
              ...(Array.isArray((filtersWithQuickInjected as any).quickStatusList)
                ? ((filtersWithQuickInjected as any).quickStatusList as string[])
                : []),
              ...ids,
            ]));
          }
        }
      } catch {}
    }
    let out = applyFiltersToLeads(panelLeads, filtersWithQuickInjected);
    if (!q) return out;
    return out.filter((l) => leadMatchesSearchQuery(l, q));
  }, [panelLeads, searchQuery, activeFilters, quickUrlForceTick]);

  useEffect(() => {
    // PREVINE BUG: "excluí registro, voltou tela vazia" — se temos o lock
    // preventResetPageUntilRef (do handleDeleteSelected), NÃO resetamos
    // a página para 1 (pois handleDeleteSelected já setou safePageAfter
    // correta e queremos manter o nextId visível na tela).
    if (Date.now() < preventResetPageUntilRef.current) return;
    setLeadListPage(1);
  }, [searchQuery, activeFilters, panelLeads.length]);

  const totalLeads = filteredLeads.length;
  const totalPages = Math.max(1, Math.ceil(totalLeads / LIST_PAGE_SIZE));
  const safePage = Math.min(leadListPage, totalPages);
  const pagedStart = (safePage - 1) * LIST_PAGE_SIZE;
  const pagedEnd = pagedStart + LIST_PAGE_SIZE;
  const pagedFilteredLeads = filteredLeads.slice(pagedStart, pagedEnd);

  useEffect(() => {
    if (explicitSelectLockRef.current) {
      return;
    }
    if (Date.now() < suppressAutoSelectUntilRef.current) {
      return;
    }
    if (selectedLead && filteredLeads.findIndex((l) => l.id === selectedLead.id) === -1 && panelLeads.findIndex((l) => l.id === selectedLead.id) >= 0) {
      return;
    }
  }, [filteredLeads, selectedLead, panelLeads]);

  useEffect(() => {
    if (selectedLead) {
      setObservacoesDraft(String((selectedLead as any).internal_notes ?? "").trim());
      setActiveTab("visao_geral");
      requestAnimationFrame(() => {
        const desk = tabsScrollDesktopRef.current;
        const mob = tabsScrollMobileRef.current;
        if (desk) {
          desk.scrollLeft = 0;
          updateTabsArrowsState(desk, setDesktopTabsCanLeft, setDesktopTabsCanRight);
        }
        if (mob) {
          mob.scrollLeft = 0;
          updateTabsArrowsState(mob, setMobileTabsCanLeft, setMobileTabsCanRight);
        }
      });
    }
  }, [selectedLead?.id]);

  function updateTabsArrowsState(
    el: HTMLDivElement,
    setLeft: (v: boolean) => void,
    setRight: (v: boolean) => void,
  ) {
    const canLeft = el.scrollLeft > 2;
    const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setLeft(canLeft);
    setRight(canRight);
  }

  function scrollTabsBy(
    el: HTMLDivElement | null,
    direction: -1 | 1,
    setLeft: (v: boolean) => void,
    setRight: (v: boolean) => void,
  ) {
    if (!el) return;
    const step = Math.max(Math.round(el.clientWidth * 0.7), 160);
    el.scrollBy({ left: direction * step, behavior: "smooth" });
    window.setTimeout(() => updateTabsArrowsState(el, setLeft, setRight), 280);
  }

  function handleForbiddenResponse(res: Response) {
    if (res.status !== 401 && res.status !== 403) return false;
    window.location.replace("/login");
    return true;
  }

  const loadSummary = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    const delays = [0, 350, 900];
    let lastErrorMessage: string | null = null;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]) {
        await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
      }

      let res: Response;
      try {
        res = await fetch("/api/atendimento/resumo", { cache: "no-store" });
      } catch (error) {
        lastErrorMessage = "Falha ao carregar resumo.";
        continue;
      }

      if (handleForbiddenResponse(res)) return;

      const json = await res.json().catch(() => null);
      if (json?.ok) {
        setSummary(json.summary as AtendimentoSummary);
        if (!silent) setLoadError(null);
        return;
      }
      lastErrorMessage = String(json?.error ?? "Falha ao carregar resumo.");
    }

    if (silent) return;
    const message = String(lastErrorMessage ?? "Falha ao carregar resumo.");
    setLoadError(message);
    modalToast.error(message);
  }, []);

  const loadPanelLeads = useCallback(async () => {
    const res = await fetch("/api/atendimento/leads", { cache: "no-store" });
    if (handleForbiddenResponse(res)) return;
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      setPanelLeads((json.leads ?? []) as AtendimentoLeadListItem[]);
    }
  }, []);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([loadSummary({ silent: true }), loadPanelLeads(), loadBotExperimentalSetting()]);
      modalToast.success("Painel atualizado.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCopyPhone(lead: AtendimentoLeadListItem) {
    const raw = String(lead.phone ?? "").replace(/\D/g, "").trim();
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw);
      modalToast.success("Telefone copiado.");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = raw;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        modalToast.success("Telefone copiado.");
      } catch {
        modalToast.error("Falha ao copiar.");
      }
    }
  }

  async function loadBotExperimentalSetting() {
    try {
      const res = await fetch("/api/atendimento/settings/experimental-class-bot", { cache: "no-store" });
      if (handleForbiddenResponse(res)) return;
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        setBotExperimentalDisabled(Boolean((json as any).experimental_class_bot_disabled));
      }
    } catch {
      /* noop */
    }
  }

  async function handleToggleBotExperimental() {
    if (botExperimentalLoading) return;
    const nextDisabled = !botExperimentalDisabled;
    setBotExperimentalLoading(true);
    try {
      setBotExperimentalDisabled(nextDisabled);
      const res = await fetch("/api/atendimento/settings/experimental-class-bot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experimental_class_bot_disabled: nextDisabled }),
      });
      if (handleForbiddenResponse(res)) return;
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setBotExperimentalDisabled(!nextDisabled);
        modalToast.error(String(json?.error ?? "Falha ao alternar bot."));
        return;
      }
      setBotExperimentalDisabled(Boolean((json as any).experimental_class_bot_disabled));
      modalToast.success(
        nextDisabled ? "Bot desativado." : "Bot ativado.",
      );
    } catch (e: any) {
      setBotExperimentalDisabled(!nextDisabled);
      modalToast.error(String(e?.message ?? "Falha ao alternar bot."));
    } finally {
      setBotExperimentalLoading(false);
    }
  }

  async function handleCopyMatriculaLink(lead: AtendimentoLeadListItem) {
    const url = buildRecurringClassUrl(lead);
    try {
      await navigator.clipboard.writeText(url);
      modalToast.success("Link de matrícula copiado.");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        modalToast.success("Link de matrícula copiado.");
      } catch {
        modalToast.error("Falha ao copiar.");
      }
    }
  }

  function handleOpenMatriculaLink(lead: AtendimentoLeadListItem) {
    try {
      window.open(buildRecurringClassUrl(lead), "_blank", "noopener,noreferrer");
    } catch {}
  }

  async function handleSaveObservacoes() {
    if (!selectedLead || observacoesSaving) return;
    setObservacoesSaving(true);
    try {
      const res = await fetch(`/api/atendimento/leads/${selectedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internal_notes: observacoesDraft }),
      });
      if (handleForbiddenResponse(res)) return;
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Falha ao salvar observações.");
      modalToast.success("Observações salvas.");
      await loadPanelLeads();
    } catch (e) {
      modalToast.error(e instanceof Error ? e.message : "Falha ao salvar observações.");
    } finally {
      setObservacoesSaving(false);
    }
  }

  const [deletingSelectedLoading, setDeletingSelectedLoading] = useState(false);

  function handleOpenEditSelected() {
    if (!selectedLead) return;
    setEditLeadName(String(selectedLead.full_name ?? "").trim());
    setEditLeadPhone(applyPhoneMask(String(selectedLead.phone ?? "").trim()));
    setEditLeadCity(String((selectedLead as any).city ?? "").trim());
    setEditLeadState(String((selectedLead as any).state ?? "").trim());
    setEditLeadCountry(String((selectedLead as any).country ?? "").trim());
    setEditLeadTimezone(deriveLeadEffectiveTimeZone(selectedLead));
    setEditLeadOpen(true);
  }

  async function handleSaveEditSelected() {
    if (!selectedLead || editLeadSaving) return;
    const phoneDigits = String(editLeadPhone ?? "").replace(/\D/g, "");
    if (!phoneDigits) {
      modalToast.error("Telefone é obrigatório.");
      return;
    }
    try {
      setEditLeadSaving(true);
      const response = await fetch(`/api/atendimento/leads/${selectedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: String(editLeadName ?? "").trim() || null,
          phone: phoneDigits,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; lead?: AtendimentoLeadListItem; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao atualizar registro.");
        return;
      }
      if (payload.lead) {
        setPanelLeads((current) => current.map((item) => (item.id === selectedLead.id ? { ...item, ...payload.lead } : item)));
        if (selectedLead?.id === payload.lead.id) {
          setSelectedLeadId((prev) => prev);
        }
      }
      setEditLeadOpen(false);
      modalToast.success("Registro atualizado com sucesso.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao atualizar registro.");
    } finally {
      setEditLeadSaving(false);
    }
  }

  function handleOpenEditLocationSelected() {
    if (!selectedLead) return;
    setEditLocationCity(String((selectedLead as any).city ?? "").trim());
    setEditLocationState(String((selectedLead as any).state ?? "").trim());
    setEditLocationOpen(true);
  }

  async function handleSaveEditLocationSelected() {
    if (!selectedLead || editLocationSaving) return;
    try {
      setEditLocationSaving(true);
      const response = await fetch(`/api/atendimento/leads/${selectedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: String(editLocationCity ?? "").trim() || null,
          state: String(editLocationState ?? "").trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; lead?: AtendimentoLeadListItem; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao atualizar localização.");
        return;
      }
      if (payload.lead) {
        setPanelLeads((current) => current.map((item) => (item.id === selectedLead.id ? { ...item, ...payload.lead } : item)));
      }
      setEditLocationOpen(false);
      modalToast.success("Localização atualizada com sucesso.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao atualizar localização.");
    } finally {
      setEditLocationSaving(false);
    }
  }

  function handleOpenExperimentalBooking(lead: AtendimentoLeadListItem) {
    const fullNameRaw = String(lead?.full_name ?? "").trim();
    if (!fullNameRaw) {
      modalToast.error("Cadastre o nome do aluno antes de agendar uma aula.");
      return;
    }
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
            String(json.lead_timezone ?? deriveLeadEffectiveTimeZone(lead) ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() ||
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

  function handleCloseExperimentalBooking() {
    setIsEditExperimentalOpen(false);
    setEditingExperimentalLead(null);
    setExperimentalAvailability(null);
    setSelectedExperimentalDateId(null);
    setSelectedExperimentalSlotId(null);
  }

  function handleOpenExpInfo(lead: AtendimentoLeadListItem | null) {
    if (!lead) return;
    setExpInfoLead(lead);
    setIsExpInfoOpen(true);
  }

  function handleCloseExpInfo() {
    setIsExpInfoOpen(false);
    setExpInfoLead(null);
  }

  function handleOpenEditSenha() {
    if (!selectedLead) return;
    setEditSenhaValue(String((selectedLead as any).recurring_registration_password ?? "").trim());
    setIsEditSenhaOpen(true);
  }

  function handleCloseEditSenha() {
    if (editSenhaSaving) return;
    setIsEditSenhaOpen(false);
    setEditSenhaValue("");
  }

  async function handleSaveEditSenha() {
    if (!selectedLead || editSenhaSaving) return;
    const raw = String(editSenhaValue ?? "").trim();
    if (raw.length < 4) {
      modalToast.error("Senha inválida. Digite pelo menos 4 caracteres.");
      return;
    }
    try {
      setEditSenhaSaving(true);
      const response = await fetch(`/api/atendimento/leads/${selectedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recurring_registration_password: raw,
          signup_password_raw_temp: raw,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; lead?: AtendimentoLeadListItem; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao atualizar senha.");
        return;
      }
      if (payload.lead) {
        setPanelLeads((current) => current.map((item) => (item.id === selectedLead.id ? { ...item, ...payload.lead } : item)));
      }
      setIsEditSenhaOpen(false);
      setEditSenhaValue("");
      modalToast.success("Senha atualizada com sucesso.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao atualizar senha.");
    } finally {
      setEditSenhaSaving(false);
    }
  }

  async function handleSaveExperimentalBooking() {
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
        String(experimentalAvailability?.lead_timezone ?? deriveLeadEffectiveTimeZone(editingExperimentalLead) ?? ATENDIMENTO_PROFESSOR_TIME_ZONE).trim() ||
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

      setPanelLeads((current) =>
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
          setPanelLeads((current) =>
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
                "experimental_class_booking_id",
                "experimental_class_link",
                "experimental_class_professor_name",
                "experimental_class_professor_phone",
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
                !merged.latest_experimental_class_booking &&
                prior.latest_experimental_class_booking
              ) {
                merged.latest_experimental_class_booking = prior.latest_experimental_class_booking;
              }
              if (
                !merged.latest_past_class_meta &&
                prior.latest_past_class_meta
              ) {
                merged.latest_past_class_meta = prior.latest_past_class_meta;
              }
              if (
                !merged.latest_experimental_class_cancelled_at &&
                prior.latest_experimental_class_cancelled_at
              ) {
                merged.latest_experimental_class_cancelled_at = prior.latest_experimental_class_cancelled_at;
              }
              if (
                !merged.latest_experimental_class_event &&
                prior.latest_experimental_class_event
              ) {
                merged.latest_experimental_class_event = prior.latest_experimental_class_event;
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

      modalToast.success("Aula agendada.");
      handleCloseExperimentalBooking();
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao salvar a aula experimental.");
    } finally {
      setSavingExperimentalLeadId(null);
    }
  }

  function renderColorLegendModal() {
    const items: Array<{
      cor: string;
      titulo: string;
      descricao: string;
      ring?: string;
    }> = [
      {
        cor: "bg-[#ea580c]",
        titulo: "Laranja",
        descricao:
          "Cadastro incompleto em processo de agendamento para aula experimental.",
        ring: "ring-[3px] ring-[#c2410c]",
      },
      {
        cor: "bg-[#eab308]",
        titulo: "Amarelo",
        descricao:
          "Aula experimental agendada, mas falta selecionar o professor e adicionar o link da aula.",
        ring: "ring-[3px] ring-[#ca8a04]",
      },
      {
        cor: "bg-[#16a34a]",
        titulo: "Verde",
        descricao:
          "Sistema pronto para fazer o disparo agendado ou manual do link da aula e, após a aula, enviar o link da matrícula.",
        ring: "ring-[3px] ring-[#15803d]",
      },
      {
        cor: "bg-[#2563eb]",
        titulo: "Azul",
        descricao:
          "Aluno em processo de cadastro de matrícula até finalmente se tornar aluno da plataforma.",
        ring: "ring-[3px] ring-[#1d4ed8]",
      },
    ];
    return (
      <AppModal
        open={showColorLegendModal}
        onClose={() => setShowColorLegendModal(false)}
        size="md"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
        closeOnBackdrop
        closeOnEscape
      >
        <div className="flex w-full flex-col gap-0">
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.12)]">
                <Palette className="h-5 w-5 text-[#1d4ed8]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Legenda das cores
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Entenda o que significa a cor do avatar de cada registro.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowColorLegendModal(false)}
              aria-label="Fechar"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            {items.map((it) => (
              <div
                key={it.titulo}
                className="flex w-full items-start gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3"
              >
                <div
                  className={[
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold !text-white transition-none shadow-[0_2px_6px_rgba(15,23,42,0.18)]",
                    it.cor,
                    it.ring ?? "",
                  ].join(" ")}
                >
                  {it.titulo.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold leading-tight text-[var(--app-text-85)]">
                    {it.titulo}
                  </div>
                  <div className="mt-1 text-[13px] leading-snug text-[var(--app-text-60)]">
                    {it.descricao}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </AppModal>
    );
  }

  function renderEditLocationModal() {
    return (
      <AppModal
        open={editLocationOpen}
        onClose={() => {
          setEditLocationOpen(false);
        }}
        size="md"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
        closeOnBackdrop={!editLocationSaving}
        closeOnEscape={!editLocationSaving}
      >
        <form className="flex w-full flex-col gap-0" onSubmit={(e) => { e.preventDefault(); void handleSaveEditLocationSelected(); }}>
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <MapPin className="h-5 w-5 text-[#9a3412]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Editar localização
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  País e fuso horário são preenchidos automaticamente.
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={editLocationSaving}
              onClick={() => {
                setEditLocationOpen(false);
              }}
              aria-label="Fechar"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--app-text-60)]">Estado</label>
              <input
                type="text"
                autoFocus
                value={editLocationState}
                onChange={(e) => setEditLocationState(e.target.value)}
                placeholder="Ex: MT, SP, FL, CA, Nova York"
                disabled={editLocationSaving}
                className="mt-1.5 w-full !bg-white rounded-xl border border-[var(--app-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--app-text-60)]">Cidade</label>
              <input
                type="text"
                value={editLocationCity}
                onChange={(e) => setEditLocationCity(e.target.value)}
                placeholder="Ex: Cuiabá, Orlando, Lisboa"
                disabled={editLocationSaving}
                className="mt-1.5 w-full !bg-white rounded-xl border border-[var(--app-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          <div className="mt-5 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setEditLocationOpen(false);
              }}
              disabled={editLocationSaving}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={editLocationSaving}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold !text-white shadow-none hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editLocationSaving ? "Salvando…" : "Salvar localização"}
            </button>
          </div>
        </form>
      </AppModal>
    );
  }

  async function handleDeleteSelected() {
    if (!selectedLead || deletingSelectedLoading) return;
    const sl = selectedLead;
    const name = String(sl.full_name ?? "").trim() || "Registro sem nome";
    const phone = String(sl.phone ?? "").trim() || "Sem telefone";
    if (!window.confirm(`Excluir Registro?\n\n${name}\n${phone}\n\nEsta ação é permanente.`)) {
      return;
    }

    // ================ REGRA DE SELEÇÃO APÓS EXCLUIR ================
    // User pediu: "Quando excluir um registro deve ir para o registro
    // de baixo! e não voltar mais para: Selecione um registro".
    //
    // Estratégia:
    //   [1] Calcula a LISTA VISÍVEL ATUAL (filtered + página atual)
    //       ANTES da exclusão → é a que o usuário VÊ na tela (pagedFilteredLeads).
    //   [2] Acha o índice do selecionado NESSA lista visível.
    //   [3] Após remover, a "lista visível nova" terá o item de BAIXO
    //       do excluído exatamente no MESMO ÍNDICE.
    //   [4] Se era o ÚLTIMO item da página → pega o novo último da página
    //       (que passa a ser o anterior do excluído, se a página não
    //       reduziu; ou reduz página para safePage-1 se safePage>1).
    //   [5] Se ficou vazio (0) → null.
    const q = searchQuery.trim().toLowerCase();
    const filtersWithQuickInjectedPre: LeadFilters = { ...activeFilters };
    if (typeof window !== "undefined") {
      try {
        const qsPre = new URLSearchParams(window.location.search);
        const raw = qsPre.get("quickStatusList") ?? qsPre.get("quick") ?? qsPre.get("qs") ?? "";
        if (raw) {
          const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
          const ids: string[] = [];
          for (const p of parts) {
            if (!p) continue;
            if (p.startsWith("quick__")) ids.push(p);
            else ids.push(`quick__${p}`);
          }
          if (ids.length > 0) {
            (filtersWithQuickInjectedPre as any).quickStatusList = Array.from(new Set([
              ...(Array.isArray((filtersWithQuickInjectedPre as any).quickStatusList)
                ? ((filtersWithQuickInjectedPre as any).quickStatusList as string[])
                : []),
              ...ids,
            ]));
          }
        }
      } catch {}
    }
    let filteredBefore = applyFiltersToLeads(panelLeads, filtersWithQuickInjectedPre);
    if (q) filteredBefore = filteredBefore.filter((l) => leadMatchesSearchQuery(l, q));

    // Página antes (usa safePage para compatibilidade com a página que o usuário vê):
    const totalBefore = filteredBefore.length;
    const totalPagesBefore = Math.max(1, Math.ceil(totalBefore / LIST_PAGE_SIZE));
    const safePageBefore = Math.min(safePage, totalPagesBefore);
    const pagedStartBefore = (safePageBefore - 1) * LIST_PAGE_SIZE;
    const pagedEndBefore = pagedStartBefore + LIST_PAGE_SIZE;
    const visibleListBefore = filteredBefore.slice(pagedStartBefore, pagedEndBefore);

    // Índice do selecionado NA LISTA VISÍVEL (0-based):
    const idxInVisible = visibleListBefore.findIndex((l) => l.id === sl.id);

    try {
      setDeletingSelectedLoading(true);
      const response = await fetch(`/api/atendimento/leads/${sl.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        modalToast.error(payload?.error ?? "Falha ao excluir registro.");
        return;
      }
      suppressAutoSelectUntilRef.current = Date.now() + 10000;
      explicitSelectLockRef.current = true;

      // ========== PASSO 1: remove de panelLeads (igual antes) ==========
      const panelLeadsAfter = panelLeads.filter((item) => item.id !== sl.id);
      setPanelLeads(panelLeadsAfter);
      setSummary((current) => ({ ...current, totalLeads: Math.max(0, (current.totalLeads ?? 0) - 1) }));

      // ========== PASSO 2: calcula "lista visível DEPOIS" ==========
      // Aplica os MESMOS filtros + search no panelLeadsAfter:
      const filtersWithQuickInjectedPost: LeadFilters = { ...activeFilters };
      if (typeof window !== "undefined") {
        try {
          const qsPost = new URLSearchParams(window.location.search);
          const raw = qsPost.get("quickStatusList") ?? qsPost.get("quick") ?? qsPost.get("qs") ?? "";
          if (raw) {
            const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
            const ids: string[] = [];
            for (const p of parts) {
              if (!p) continue;
              if (p.startsWith("quick__")) ids.push(p);
              else ids.push(`quick__${p}`);
            }
            if (ids.length > 0) {
              (filtersWithQuickInjectedPost as any).quickStatusList = Array.from(new Set([
                ...(Array.isArray((filtersWithQuickInjectedPost as any).quickStatusList)
                  ? ((filtersWithQuickInjectedPost as any).quickStatusList as string[])
                  : []),
                ...ids,
              ]));
            }
          }
        } catch {}
      }
      let filteredAfter = applyFiltersToLeads(panelLeadsAfter, filtersWithQuickInjectedPost);
      if (q) filteredAfter = filteredAfter.filter((l) => leadMatchesSearchQuery(l, q));

      const totalAfter = filteredAfter.length;
      const totalPagesAfter = Math.max(1, Math.ceil(totalAfter / LIST_PAGE_SIZE));

      // Página depois: tenta manter safePageBefore; se a página foi apagada
      // (o totalPages reduziu e safePageBefore > totalPagesAfter), cai para
      // a nova última página.
      const safePageAfter = Math.min(safePageBefore, totalPagesAfter);
      const pagedStartAfter = (safePageAfter - 1) * LIST_PAGE_SIZE;
      const pagedEndAfter = pagedStartAfter + LIST_PAGE_SIZE;
      const visibleListAfter = filteredAfter.slice(pagedStartAfter, pagedEndAfter);

      // ========== PASSO 3: escolhe próximo selecionado ==========
      let nextId: string | null = null;
      if (visibleListAfter.length > 0 && idxInVisible >= 0) {
        // 3a) Tem item no MESMO índice (excluído não era o último da página)?
        if (idxInVisible < visibleListAfter.length) {
          nextId = visibleListAfter[idxInVisible].id;
        }
        // 3b) Senão, excluído era o último item da lista visível → pega NOVO ÚLTIMO
        //     (que é o item de CIMA, porque o último foi apagado):
        else {
          nextId = visibleListAfter[visibleListAfter.length - 1].id;
        }
      } else if (filteredAfter.length > 0) {
        // Fallback (raro): idxInVisible não encontrado mas tem gente → primeiro da página.
        nextId = visibleListAfter[0]?.id ?? filteredAfter[0].id ?? null;
      }
      // Garantia FINAL: nextId só é válido se EXISTIR em filteredAfter.
      // Se por algum motivo o visibleListAfter não contiver o nextId (ex: página
      // mudou, filtro mudou no meio tempo), pega o primeiro de filteredAfter.
      if (nextId != null && !filteredAfter.some((l) => l.id === nextId)) {
        nextId = filteredAfter[0]?.id ?? null;
      }

      // ========== PASSO 4: aplica seleção + TRAVA contra reset de página ==========
      // (ROOT CAUSE ACHADO: o useEffect L2008 roda ao panelLeads.length mudar
      //  e seta leadListPage = 1. Isso apaga o nextId que estava na página 2+
      //  e a tela volta para "Selecione um registro". Solução: TRAVAR o
      //  preventResetPageUntilRef por ~50ms + SEMPRE setar safePageAfter MANUAL
      //  logo antes de setSelectedLeadId.)
      preventResetPageUntilRef.current = Date.now() + 80;

      // Garante que a página atual é a safePageAfter SEMPRE (mesmo que igual):
      setLeadListPage(safePageAfter);

      if (nextId != null) {
        // Aplica o setState VÁRIAS vezes em micro/novos eventos para
        // sobreviver ao React StrictMode batching (que às vezes perde o
        // primeiro setState em flows com await + múltiplos setters).
        // Ordem: rAF (antes do paint) → setTimeout 0 → setTimeout 50ms.
        setSelectedLeadId(nextId);
        requestAnimationFrame(() => setSelectedLeadId(nextId));
        setTimeout(() => setSelectedLeadId(nextId), 0);
        setTimeout(() => {
          setSelectedLeadId(nextId);
          // Libera o lock de seleção explícita DEPOIS dos setters, para
          // garantir que nenhum useEffect "consertou" de volta para null.
          explicitSelectLockRef.current = false;
        }, 60);
        setTimeout(() => {
          preventResetPageUntilRef.current = 0;
        }, 200);
      } else {
        // 0 registros restantes → AQUI SIM pode ir para null (era o único registro do user).
        setSelectedLeadId(null);
        setTimeout(() => {
          explicitSelectLockRef.current = false;
          preventResetPageUntilRef.current = 0;
        }, 60);
      }

      setShowMobileLeadModal(false);
      modalToast.success("Registro excluído com sucesso.");
    } catch (error) {
      modalToast.error(error instanceof Error ? error.message : "Falha ao excluir registro.");
    } finally {
      setDeletingSelectedLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSummary(), loadPanelLeads(), loadBotExperimentalSetting()])
      .then(() => {
        setLoadError(null);
        initialLoadCompletedRef.current = true;
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadPanelLeads, loadSummary]);

  useEffect(() => {
    if (fallbackRefreshIntervalRef.current != null) return;
    fallbackRefreshIntervalRef.current = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadSummary({ silent: true });
      void loadPanelLeads();
    }, 15000);

    return () => {
      if (fallbackRefreshIntervalRef.current != null) {
        window.clearInterval(fallbackRefreshIntervalRef.current);
        fallbackRefreshIntervalRef.current = null;
      }
    };
  }, [loadPanelLeads, loadSummary]);

  useEffect(() => {
    const channel = supabase
      .channel("atendimento-private-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimento_leads" }, () => {
        void loadSummary({ silent: true });
        void loadPanelLeads();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atendimento_conversations" },
        () => {
          void loadSummary({ silent: true });
          void loadPanelLeads();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atendimento_messages" },
        () => {
          void loadSummary({ silent: true });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atendimento_experimental_class_bookings" },
        () => {
          void loadSummary({ silent: true });
          void loadPanelLeads();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeSubscribedRef.current = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeSubscribedRef.current = false;
          void loadSummary({ silent: true });
          void loadPanelLeads();
        }
      });

    return () => {
      realtimeSubscribedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [loadPanelLeads, loadSummary, supabase]);

  useEffect(() => {
    const onRefetchRequest = () => {
      void loadSummary({ silent: true });
      void loadPanelLeads();
    };
    window.addEventListener("autobot:atendimento-refetch", onRefetchRequest as EventListener);
    return () => window.removeEventListener("autobot:atendimento-refetch", onRefetchRequest as EventListener);
  }, [loadPanelLeads, loadSummary]);

  function renderCreateLeadModal() {
    function resetForm() {
      setCreateLeadPhone("");
      setCreateLeadName("");
      setCreateLeadSaving(false);
    }
    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault();
      if (createLeadSaving) return;
      const phone = String(createLeadPhone ?? "").replace(/\D/g, "").trim();
      if (!phone) {
        modalToast.error("Informe o telefone do registro.");
        return;
      }
      setCreateLeadSaving(true);
      try {
        const res = await fetch("/api/atendimento/leads/criar-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            full_name: String(createLeadName ?? "").trim() || null,
          }),
        });
        if (handleForbiddenResponse(res)) return;
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          const msg = json?.error ?? "Não foi possível cadastrar.";
          if (res.status === 409) {
            modalToast.error(msg);
          } else {
            modalToast.error(msg);
          }
          return;
        }
        modalToast.success("Registro cadastrado com sucesso.");
        setCreateLeadOpen(false);
        resetForm();
        await Promise.all([loadSummary({ silent: true }), loadPanelLeads()]);
        if (json?.lead?.id) {
          setSelectedLeadId(String(json.lead.id));
          if (isMobileViewport) setShowMobileLeadModal(true);
        }
      } catch (e) {
        modalToast.error(e instanceof Error ? e.message : "Falha ao cadastrar.");
      } finally {
        setCreateLeadSaving(false);
      }
    }

    return (
      <AppModal
        open={createLeadOpen}
        onClose={() => {
          setCreateLeadOpen(false);
          resetForm();
        }}
        size="md"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
        closeOnBackdrop={!createLeadSaving}
        closeOnEscape={!createLeadSaving}
      >
        <form className="flex w-full flex-col gap-0" onSubmit={handleSubmit}>
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <Plus className="h-5 w-5 text-[#9a3412]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Novo registro
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Cadastre um número para iniciar o atendimento.
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={createLeadSaving}
              onClick={() => {
                setCreateLeadOpen(false);
                resetForm();
              }}
              aria-label="Fechar"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--app-text-60)]">
                Telefone <span className="text-[#ea580c]">*</span>
              </label>
              <input
                type="tel"
                autoFocus
                required
                value={createLeadPhone}
                onChange={(e) => setCreateLeadPhone(applyPhoneMask(e.target.value))}
                placeholder="+99 (99) 9 9999-9999"
                disabled={createLeadSaving}
                className="mt-1.5 w-full !bg-white rounded-xl border border-[var(--app-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="mt-1.5 text-[11px] text-[var(--app-text-50)]">
                Preencha ou cole o número. Formata automático: +55 (65) 9 9693-3336 / +1 (415) 555-9876
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--app-text-60)]">Nome</label>
              <input
                type="text"
                value={createLeadName}
                onChange={(e) => setCreateLeadName(e.target.value)}
                placeholder="Nome completo (opcional)"
                disabled={createLeadSaving}
                className="mt-1.5 w-full !bg-white rounded-xl border border-[var(--app-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          <div className="mt-5 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setCreateLeadOpen(false);
                resetForm();
              }}
              disabled={createLeadSaving}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createLeadSaving || !String(createLeadPhone ?? "").replace(/\D/g, "").trim()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold !text-white shadow-none hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createLeadSaving ? "Cadastrando…" : "Cadastrar registro"}
            </button>
          </div>
        </form>
      </AppModal>
    );
  }

  function renderEditLeadModal() {
    return (
      <AppModal
        open={editLeadOpen}
        onClose={() => {
          setEditLeadOpen(false);
        }}
        size="md"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
        closeOnBackdrop={!editLeadSaving}
        closeOnEscape={!editLeadSaving}
      >
        <form className="flex w-full flex-col gap-0" onSubmit={(e) => { e.preventDefault(); void handleSaveEditSelected(); }}>
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <Pencil className="h-5 w-5 text-[#9a3412]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Editar registro
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Atualize os dados do registro selecionado.
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={editLeadSaving}
              onClick={() => {
                setEditLeadOpen(false);
              }}
              aria-label="Fechar"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--app-text-60)]">
                  Telefone <span className="text-[#ea580c]">*</span>
                </label>
                <input
                  type="tel"
                  autoFocus
                  required
                  value={editLeadPhone}
                  onChange={(e) => setEditLeadPhone(applyPhoneMask(e.target.value))}
                  placeholder="+99 (99) 9 9999-9999"
                  disabled={editLeadSaving}
                  className="mt-1.5 w-full !bg-white rounded-xl border border-[var(--app-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--app-text-60)]">Nome</label>
                <input
                  type="text"
                  value={editLeadName}
                  onChange={(e) => setEditLeadName(e.target.value)}
                  placeholder="Nome completo (opcional)"
                  disabled={editLeadSaving}
                  className="mt-1.5 w-full !bg-white rounded-xl border border-[var(--app-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setEditLeadOpen(false);
              }}
              disabled={editLeadSaving}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={editLeadSaving || !String(editLeadPhone ?? "").replace(/\D/g, "").trim()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold !text-white shadow-none hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editLeadSaving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </form>
      </AppModal>
    );
  }

  function renderMetricsModal() {
    const items: Array<{ label: string; value: number; icon: React.ReactNode; tone: "default" | "success" | "warning" | "info" | "danger" }> = [
      { label: "Total de registros", value: summary.totalLeads, icon: <UserRound className="h-5 w-5" />, tone: "default" },
      { label: "Aulas experimentais agendadas", value: summary.aulasExperimentaisAgendadas, icon: <CalendarIcon className="h-5 w-5" />, tone: "success" },
      { label: "Alunos", value: summary.matriculados, icon: <ExternalLink className="h-5 w-5" />, tone: "success" },
    ];
    return (
      <AppModal
        open={showMetricsModal}
        onClose={() => setShowMetricsModal(false)}
        size="xl"
        position="center"
        zIndexClass="z-[400]"
      >
        <div className="flex w-full flex-col gap-0">
          {/* Header modal */}
          <div className="flex shrink-0 items-center justify-between gap-3 pb-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <BarChart3 className="h-5 w-5 text-[#9a3412]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Métricas e resumo
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Visão geral dos registros e do funil.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowMetricsModal(false)}
              aria-label="Fechar métricas"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Cards métricas */}
          <div className="mt-4 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => {
              const toneClasses =
                "border-[var(--app-border)] bg-[var(--app-solid-surface-2)]";
              const iconTone =
                "text-[var(--app-text-70)]";
              return (
                <div
                  key={it.label}
                  className={`flex items-start justify-between gap-3 overflow-hidden rounded-2xl border p-4 shadow-none ${toneClasses}`}
                >
                  <div className="min-w-0">
                    <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${iconTone}`}>
                      {it.label}
                    </div>
                    <div className="mt-1 text-[22px] font-semibold leading-tight text-[var(--app-text-85)]">
                      {it.value.toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--app-solid-surface)] border border-[var(--app-border)] ${iconTone}`}>
                    {it.icon}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AppModal>
    );
  }

  function renderFiltersModal() {
    // ==================== NOVO SISTEMA DE STATUS (RECRIADO DO ZERO) ====================
    // 4 opções sintéticas, divididas em 2 grupos visuais.
    //
    // GRUPO 1 — Aulas Experimentais:
    //   (1) Aulas Experimentais Agendadas
    //   (2) Aulas Experimentais Incompletas
    //
    // GRUPO 2 — Matrícula:
    //   (3) Matrículas Incompletas
    //   (4) Matriculados
    //
    // RADIO: só uma opção selecionada por vez (exclusivo).
    // Nenhum reuso do stageOptions/statusOptions antigo.
    // ==================================================================================
    const STATUS_QUICK_OPTIONS: Array<{
      id: string;
      label: string;
      group: "Aulas Experimentais" | "Matrícula";
    }> = [
      { id: "quick__experimental_agendada", label: "Aulas Experimentais Agendadas", group: "Aulas Experimentais" },
      { id: "quick__experimental_incompleta", label: "Aulas Experimentais Incompletas", group: "Aulas Experimentais" },
      { id: "quick__matricula_incompleta", label: "Matrículas Incompletas", group: "Matrícula" },
      { id: "quick__matriculado", label: "Matriculados", group: "Matrícula" },
    ];
    const quickSelected: string = (() => {
      const raw = (draftFilters as any)?.quickStatusList as string[] | string | undefined;
      if (!raw) return "";
      const arr = Array.isArray(raw) ? raw : [String(raw)];
      return arr[0] ?? "";
    })();
    const toggleQuickStatus = (id: string) => {
      setDraftFilters((p) => {
        const prevRaw = (p as any)?.quickStatusList as string[] | string | undefined;
        const prevArr: string[] = prevRaw
          ? Array.isArray(prevRaw)
            ? prevRaw
            : [String(prevRaw)]
          : [];
        const jaSelecionado = prevArr.includes(id);
        const nextArr = jaSelecionado ? [] : [id];
        return {
          ...p,
          quickStatusList: nextArr as any,
          statusList: [],
          stageList: [],
          bookingLeadIds: undefined as any,
          bookingDateFrom: undefined as any,
          bookingDateTo: undefined as any,
          bookingProfessorName: undefined as any,
          bookingPhone: undefined as any,
          bookingPhoneDigits: undefined as any,
        };
      });
    };
    const quickGroups = new Map<string, Array<{ id: string; label: string }>>();
    for (const opt of STATUS_QUICK_OPTIONS) {
      const arr = quickGroups.get(opt.group) ?? [];
      arr.push({ id: opt.id, label: opt.label });
      quickGroups.set(opt.group, arr);
    }

    const countryOptions = Array.from(
      new Set(panelLeads.map((l) => String(l.country ?? "").trim()).filter(Boolean)),
    ).sort();
    const stateOptions = Array.from(
      new Set(panelLeads.map((l) => String(l.state ?? "").trim()).filter(Boolean)),
    ).sort();

    const toggle = (key: keyof LeadFilters, value: string) => {
      setDraftFilters((prev) => {
        const arr = Array.isArray(prev[key]) ? [...(prev[key] as string[])] : [];
        const idx = arr.indexOf(value);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(value);
        return { ...prev, [key]: arr } as LeadFilters;
      });
    };

    const isFilled = Object.values(draftFilters).some((v) =>
      Array.isArray(v) ? v.length > 0 : Boolean(v),
    );

    function headerPill(title: string, items: string[], key: keyof LeadFilters) {
      const quickLabels: Record<string, string> = {
        quick__experimental_agendada: "Aulas Experimentais Agendadas",
        quick__experimental_incompleta: "Aulas Experimentais Incompletas",
        quick__matricula_incompleta: "Matrículas Incompletas",
        quick__matriculado: "Matriculados",
      };
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-60)] mr-1">
            {title}
          </span>
          {items.length === 0 ? (
            <span className="text-[12px] text-[var(--app-text-50)]">Todos</span>
          ) : (
            items.map((v) => {
              const label =
                key === "quickStatusList"
                  ? quickLabels[v] ?? v
                  : key === "statusList"
                  ? STATUS_LABELS[v] ?? v
                  : key === "stageList"
                  ? v === "experimental_class_incomplete"
                    ? "Aulas Experimentais Incompletas"
                    : STAGE_LABELS[v] ?? v
                  : v;
              const toggleFn =
                key === "quickStatusList"
                  ? () => toggleQuickStatus(v)
                  : () => toggle(key, v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={toggleFn}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                >
                  {label}
                  <span className="text-[var(--app-text-45)]">×</span>
                </button>
              );
            })
          )}
        </div>
      );
    }

    return (
      <AppModal
        open={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        size="lg"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={true}
      >
        <div className="h-full max-h-full flex w-full flex-col gap-0 overflow-hidden">
          {/* Header: MINIMALISTA igual calendário grade (mês/ano + setas + X) */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--app-border)]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(234,88,12,0.20)] bg-[rgba(234,88,12,0.08)] text-[#9a3412]">
                <GraduationCap className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[17px] font-bold leading-tight text-[var(--app-text-95)]">
                  Filtros avançados
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Filtre a lista por status, etapa, localização e data.
                </div>
              </div>
            </div>
            {/* X (close): IGUAL botão X do calendário — h-11 w-11 rounded-full simples, sem sombra.
                ================================================================
                REGRAS OBRIGATÓRIAS — NÃO ALTERAR:
                 (1) ESTE X É APENAS FECHAR. NÃO LIMPA NENHUM FILTRO.
                     - NÃO toca nos 9 campos do filtro avançado (eles
                       permanecem como estavam no activeFilters / draftFilters).
                     - NÃO toca em createdFrom / createdTo do calendário de
                       cadastro (permanece INTACTO — esse era o bug!).
                     - NÃO toca em booking*.

                 (2) O ÚNICO botão que LIMPA os filtros avançados é o botão
                     "Limpar" no RODAPÉ do modal. Aplicar vazio também limpa.

                 (3) O draftFilters NÃO É apagado para o caso do usuário reabrir
                     o modal logo depois — ele continua enxergando os campos
                     selecionados da última vez que abriu (antes de fechar).
                ================================================================ */}
            <button
              type="button"
              onClick={() => {
                // SÓ FECHA. NEM TOCA em activeFilters, em createdFrom/To,
                // nem em nenhum campo. Zero side effects.
                setShowFiltersModal(false);
              }}
              aria-label="Fechar"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)] transition-colors"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>

          {/* Conteudo filtros: MINIMALISTA — 2 grupos visuais, espaçamento uniforme, sem fundos desnecessários */}
          <div className="flex flex-1 min-h-0 w-full flex-col gap-6 overflow-y-auto overscroll-contain px-5 pt-4 pb-3">
            {Array.from(quickGroups.entries()).map(([groupName, opts]) => {
              return (
                <div key={String(groupName)} className="flex flex-col gap-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--app-text-55)] pl-0.5">
                    {String(groupName)}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {opts.map((o) => {
                      const sel = quickSelected === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleQuickStatus(o.id)}
                          className={[
                            "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium text-left transition-colors",
                            sel
                              ? "border-[rgba(234,88,12,0.35)] bg-[rgba(234,88,12,0.08)] text-[#9a3412]"
                              : "border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)]",
                          ].join(" ")}
                        >
                          <span className="min-w-0 truncate">{o.label}</span>
                          {sel ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#ea580c]" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rodapé: MINIMALISTA igual calendário — separador simples, botões quadrados sem sombra nem gradiente */}
          <div className="flex shrink-0 flex-col gap-0 border-t border-[var(--app-border)] px-5 pt-4 pb-5">
            {/* Linha 1: resultado filtrado (simples) */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-[var(--app-text-55)]">
                Resultado filtrado:{" "}
                <strong className="text-[var(--app-text-85)] font-semibold tabular-nums">
                  {liveFilteredCount}
                </strong>{" "}
                {liveFilteredCount === 1 ? "registro" : "registros"}
              </div>
            </div>
            {/* Linha 2: Ações — 2 botões minimalistas, mobile full-width empilhados (aplicar primeiro embaixo, limpar em cima = mobile layout natural) */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end w-full sm:w-auto self-end sm:self-auto">
              {/* Limpar (secundário minimalista — IGUAL botão X do header do calendário).
                  ================================================================
                  REGRAS OBRIGATÓRIAS — NÃO ALTERAR:
                   (1) TOCA SÓ NA SUA ÁREA: NUNCA apaga createdFrom/createdTo
                       (período de cadastro do calendário).
                   (2) Limpa APENAS: os 9 campos do filtro avançado via
                       EMPTY_ADVANCED_FILTERS.
                   (3) Limpa também booking* (filtro "Ver" do modal programação),
                       pois o usuário quer limpar e recomeçar.
                   (4) Se após limpar NÃO EXISTIR FILTRO ATIVO NENHUM (tudo
                       vazio), volta a URL para /app/atendimento (sem query).
                  ================================================================ */}
              <button
                type="button"
                onClick={() => {
                  // ================================================================
                  // BOTÃO "Limpar" DO RODAPÉ DO MODAL DE FILTROS AVANÇADOS.
                  // REGRA NOVA DO USUÁRIO: NÃO DEPENDE MAIS DE "Aplicar".
                  // A limpeza é APLICADA IMEDIATAMENTE — ao clicar em Limpar,
                  // a lista atualiza NA HORA, o draft também é limpo e o
                  // modal fecha.
                  //
                  // AÇÕES:
                  //   (1) Limpa SÓ OS 9 CAMPOS do filtro avançado (suas áreas)
                  //       + Limpa booking* (filtro "Ver" do modal programação).
                  //   (2) PRESERVA createdFrom/createdTo (período de cadastro
                  //       selecionado no calendário header) — com GARANTIA
                  //       REDUNDANTE de reassinatura.
                  //   (3) Limpa draftFilters também (estado visual do modal,
                  //       caso reabra os toggles/selects estão limpos).
                  //   (4) Fecha o modal imediatamente após o clique.
                  //   (5) Se após a limpeza NÃO HOUVER NENHUM filtro ativo
                  //       em NENHUMA área (nem created, nem booking, nem 9
                  //       avançados) → volta URL para /app/atendimento.
                  // ================================================================
                  setActiveFilters((prev) => {
                    const next: LeadFilters = {
                      ...prev,
                      ...EMPTY_ADVANCED_FILTERS,
                      bookingDateFrom: "",
                      bookingDateTo: "",
                      bookingProfessorName: "",
                      bookingPhone: "",
                      bookingPhoneDigits: "",
                      bookingPN: false,
                      bookingLeadIds: [],
                    };
                    next.createdFrom = prev.createdFrom;
                    next.createdTo = prev.createdTo;
                    next.quickStatusList = [];
                    next.statusList = [];
                    next.stageList = [];
                    next.countries = [];
                    next.states = [];
                    next.onlyWithUnread = false;
                    next.onlyWithPhone = false;
                    next.onlyWithEmail = false;
                    next.onlyWithScheduledClass = false;
                    next.onlyWithContract = false;
                    next.bookingLeadIds = [];
                    if (!hasAnyFilterActive(next)) {
                      router.replace("/app/atendimento", { scroll: false });
                    }
                    return next;
                  });
                  // Reseta também o estado visual DRAFT do modal (campos internos)
                  // para quando reabrir não ficar nenhum toggle marcado residual.
                  setDraftFilters({
                    ...EMPTY_FILTERS,
                    quickStatusList: [],
                    statusList: [],
                    stageList: [],
                    countries: [],
                    states: [],
                    onlyWithUnread: false,
                    onlyWithPhone: false,
                    onlyWithEmail: false,
                    onlyWithScheduledClass: false,
                    onlyWithContract: false,
                    bookingDateFrom: "",
                    bookingDateTo: "",
                    bookingProfessorName: "",
                    bookingPhone: "",
                    bookingPhoneDigits: "",
                    bookingPN: false,
                    bookingLeadIds: [],
                    createdFrom: "",
                    createdTo: "",
                  });
                  // Fecha o modal IMEDIATAMENTE — limpar já é aplicado, não
                  // precisa permanecer aberto (equivalente a clicar em Aplicar
                  // com todos os campos limpos).
                  setShowFiltersModal(false);
                }}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-95)] transition-colors w-full sm:w-auto"
              >
                Limpar
              </button>
              {/* Aplicar (primário — IGUAL tom do botão Atualizar/Adicionar no header da lista: LARANJA simples).
                  ================================================================
                  REGRAS OBRIGATÓRIAS — NÃO ALTERAR:
                   (1) TOCA SÓ NA SUA ÁREA: NUNCA altera createdFrom/createdTo do
                       calendário de cadastro (valor vem de `prev`).
                   (2) Aplica APENAS: os 9 campos do filtro avançado vindos do
                       draft (pickAdvancedOnly + mergeAdvancedOnly).
                   (3) Limpa também booking* (filtro "Ver" do modal programação),
                       pois o usuário AGORA quer usar o filtro avançado e não
                       mais os ids específicos do clique "Ver" anterior.
                   (4) Se após aplicar NÃO EXISTIR FILTRO ATIVO NENHUM (tudo
                       vazio), volta a URL para /app/atendimento (sem query).
                  ================================================================ */}
              <button
                type="button"
                onClick={() => {
                  setActiveFilters((prev) => {
                    // 1. Pega SÓ os 9 campos avançados do draft (ignora createdFrom/To etc).
                    const advFromDraft = pickAdvancedOnly(draftFilters);
                    // 2. Mescla SÓ esses 9 no active. Preserva createdFrom/createdTo.
                    let next: LeadFilters = mergeAdvancedOnly(prev, advFromDraft);
                    // 3. Limpa booking* (filtro de aula do botão Ver anterior).
                    (next as any).bookingDateFrom = "";
                    (next as any).bookingDateTo = "";
                    (next as any).bookingProfessorName = "";
                    (next as any).bookingPhone = "";
                    (next as any).bookingPN = false;
                    (next as any).bookingLeadIds = [];
                    // ---------- GARANTIA REDUNDANTE de INDEPENDÊNCIA ----------
                    // createdFrom/createdTo do calendário de cadastro são COPIADOS
                    // EXPLICITAMENTE de prev → NÃO sofrem alteração.
                    next.createdFrom = prev.createdFrom;
                    next.createdTo = prev.createdTo;
                    // ---------------------------------------------------------
                    // Se NÃO HOUVER NENHUM filtro ativo, volta URL para a base
                    // /app/atendimento (remover query params sujos).
                    if (!hasAnyFilterActive(next)) {
                      router.replace("/app/atendimento", { scroll: false });
                    }
                    return next;
                  });
                  setShowFiltersModal(false);
                }}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors w-full sm:w-auto"
                style={{ color: "#ffffff" }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      </AppModal>
    );
  }

  return (
    <div className="flex h-auto w-full min-h-full min-h-0 min-w-0 flex-col gap-4 overflow-visible min-[1201px]:h-full min-[1201px]:overflow-hidden">
      <div className="flex min-h-0 min-w-0 h-auto w-full min-h-full flex-col gap-4 min-[1201px]:flex-row min-[1201px]:h-full min-[1201px]:overflow-hidden overflow-visible">
        {/* ========================================================= */}
        {/* COLUNA ESQUERDA: Lista de Registros (sidebar fixa) */}
        {/* ========================================================= */}
        <aside className="flex h-auto w-full min-h-0 min-w-0 shrink-0 min-[1201px]:w-[360px] min-[1201px]:h-full min-[1201px]:min-h-0 flex-col overflow-visible min-[1201px]:overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none max-[1200px]:h-[calc(100dvh-43px)] max-[1200px]:min-h-[calc(100dvh-43px)] max-[1200px]:max-h-[calc(100dvh-43px)] max-[1200px]:overflow-hidden">
          {/* Header: Apenas ícones (otimizar espaço) — Atualizar | Métricas | Adicionar | Bot Experimental */}
          <div className="flex shrink-0 items-center justify-start gap-2 px-5 pt-5 min-w-0 overflow-x-auto overflow-y-visible overscroll-contain">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loading}
              aria-label="Atualizar lista"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 shadow-none"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            {/* DATA DE CADASTRO no header (acesso direto, nao precisa abrir filtros) - botão pequeno redondo IGUAL OS OUTROS ali (Refresh, SlidersHorizontal etc) */}
            <div className="">
              <AppDateRangePicker
                placeholder="Selecione o período de cadastro..."
                value={{
                  from: (activeFilters.createdFrom ?? null) as string | null,
                  to: (activeFilters.createdTo ?? null) as string | null,
                }}
                onChange={(next: AppDateRange) => {
                  setActiveFilters((p) => {
                    // ================================================================
                    // X / onCHANGE do CALENDÁRIO DE PERÍODO DE CADASTRO (icone calendário header).
                    // REGRAS OBRIGATÓRIAS — NÃO ALTERAR:
                    //
                    //  (1) TOCA SÓ NA SUA ÁREA: este handler NUNCA apaga, altera ou
                    //      interfere nos 9 campos do FILTRO AVANÇADO (statusList,
                    //      stageList, countries, states, onlyWithX). Eles permanecem
                    //      EXATAMENTE como estavam em `p` (estado anterior).
                    //
                    //  (2) Limpa APENAS: createdFrom / createdTo quando o X do
                    //      calendário dispara onChange({ from: null, to: null }).
                    //      Para clique normal em datas, atualiza createdFrom/To.
                    //
                    //  (3) Limpa também booking* (filtro "Ver" do modal programação),
                    //      pois o usuário agora EXPRESSAMENTE quer filtrar por
                    //      período de cadastro, não mais por ids específicos do
                    //      clique "Ver" anterior. booking* NUNCA deve ter prioridade
                    //      sobre uma ação EXPLÍCITA do usuário em um dos filtros.
                    //
                    //  (4) Se após a mudança NÃO EXISTIR FILTRO ATIVO NENHUM (tudo
                    //      vazio), volta URL para /app/atendimento (sem query).
                    // ================================================================
                    const nextRaw: any = {
                      ...p,
                      createdFrom: next.from ?? "",
                      createdTo: next.to ?? "",
                    };

                    // ---------- GARANTIA REDUNDANTE de INDEPENDÊNCIA ----------
                    // Reatribui EXPLICITAMENTE os 9 campos do filtro avançado com
                    // o valor de `p` (antes da alteração). Mesmo que alguém um dia
                    // coloque algo acima acidentalmente, esta linha impede que os
                    // filtros avançados sejam apagados ao interagir com o calendário.
                    for (const k of ADVANCED_FILTER_KEYS) nextRaw[k] = (p as any)[k];
                    // ---------------------------------------------------------

                    // Limpa todo filtro de aula herdado do botão Ver do modal programação
                    nextRaw.bookingDateFrom = "";
                    nextRaw.bookingDateTo = "";
                    nextRaw.bookingProfessorName = "";
                    nextRaw.bookingPhone = "";
                    nextRaw.bookingPN = false;
                    nextRaw.bookingLeadIds = [];

                    // NÃO navega. Apenas o botão "Aplicar" do filtro avançado pode
                    // voltar a URL para /app/atendimento. Interação com o calendário
                    // de cadastro só atualiza estado, sem tocar na URL.
                    return nextRaw;
                  });
                }}
                showLabel={false}
                size="icon"
                iconActive="auto"
                onClearButtonClick={() => {
                  // ================================================================
                  // BOTÃO "Limpar" DENTRO DO POPOVER DO CALENDÁRIO DE CADASTRO
                  // (ao lado direito da seta "mês anterior").
                  //
                  // AÇÃO OBRIGATÓRIA DO USUÁRIO:
                  //  (1) Limpar TODO o histórico e filtros relacionados à busca por
                  //      período de cadastro. (Isso já foi feito no onChange({from:null,
                  //      to:null}) do botão Limpar do AppDateRangePicker, que chama o
                  //      handler onChange acima setando createdFrom/To vazios e limpando
                  //      booking*.)
                  //
                  //  (2) Voltar a URL para o estado PADRÃO, sem query params, sem
                  //      filtros, sem informações da busca anterior:
                  //      → https://www.autobot.business/app/atendimento
                  //
                  // OBS: a sequencia de disparos no onclick do botao Limpar dentro
                  // do AppDateRangePicker e':
                  //   onChange({from:null,to:null})  → limpa created + booking*
                  //   setOpen(false)                 → fecha popover
                  //   onClearButtonClick()           → (AQUI) router.replace
                  // Por isso NAO precisamos tocar em setActiveFilters aqui de novo,
                  // o onChange acima ja cuidou de tudo e manteve 9 campos avançados
                  // intactos, com garantia redundante for (k of ADVANCED_FILTER_KEYS).
                  // ================================================================
                  router.replace("/app/atendimento", { scroll: false });
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setCreateLeadOpen(true)}
              disabled={loading}
              aria-label="Adicionar registro"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 shadow-none"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setShowColorLegendModal(true)}
              aria-label="Legenda das cores dos avatares"
              title="Legenda das cores dos avatares"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] shadow-none"
            >
              <Palette className="h-5 w-5" />
            </button>
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="Alternar bot de agendamento experimental"
                aria-pressed={!botExperimentalDisabled}
                disabled={botExperimentalLoading || loading}
                onClick={() => void handleToggleBotExperimental()}
                className={[
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all shadow-none disabled:cursor-not-allowed disabled:opacity-60",
                  botExperimentalDisabled
                    ? "border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)]"
                    : "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20",
                ].join(" ")}
              >
                <Bot className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Busca */}
          <div className="mt-4 pl-3 pr-5 shrink-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-text-45)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquise por nome ou telefone..."
                className="w-full !bg-white rounded-xl border border-[var(--app-border)] pl-7 pr-4 py-2.5 text-[14px] text-left text-[var(--app-text-85)] placeholder:text-left placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none"
              />
            </div>
          </div>

          {/* Lista Leads (scroll INTERNO em desktop e mobile — header/busca ficam FIXOS no topo) */}
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto scrollbar-hide max-[1200px]:overflow-y-auto pb-5 min-[1201px]:pb-5">
            <div className="flex flex-col divide-y divide-[var(--app-border)]">
              {loading ? (
                <div className="px-5 py-10 text-center text-[13px] text-[var(--app-text-55)]">
                  Carregando registros...
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="px-5 py-10 text-center text-[13px] text-[var(--app-text-55)]">
                  {searchQuery.trim() ? "Nenhum registro encontrado na busca." : "Nenhum registro ainda."}
                </div>
              ) : (
                <>
                  {pagedFilteredLeads.map((lead) => {
                    const isSelected = lead.id === selectedLeadId;
                    const meta = buildExperimentalMetaForList(lead);
                    return (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          explicitSelectLockRef.current = false;
                          suppressAutoSelectUntilRef.current = 0;
                          setSelectedLeadId(lead.id);
                          if (isMobileViewport) setShowMobileLeadModal(true);
                        }}
                        className={[
                          "group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors",
                          isSelected
                            ? "bg-[rgba(234,88,12,0.14)]"
                            : "hover:bg-[var(--app-hover)]",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold",
                            (() => {
                              // =============== REGRA NOVA: FUNDO AMARELO ===============
                              // User pediu (2026-09-29):
                              //   "Para ficar com fundo amarelo deve ser do status:
                              //    Dados básicos coletados / Nenhum passo pendente nessa etapa.
                              //    referente a aula experimental"
                              //
                              // Maqueteamento 1:1 com o CARD STATUS do painel (L4539-L4547):
                              //   · Se buildRecurringMetaForVisaoGeral(lead) === null
                              //        E
                              //     !isLeadMatriculaConcluida(lead)
                              //   → Card Status mostra EXATAMENTE:
                              //       "Dados básicos coletados" + "Nenhum passo pendente nessa etapa."
                              //   → Esse é o único caso onde o avatar fica AMARELO.
                              const step = buildRecurringMetaForVisaoGeral(lead);
                              const matriculaConcluida = isLeadMatriculaConcluida(lead);
                              const dadosBasicosOkNadaPendente =
                                step === null || step === undefined
                                ? !matriculaConcluida
                                : false;

                              // =============== REGRA NOVA: FUNDO VERDE ===============
                              // User pediu (2026-09-29):
                              //   "Quando o professor for selecionado e o link da aula
                              //    adicionado devera ficar fundo verde"
                              //
                              // Usa as mesmas funções já padronizadas do app (consistente
                              // com programação-diária, disparo de notificações, summary):
                              //   · PROFESSOR SELECIONADO → experimentalAssignedProfessorForLead
                              //     retorna !== null (já lida com flat lead + booking).
                              //   · LINK AULA ADICIONADO   → experimentalLessonLinkForLead
                              //     retorna !== '' (lida com lead.experimental_class_link
                              //     OU booking.lesson_link).
                              //
                              // TEM PRECEDÊNCIA SOBRE AMARELO e cor normal: se ambos os
                              // marcadores acima estiverem OK → VERDE sempre (matricula
                              // concluída continua na cor normal conforme regra original).
                              const prof = experimentalAssignedProfessorForLead(lead);
                              const link = experimentalLessonLinkForLead(lead);
                              const temProfessor = prof !== null && prof !== undefined;
                              const temLink = Boolean(link);
                              const professorELinkOk = temProfessor && temLink && !matriculaConcluida;

                              if (professorELinkOk) {
                                return isSelected
                                  // SELECIONADO verde: mesmo fundo (#16a34a green-600),
                                  // anel + sombra para marcar seleção (igual amarelo),
                                  // sem hover.
                                  ? "!bg-[#16a34a] !text-white ring-[3px] ring-[#15803d] shadow-[0_2px_6px_rgba(22,163,74,0.42)] transition-none hover:!bg-[#16a34a] hover:!ring-[#15803d]"
                                  // NÃO SELECIONADO verde: #16a34a (verde vivo), sem anel,
                                  // sem hover, texto branco (contraste bom no verde).
                                  : "!bg-[#16a34a] !text-white transition-none hover:!bg-[#16a34a]";
                              }

                              if (dadosBasicosOkNadaPendente) {
                                return isSelected
                                  // SELECIONADO → MESMO FUNDO AMARELO um pouco mais escuro (#eab308)
                                  // do unselected, NÃO deixa mais escuro ainda. A seleção é marcada
                                  // só por anel grosso (ring-[3px] #ca8a04) + sombra. Sem hover.
                                  ? "!bg-[#eab308] !text-white ring-[3px] ring-[#ca8a04] shadow-[0_2px_6px_rgba(202,138,4,0.5)] transition-none hover:!bg-[#eab308] hover:!ring-[#ca8a04]"
                                  // NÃO SELECIONADO → amarelo #eab308 (um pouco mais escuro que o antigo #facc15).
                                  // Sem hover, sem anel, sem tom escuro extra.
                                  : "!bg-[#eab308] !text-white transition-none hover:!bg-[#eab308]";
                              }

                              // Qualquer OUTRO status (matricula concluida / warning de falta
                              // estado cidade / falta dia-horario) → laranja PERMANENTE
                              // (não precisa selecionar para ficar laranja, conforme pedido).
                              // Seleção é marcada só por anel + sombra (igual verde/amarelo),
                              // sem mudar a cor do fundo.
                              return isSelected
                                ? "!bg-[#ea580c] !text-white ring-[3px] ring-[#c2410c] shadow-[0_2px_6px_rgba(234,88,12,0.42)] transition-none hover:!bg-[#ea580c] hover:!ring-[#c2410c]"
                                : "!bg-[#ea580c] !text-white transition-none hover:!bg-[#ea580c]";
                            })(),
                          ].join(" ")}
                        >
                          {buildInitials(lead.full_name)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold leading-tight !text-[var(--app-text-85)]">
                            {lead.full_name?.trim() || "Sem nome"}
                          </div>
                          <div
                            className={[
                              "mt-1 truncate text-[12px] font-medium",
                              meta.tone === "success"
                                ? "text-emerald-700"
                                : meta.tone === "warning"
                                ? "text-[#9a3412]"
                                : "text-[var(--app-text-60)]",
                            ].join(" ")}
                          >
                            {meta.label}
                          </div>
                          <div className="mt-1 text-[12px] font-medium text-[var(--app-text-55)]">
                            Criado em: {formatAtendimentoDateTime(lead.created_at)}
                          </div>
                        </div>

                        <ChevronRight
                          className={[
                            "mt-2 h-4 w-4 shrink-0 transition-colors",
                            isSelected ? "text-[#9a3412]" : "text-[var(--app-text-45)] group-hover:text-[var(--app-text-70)]",
                          ].join(" ")}
                        />
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
          {totalPages > 1 ? (
            <div className="flex shrink-0 items-center justify-center gap-2 px-4 pt-3 pb-3 border-t border-[var(--app-border)] bg-[var(--app-solid-surface-2)]/45 sm:px-5 sm:pt-3.5 sm:pb-3.5">
              <div className="flex shrink-0 items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setLeadListPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] pl-2.5 pr-3 text-[12px] font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Anterior</span>
                </button>
                <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-1.5 py-1">
                  {(() => {
                    const out: (number | "dots")[] = [];
                    const add = (n: number | "dots") => out.push(n);
                    const has = (n: number) => out.includes(n as any);
                    const cur = safePage;
                    const N = totalPages;
                    add(1);
                    if (N === 2) add(2);
                    if (N >= 3) {
                      if (cur - 1 > 1) add("dots");
                      const left = Math.max(2, cur);
                      const right = Math.min(N - 1, cur);
                      for (let p = left; p <= right; p++) add(p);
                      if (N - cur > 1) add("dots");
                      if (!has(N)) add(N);
                    }
                    return out.map((x, idx) => {
                      if (x === "dots") {
                        return (
                          <span
                            key={`dot-${idx}`}
                            className="px-1 text-[11px] font-bold text-[var(--app-text-40)] tabular-nums"
                          >
                            ···
                          </span>
                        );
                      }
                      const p = x as number;
                      const isCur = p === safePage;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setLeadListPage(p)}
                          disabled={isCur}
                          className={
                            "inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 text-[12px] font-bold tabular-nums transition-colors " +
                            (isCur
                              ? "!bg-[#ea580c] !text-white shadow-[0_1px_2px_rgba(234,88,12,0.25)] disabled:opacity-100"
                              : "text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)]")
                          }
                          aria-label={`Página ${p}`}
                        >
                          {p}
                        </button>
                      );
                    });
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => setLeadListPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] pl-3 pr-2.5 text-[12px] font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Próxima página"
                >
                  <span className="hidden sm:inline">Próxima</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        {/* ========================================================= */}
        {/* COLUNA DIREITA: Detalhe do Lead selecionado */}
        {/* ========================================================= */}
        {/* AVISO: Section SÓ é visível em DESKTOP (min-[1201px])! Em telas menores (mobile), */}
        {/* o usuário clica no item da lista → ABRE MODAL (abaixo, AppMobileLeadDetailModal) */}
        <section className="hidden min-[1201px]:flex h-auto w-full min-h-0 min-w-0 flex-1 flex-col overflow-visible min-[1201px]:h-full min-[1201px]:min-h-0 min-[1201px]:overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none mb-4 min-[1201px]:mb-0 overflow-hidden h-full max-h-full">
          {(() => {
            if (!selectedLead) {
              return (
                <div className="flex min-h-[420px] w-full items-center justify-center min-[1201px]:h-full">
                  <div className="text-center px-6 max-w-md">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                      <UserRound className="h-6 w-6 text-[#9a3412]" />
                    </div>
                    <h3 className="mt-4 text-lg font-bold text-[var(--app-text-85)]">
                      Selecione um registro
                    </h3>
                    <p className="mt-2 text-[13px] text-[var(--app-text-60)]">
                      Clique em qualquer registro ao lado para ver os detalhes, agendamentos, link de matrícula e mais.
                    </p>
                  </div>
                </div>
              );
            }
            const sl = selectedLead;
            const statusMeta = buildRecurringMetaForVisaoGeral(sl);
            const expMeta = buildExperimentalMetaForList(sl);
            return (
              <>
                {/* HEADER DO LEAD (Avatar + Nome + Telefone + Botoes) — FIXO (shrink-0, nunca some!) */}
                <div className="flex shrink-0 flex-col gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
                  {/* MOBILE (< sm): X no CANTO SUPERIOR DIREITO (layout centralizado) */}
                  <div className="flex sm:hidden shrink-0 items-start justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLeadId(null);
                      }}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                      aria-label="Fechar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* MOBILE (< sm): CONTEÚDO CENTRALIZADO. DESKTOP (sm+): layout lateral original */}
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col items-center gap-4 text-center min-w-0 sm:flex-row sm:items-start sm:justify-start sm:text-left">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl !bg-[#ea580c] text-[22px] font-semibold !text-white sm:h-16 sm:w-16 sm:text-[22px] sm:rounded-full">
                        {buildInitials(sl.full_name)}
                      </div>
                      <div className="min-w-0 flex-1 w-full">
                        <h2 className="truncate text-[20px] font-bold leading-tight text-[var(--app-text-85)] sm:text-[22px]">
                          {sl.full_name?.trim() || "Sem nome"}
                        </h2>
                        <div className="mt-2 flex flex-col items-center justify-center gap-2 sm:flex-row sm:items-center sm:justify-start sm:flex-wrap">
                          <span className="truncate text-[13px] font-semibold text-[var(--app-text-80)] sm:text-[14px]">
                            📞 {sl.phone?.trim() ? applyPhoneMask(sl.phone) : "Sem telefone"}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(sl)}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 text-[11px] font-semibold text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copiar
                          </button>
                        </div>
                        <div className="mt-1 text-[13px] font-medium text-[var(--app-text-60)] sm:text-[14px] sm:font-semibold">
                          Criado em: {formatAtendimentoDateTime(sl.created_at)}
                        </div>
                      </div>
                    </div>

                    {/* MOBILE (< sm): botões Editar/Excluir OCUPAM TUDO centralizados lado a lado (X já tá no topo direito!) */}
                    {/* DESKTOP (sm+): 3 botões Editar/Excluir/X lado a lado normal */}
                    <div className="flex w-full shrink-0 items-center justify-center gap-2 sm:justify-end overflow-x-auto overflow-y-visible overscroll-contain sm:w-auto sm:overflow-visible">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSelected()}
                        className="inline-flex h-10 shrink-0 flex-1 sm:flex-none items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] sm:flex-none"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSelected()}
                        disabled={deletingSelectedLoading}
                        className="inline-flex h-10 shrink-0 flex-1 sm:flex-none items-center justify-center gap-2 rounded-full transition-all bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none px-4 text-[13px] font-semibold disabled:opacity-60"
                        aria-label="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                        Excluir
                      </button>
                      {/* X só visível em DESKTOP (sm+). No mobile já tá no topo direito! */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLeadId(null);
                        }}
                        className="hidden sm:inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                        aria-label="Fechar"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* TABS — FIXAS (shrink-0, abaixo do header, sempre fixo) */}
                {/*
                    MOBILE (< sm): SEGMENTED CONTROL (pills com 4 abas lado a lado / grid-cols-4),
                    SEM setas, SEM overlap, SEM overflow-x — bonito, centralizado, responsivo.
                    DESKTOP (sm+): scroll horizontal com setas laranjas overlap (mantém anterior).
                */}
                <div className="mt-6 border-b border-[var(--app-border)] shrink-0 relative px-4 py-3 sm:px-0 sm:py-0">
                  {/* MOBILE (< sm): segmented control SÓ ÍCONES (sem label, economiza espaço) */}
                  <div className="flex sm:hidden w-full items-center gap-1.5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] p-1.5">
                    {LEAD_DETAILS_TABS.map((tab) => {
                      const isActive = tab.id === activeTab;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={[
                            "group inline-flex min-h-[40px] min-w-0 flex-1 shrink-0 items-center justify-center rounded-xl transition-all",
                            isActive
                              ? "bg-[var(--app-solid-surface)] text-[#9a3412] shadow-sm ring-1 ring-[var(--app-border)]"
                              : "bg-transparent text-[var(--app-text-60)] hover:text-[var(--app-text-85)]",
                          ].join(" ")}
                          title={tab.label}
                          aria-label={tab.label}
                        >
                          <span className="shrink-0">{tab.icon}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* DESKTOP (sm+): setas overlap + scroll horizontal */}
                  <div className="hidden sm:block">
                    {desktopTabsCanLeft ? (
                      <button
                        type="button"
                        onClick={() => scrollTabsBy(tabsScrollDesktopRef.current, -1, setDesktopTabsCanLeft, setDesktopTabsCanRight)}
                        className="absolute left-0 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 shrink-0 items-center justify-center rounded-full transition-all bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none shadow-[0_0_0_6px_var(--app-solid-surface)] disabled:opacity-60"
                        aria-label="Tabs anteriores"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    ) : null}
                    {desktopTabsCanRight ? (
                      <button
                        type="button"
                        onClick={() => scrollTabsBy(tabsScrollDesktopRef.current, +1, setDesktopTabsCanLeft, setDesktopTabsCanRight)}
                        className="absolute right-0 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 shrink-0 items-center justify-center rounded-full transition-all bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none shadow-[0_0_0_6px_var(--app-solid-surface)] disabled:opacity-60"
                        aria-label="Próximas tabs"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : null}
                    <div
                      ref={tabsScrollDesktopRef}
                      onScroll={(e) => updateTabsArrowsState(e.currentTarget as HTMLDivElement, setDesktopTabsCanLeft, setDesktopTabsCanRight)}
                      className="-mb-px flex items-center gap-5 sm:gap-6 overflow-x-auto scrollbar-hide px-6"
                    >
                      {LEAD_DETAILS_TABS.map((tab) => {
                        const isActive = tab.id === activeTab;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                              "group inline-flex shrink-0 items-center gap-2 border-b-2 px-1 pb-4 text-[13px] font-semibold transition-colors sm:text-[14px]",
                              isActive
                                ? "border-[#ea580c] !text-[#9a3412]"
                                : "border-transparent text-[var(--app-text-60)] hover:text-[var(--app-text-85)]",
                            ].join(" ")}
                          >
                            {tab.icon}
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* CONTEUDO TABS (scroll INTERNO só em DESKTOP; mobile/modal: scroll natural) */}
                <div className="flex-1 min-h-0 overflow-visible min-[1201px]:overflow-y-auto min-[1201px]:scrollbar-hide px-6 py-6">
                  {/* ============== VISÃO GERAL ============== */}
                  {activeTab === "visao_geral" ? (
                    <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
                      {/* CARD 1: Informações */}
                      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <UserRound className="h-5 w-5 text-[var(--app-text-70)]" />
                            <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                              Informações
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenEditLocationSelected()}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3.5 text-[12px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {[
                            { label: "Estado", value: (sl as any).state ?? null },
                            { label: "Cidade", value: (sl as any).city ?? null },
                            { label: "País", value: (sl as any).country ?? null },
                            { label: "Fuso horário", value: deriveLeadEffectiveTimeZone(sl) ?? null },
                          ].map(({ label, value }) => (
                            <div key={label}>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                                {label}
                              </div>
                              <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                {value || "-"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* CARD 2: Link de Matrícula */}
                      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <ExternalLink className="h-5 w-5 text-[var(--app-text-70)]" />
                            <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                              Link de Matrícula
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleOpenEditSenha}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3.5 text-[12px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar senha
                          </button>
                        </div>
                        <div className="mt-4">
                          <div className="relative overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] pr-12">
                            <div className="min-h-[44px] w-full truncate px-4 py-3 text-[13px] font-semibold text-[var(--app-text-85)]">
                              {buildRecurringClassUrl(sl)}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyMatriculaLink(sl)}
                              className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-[var(--app-solid-surface)] border border-[var(--app-border)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)]"
                              aria-label="Copiar link"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => handleOpenMatriculaLink(sl)}
                            className={[
                              "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold !text-white shadow-none transition",
                              isLeadMatriculaConcluida(sl)
                                ? "bg-sky-600 hover:bg-sky-500"
                                : "bg-emerald-600 hover:bg-emerald-500",
                            ].join(" ")}
                          >
                            <ExternalLink className="h-4 w-4" />
                            {isLeadMatriculaConcluida(sl) ? "Abrir painel" : "Abrir matrícula"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyMatriculaLink(sl)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                          >
                            <Copy className="h-4 w-4" />
                            Copiar link
                          </button>
                        </div>
                      </div>

                      {/* CARD 3: Status */}
                      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 text-[var(--app-text-70)]">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                              <path d="M3 3v18h18" />
                              <path d="M7 14l4-4 4 4 5-5" />
                            </svg>
                          </div>
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Status
                          </div>
                        </div>
                        {!statusMeta ? (
                          <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-3">
                            <div className="font-semibold text-emerald-800">
                              Dados básicos coletados
                            </div>
                            <div className="mt-0.5 text-[13px] text-emerald-700/90">
                              Nenhum passo pendente nessa etapa.
                            </div>
                          </div>
                        ) : statusMeta.tone === "success" ? (
                          <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-3">
                            <div className="font-semibold text-emerald-800">
                              {statusMeta.title}
                            </div>
                            <div className="mt-0.5 text-[13px] text-emerald-700/90">
                              {statusMeta.body}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border border-[rgba(234,88,12,0.35)] bg-[rgba(234,88,12,0.14)] px-4 py-3">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ea580c]/20">
                                <AlertCircle className="h-5 w-5 text-[#9a3412]" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold !text-[#9a3412]">
                                  {statusMeta.title}
                                </div>
                                <div className="mt-0.5 text-[13px] text-[#9a3412]/80">
                                  {statusMeta.body}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* CARD 4: Próxima aula */}
                      <div className={
                        "overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none transition-opacity " +
                        (bookingLocationOk
                          ? ""
                          : "opacity-50 pointer-events-none select-none cursor-not-allowed")
                      }>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                            <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                              Próxima aula
                            </div>
                          </div>
                          {(() => {
                            const lead = selectedLead as any;
                            const hasExp = Boolean(
                              lead?.future_experimental_class_booking ||
                                lead?.experimental_class_booking ||
                                String(lead?.experimental_class_lead_date ?? "").trim() ||
                                String(lead?.experimental_class_lead_time ?? "").trim()
                            );
                            const weekdayRaw = String(lead?.recurring_weekday ?? "").trim();
                            const timeRaw = String(lead?.recurring_start_time ?? "").trim();
                            const freqRaw = String(lead?.recurring_frequency ?? "").trim();
                            const hasRec = Boolean(weekdayRaw || timeRaw || freqRaw);
                            const isExpFirst = !hasRec && hasExp;
                            const isRecFirst = hasRec && !hasExp;
                            if (isExpFirst) return (
                              <div className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                                Experimental
                              </div>
                            );
                            if (isRecFirst) return (
                              <div className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-[#ea580c]/30 bg-[rgba(234,88,12,0.12)] px-3 text-[11px] font-bold uppercase tracking-wide text-[#9a3412]">
                                Recorrente
                              </div>
                            );
                            if (hasExp && hasRec) return (
                              <div className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                                Experimental
                              </div>
                            );
                            return null;
                          })()}
                        </div>
                        {expMeta.tone === "success" ? (
                          <>
                            {(() => {
                              const bk = (selectedLead as any)?.experimental_class_booking;
                              const cancelled = String(bk?.status ?? "").trim().toLowerCase() === "cancelled";
                              return cancelled ? (
                                <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3">
                                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-700">
                                    <CalendarIcon className="h-5 w-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-red-800 truncate">
                                      {(() => {
                                        const label = String(expMeta.label ?? "").trim();
                                        if (!label) return "Aula cancelada";
                                        if (label.toLowerCase().startsWith("aula em:")) {
                                          return "Aula cancelada em:" + label.slice("aula em:".length);
                                        }
                                        return label.replace(/^Aula em:\s*/i, "Aula cancelada em: ");
                                      })()}
                                    </div>
                                    <div className="mt-0.5 text-[13px] text-red-700/80">
                                      Horário cancelado.
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
                                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-700">
                                    <CalendarIcon className="h-5 w-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-emerald-800 truncate">
                                      {expMeta.label}
                                    </div>
                                    <div className="mt-0.5 text-[13px] text-emerald-700/80">
                                      Horário confirmado para o registro.
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                            {(() => {
                              const sl = selectedLead;
                              const expBestBooking =
                                (sl as any).latest_experimental_class_booking ??
                                (sl as any).experimental_class_booking ??
                                (sl as any).future_experimental_class_booking;
                              const bk = expBestBooking as any;
                              const expEffectiveStatus =
                                String(bk?.status ?? (sl as any).experimental_class_booking_status ?? (sl as any).experimental_class_status ?? "").trim().toLowerCase();
                              const cancelled = expEffectiveStatus === "cancelled";
                              return (
                            <div className="mt-4 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenExpInfo(selectedLead)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55"
                                disabled={cancelled}
                                title={cancelled ? "Agendamento cancelado." : undefined}
                              >
                                <Info className="h-4 w-4" />
                                Mais informações
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenExperimentalBooking(selectedLead)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55"
                                disabled={cancelled}
                                title={cancelled ? "Agendamento cancelado. Não é possível reagendar." : undefined}
                              >
                                <Plus className="h-4 w-4" />
                                Reagendar
                              </button>
                            </div>
                              );
                            })()}
                          </>
                        ) : (
                          <>
                            <div className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3">
                              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-solid-surface)] border border-[var(--app-border)] text-[var(--app-text-70)]">
                                <CalendarIcon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-[var(--app-text-85)]">
                                  Nenhuma aula agendada
                                </div>
                                <div className="mt-0.5 text-[13px] text-[var(--app-text-60)]">
                                  Este registro ainda não possui aulas agendadas.
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleOpenExperimentalBooking(selectedLead)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                              >
                                <Plus className="h-4 w-4" />
                                Agendar
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* ============== AGENDAMENTOS ============== */}
                  {activeTab === "agendamentos" ? (
                    <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-1">
                      {(() => {
                        if (showRecurringCard) {
                          return (
                            <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                              <div className="flex items-center gap-2">
                                <RefreshCw className="h-5 w-5 text-[var(--app-text-70)]" />
                                <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                                  Aulas recorrentes
                                </div>
                              </div>
                              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Dia</div>
                                  <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                    {String((sl as any).recurring_class_weekday_label ?? (sl as any).recurring_class_weekday ?? "-").trim() || "-"}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Horário</div>
                                  <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                    {String((sl as any).recurring_class_professor_time ?? (sl as any).recurring_class_lead_time ?? "-").trim() || "-"}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Status</div>
                                  <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                    {String((sl as any).recurring_class_status ?? "-").trim() || "-"}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Etapa</div>
                                  <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                    Passo {Number((sl as any).recurring_registration_step ?? 0) || "-"}/12
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        const expTone = buildExperimentalMetaForList(sl).tone;
                        if (expTone === "success") {
                          const expAssigned = experimentalAssignedProfessorForLead(sl);
                          const expSavedLink = experimentalLessonLinkForLead(sl);
                          const expHasPhone = Boolean(String(sl?.phone ?? "").trim());
                          const expBestBooking =
                            (sl as any).latest_experimental_class_booking ??
                            (sl as any).experimental_class_booking ??
                            (sl as any).future_experimental_class_booking;
                          const bk = expBestBooking as any;
                          const expEffectiveAttendance =
                            String(bk?.attendance_status ?? (sl as any).experimental_class_attendance_status ?? "").trim();
                          const expEffectiveStatus =
                            String(bk?.status ?? (sl as any).experimental_class_booking_status ?? (sl as any).experimental_class_status ?? "").trim().toLowerCase();
                          const expClassJaPassou = isExperimentalClassPast(sl);
                          const expDisparoJaFoiFeito = experimentalHasAnyDisparoConcluido(sl);
                          const expHasAttendanceStatus = Boolean(expEffectiveAttendance) || expDisparoJaFoiFeito || (expClassJaPassou && experimentalLockedProf);
                          // ============================================================
                          // REGRA ALTERADA (user: 'podera sim!' 2026-09-29):
                          //   Aula cancelada agora PODE ser editada/reagendada/professor
                          //   alterado/link salvo/disparada.
                          //   BLOQUEIOS PERMANECEM: hasAttendance (attendance/disparo feito)
                          // ============================================================
                          const expBookingIsCancelled = expEffectiveStatus === "cancelled";
                          const expCanShowDisparar = !experimentalHasAnyDisparoConcluido(sl);
                          const expCanSendDisparo = Boolean(expAssigned && expSavedLink && expHasPhone && !expSendingNotification && !experimentalLockedProf);
                          const expLessonLinkSaveDisabled = (() => {
                            const d = experimentalLessonLinkDraft.trim();
                            if (!d && !expSavedLink) return true;
                            if (d === expSavedLink) return true;
                            if (expSavingLessonLink || experimentalLockedProf) return true;
                            return false;
                          })();
                          return (
                            <div className="relative overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-center gap-2 shrink-0 min-w-[190px] max-w-full min-[1201px]:self-center">
                                  <CalendarIcon className="h-5 w-5 shrink-0 text-[var(--app-text-70)]" />
                                  <div className="text-[15px] font-bold text-[var(--app-text-85)] truncate">
                                    Aula experimental
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-stretch justify-start sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto min-w-0 sm:mt-0 mt-6">
                                  {expCanShowDisparar ? (
                                    <div className="flex w-full sm:w-auto shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => void handleSendStudentNotificationExperimental(sl)}
                                        disabled={!expCanSendDisparo}
                                        title={(() => {
                                          if (!expSavedLink && !expAssigned) {
                                            return "Adicione o link da aula e selecione o professor antes de disparar.";
                                          }
                                          if (!expSavedLink) {
                                            return "Adicione o link da aula experimental antes de disparar a notificação.";
                                          }
                                          if (!expAssigned) {
                                            return "Selecione o professor responsável antes de disparar.";
                                          }
                                          if (!expHasPhone) {
                                            return "Registro não possui telefone cadastrado para receber a notificação.";
                                          }
                                          return "Disparar notificações agora.";
                                        })()}
                                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl transition-all bg-[var(--app-btn-primary-bg)] px-5 text-[13px] font-semibold !text-[var(--app-btn-primary-fg)] shadow-none disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                                      >
                                        <Zap className="h-4 w-4 shrink-0" />
                                        {expSendingNotification ? "Disparando..." : "Disparar"}
                                      </button>
                                    </div>
                                  ) : null}
                                  {expHasAttendanceStatus ? (
                                    <div className="hidden sm:flex shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => void handleSendExperimentalPostAttendanceMessage(sl)}
                                        disabled={Boolean(expSendingPostAttendanceId) || Boolean((sl as any)?.experimental_class_post_attendance_message_sent_at || (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at) || !expHasPhone}
                                        title={(() => {
                                          const alreadySent = Boolean(
                                            (sl as any)?.experimental_class_post_attendance_message_sent_at ||
                                              (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at,
                                          );
                                          if (expSendingPostAttendanceId) {
                                            return "Enviando a mensagem de matrícula para este registro.";
                                          }
                                          if (alreadySent) {
                                            return "A mensagem de matrícula já foi enviada para este registro.";
                                          }
                                          if (!expHasPhone) {
                                            return "Registro não possui telefone cadastrado para receber a mensagem de matrícula.";
                                          }
                                          return "Enviar a mensagem de matrícula para o aluno após a aula experimental.";
                                        })()}
                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                      >
                                        {expSendingPostAttendanceId ? (
                                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                        ) : (
                                          <Check className="h-4 w-4 shrink-0 text-emerald-700" />
                                        )}
                                      </button>
                                    </div>
                                  ) : null}
                                  <div className="flex w-full sm:w-auto shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenExperimentalBooking(sl)}
                                      disabled={(() => {
                                        if (Boolean(expEffectiveAttendance)) return true;
                                        return false;
                                      })()}
                                      title={(() => {
                                        if (Boolean(expEffectiveAttendance)) {
                                          return "Aula experimental não pode ser reagendada após comparecimento marcado.";
                                        }
                                        return "Reagendar esta aula experimental.";
                                      })()}
                                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                                    >
                                      <Plus className="h-4 w-4" />
                                      Reagendar
                                    </button>
                                  </div>
                                  <div className="relative w-full sm:w-auto shrink-0 min-w-0 sm:max-w-[320px]">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (experimentalLockedProf) {
                                        if (expHasAttendanceStatus) {
                                          modalToast.warning("Professor não pode ser alterado após comparecimento marcado.");
                                        } else {
                                          modalToast.warning("Professor não pode ser alterado após o disparo ser realizado.");
                                        }
                                        return;
                                      }
                                      setExpAssignProfDropdownOpen((v) => !v);
                                    }}
                                    onBlur={() => {
                                      setTimeout(() => setExpAssignProfDropdownOpen(false), 180);
                                    }}
                                    disabled={expAssigningProfessor || experimentalLockedProf}
                                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                                    title={(() => {
                                      if (experimentalLockedProf) {
                                        if (expHasAttendanceStatus) {
                                          return "Professor não pode ser alterado após comparecimento marcado.";
                                        }
                                        return "Professor não pode ser alterado após o disparo ser realizado.";
                                      }
                                      return expAssigned
                                        ? `Professor vinculado: ${expAssigned.name}`
                                        : "Selecionar professor responsável pela aula experimental";
                                    })()}
                                  >
                                    {expAssigningProfessor ? (
                                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--app-text-65)]" />
                                    )}
                                    <span className="truncate">
                                      {expAssigned
                                        ? `${expAssigned.name}`
                                        : "Selecionar professor"}
                                    </span>
                                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--app-text-65)]" />
                                  </button>
                                  {expAssignProfDropdownOpen ? (
                                    <div className="absolute right-0 top-full z-[380] mt-2 flex w-[300px] flex-col gap-1 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-1.5 shadow-lg">
                                      {EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT.map((opt) => {
                                        const isActive = expAssigned?.phone === opt.phone && expAssigned?.name === opt.name;
                                        const optionDisabled = expAssigningProfessor || experimentalLockedProf;
                                        return (
                                          <button
                                            key={opt.phone}
                                            type="button"
                                            disabled={optionDisabled}
                                            onClick={() => {
                                              if (experimentalLockedProf) {
                                                if (expHasAttendanceStatus) {
                                                  modalToast.warning("Professor não pode ser alterado após comparecimento marcado.");
                                                } else {
                                                  modalToast.warning("Professor não pode ser alterado após o disparo ser realizado.");
                                                }
                                                setExpAssignProfDropdownOpen(false);
                                                return;
                                              }
                                              setExpAssignProfDropdownOpen(false);
                                              void handleAssignProfessorExperimental(sl, { name: opt.name, phone: opt.phone });
                                            }}
                                            className={[
                                              "flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition",
                                              isActive
                                                ? "border border-emerald-500/30 bg-emerald-500/10"
                                                : "border border-transparent hover:bg-[var(--app-hover)]",
                                              "disabled:cursor-not-allowed disabled:opacity-55",
                                            ].join(" ")}
                                            title={
                                              experimentalLockedProf
                                                ? expHasAttendanceStatus
                                                  ? "Professor não pode ser alterado após comparecimento marcado."
                                                  : "Professor não pode ser alterado após o disparo ser realizado."
                                                : ""
                                            }
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="truncate text-[13px] font-semibold text-[var(--app-text-85)]">
                                                {opt.name}
                                              </div>
                                            </div>
                                            {isActive ? (
                                              <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                                                <Check className="h-3 w-3 shrink-0" />
                                                Atual
                                              </div>
                                            ) : null}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleCancelExperimentalBooking(sl)}
                                    disabled={(() => {
                                      if (expCancellingBookingId === String(bk?.id ?? "").trim()) return true;
                                      if (expBookingIsCancelled) return true;
                                      if (expHasAttendanceStatus) return true;
                                      if (experimentalLockedProf) return true;
                                      if (!expAssigned) return true;
                                      return false;
                                    })()}
                                    title={(() => {
                                      if (expBookingIsCancelled) {
                                        return "Agendamento já foi cancelado.";
                                      }
                                      if (expHasAttendanceStatus) {
                                        return "Agendamento não pode ser cancelado após comparecimento marcado.";
                                      }
                                      if (experimentalLockedProf) {
                                        return "Agendamento não pode ser cancelado após o disparo ser realizado.";
                                      }
                                      if (!expAssigned) {
                                        return "Selecione o professor responsável antes de cancelar o agendamento.";
                                      }
                                      if (expCancellingBookingId === String(bk?.id ?? "").trim()) {
                                        return "Cancelando agendamento...";
                                      }
                                      return "Cancelar este agendamento de aula experimental.";
                                    })()}
                                    className="hidden sm:inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                  >
                                    {expCancellingBookingId === String(bk?.id ?? "").trim() ? (
                                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                    ) : (
                                      <X className="h-4 w-4 shrink-0" />
                                    )}
                                  </button>
                                </div>
                                <div className="flex sm:hidden absolute top-5 right-5 z-10 items-center gap-2">
                                  {expHasAttendanceStatus ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleSendExperimentalPostAttendanceMessage(sl)}
                                      disabled={Boolean(expSendingPostAttendanceId) || Boolean((sl as any)?.experimental_class_post_attendance_message_sent_at || (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at) || !expHasPhone}
                                      title={(() => {
                                        const alreadySent = Boolean(
                                          (sl as any)?.experimental_class_post_attendance_message_sent_at ||
                                            (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at,
                                        );
                                        if (expSendingPostAttendanceId) {
                                          return "Enviando a mensagem de matrícula para este registro.";
                                        }
                                        if (alreadySent) {
                                          return "A mensagem de matrícula já foi enviada para este registro.";
                                        }
                                        if (!expHasPhone) {
                                          return "Registro não possui telefone cadastrado para receber a mensagem de matrícula.";
                                        }
                                        return "Enviar a mensagem de matrícula para o aluno após a aula experimental.";
                                      })()}
                                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                    >
                                      {expSendingPostAttendanceId ? (
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                      ) : (
                                        <Check className="h-4 w-4 shrink-0 text-emerald-700" />
                                      )}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => void handleCancelExperimentalBooking(sl)}
                                    disabled={(() => {
                                      if (expCancellingBookingId === String(bk?.id ?? "").trim()) return true;
                                      if (expBookingIsCancelled) return true;
                                      if (expHasAttendanceStatus) return true;
                                      if (experimentalLockedProf) return true;
                                      if (!expAssigned) return true;
                                      return false;
                                    })()}
                                    title={(() => {
                                      if (expBookingIsCancelled) {
                                        return "Agendamento já foi cancelado.";
                                      }
                                      if (expHasAttendanceStatus) {
                                        return "Agendamento não pode ser cancelado após comparecimento marcado.";
                                      }
                                      if (experimentalLockedProf) {
                                        return "Agendamento não pode ser cancelado após o disparo ser realizado.";
                                      }
                                      if (!expAssigned) {
                                        return "Selecione o professor responsável antes de cancelar o agendamento.";
                                      }
                                      if (expCancellingBookingId === String(bk?.id ?? "").trim()) {
                                        return "Cancelando agendamento...";
                                      }
                                      return "Cancelar este agendamento de aula experimental.";
                                    })()}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                  >
                                    {expCancellingBookingId === String(bk?.id ?? "").trim() ? (
                                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                    ) : (
                                      <X className="h-4 w-4 shrink-0" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              {!expAssigned ? (
                                <div className="mt-3 flex sm:hidden min-w-0 items-center gap-2">
                                  <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Escolha o professor
                                  </div>
                                </div>
                              ) : null}
                              {expBookingIsCancelled ? (
                                <div className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3">
                                  <div className="text-[13px] font-semibold text-red-800">
                                    {(() => {
                                      const label = String(buildExperimentalMetaForList(sl).label ?? "").trim();
                                      if (!label) return "Aula cancelada";
                                      if (label.toLowerCase().startsWith("aula em:")) {
                                        return "Aula cancelada em:" + label.slice("aula em:".length);
                                      }
                                      return label.replace(/^Aula em:\s*/i, "Aula cancelada em: ");
                                    })()}
                                  </div>
                                  <div className="mt-1 text-[12px] text-red-700/80">
                                    Horário cancelado.
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3">
                                  <div className="text-[13px] font-semibold text-[var(--app-text-85)]">
                                    {buildExperimentalMetaForList(sl).label}
                                  </div>
                                  <div className="mt-1 text-[12px] text-[var(--app-text-60)]">
                                    Horário definido para esse registro.
                                  </div>
                                </div>
                              )}

                              <div className="mt-5">
                                <div className="flex flex-col items-stretch gap-3 min-[600px]:flex-row min-[600px]:items-end">
                                  <div className="min-w-0 flex-1">
                                    <label className="mb-1.5 block text-[12px] font-semibold text-[var(--app-text-70)]">
                                      Link da aula
                                    </label>
                                    <input
                                      type="url"
                                      inputMode="url"
                                      placeholder="https://meet.google.com/..."
                                      value={experimentalLessonLinkDraft}
                                      onChange={(e) =>
                                        setExpLessonLinkDraftByLeadId((prev) => ({
                                          ...prev,
                                          [sl.id]: e.target.value,
                                        }))
                                      }
                                      className="w-full min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3 text-[13px] font-semibold text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] transition focus:border-[var(--app-border-strong)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                                      disabled={expSavingLessonLink || experimentalLockedProf}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleSaveLessonLinkExperimental(sl)}
                                    disabled={expLessonLinkSaveDisabled}
                                    className="inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[600px]:w-auto disabled:cursor-not-allowed disabled:opacity-55"
                                  >
                                    {expSavingLessonLink ? (
                                      <>
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                        Salvando...
                                      </>
                                    ) : (
                                      <>
                                        <Save className="h-4 w-4 shrink-0" />
                                        {expSavedLink ? "Atualizar" : "Salvar"}
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                            <div className="flex items-center gap-2">
                              <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                              <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                                Aula experimental
                              </div>
                            </div>
                            <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3 text-center">
                              <div className="text-[13px] font-semibold text-[var(--app-text-60)]">
                                Esse registro não possuí agendamentos em aberto.
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  {/* ============== HISTÓRICO ============== */}
                  {activeTab === "historico" ? (
                    <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3 text-center">
                      <div className="text-[13px] font-semibold text-[var(--app-text-60)]">
                        Esse registro ainda não possui nenhum contrato de matrícula assinado.
                      </div>
                    </div>
                  ) : null}

                  {/* ============== OBSERVAÇÕES ============== */}
                  {activeTab === "observacoes" ? (
                    <div className="w-full">
                      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Pencil className="h-5 w-5 text-[var(--app-text-70)]" />
                            <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                              Observações internas
                            </div>
                          </div>
                        </div>
                        <textarea
                          value={observacoesDraft}
                          onChange={(e) => setObservacoesDraft(e.target.value)}
                          rows={10}
                          placeholder="Adicione anotações sobre esse registro (só visíveis para o atendimento)..."
                          className="mt-4 min-h-[160px] w-full rounded-xl border border-[var(--app-border)] !bg-[var(--app-solid-surface-2)] px-4 py-3 text-[14px] font-medium leading-relaxed text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none resize-none"
                        />
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleSaveObservacoes()}
                            disabled={observacoesSaving || observacoesDraft === String((sl as any).internal_notes ?? "").trim()}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {observacoesSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                            Salvar observações
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            );
          })()}
        </section>
      </div>

      {/* =========================================================================
          MODAL MOBILE: Detalhe do registro (abre ao clicar em item da lista!)
          Desktop (≥1201px): NUNCA ABRE (section esta visivel do lado esquerdo!)
          ========================================================================= */}
      <AppModal
        open={showMobileLeadModal}
        onClose={() => setShowMobileLeadModal(false)}
        size="xl"
        fullScreenOnMobile={true}
        position="center"
        zIndexClass="z-[400]"
      >
        {/* Renderiza o MESMO conteúdo da section desktop! (via callback identico, não duplicado de propósito) */}
        {(() => {
          if (!selectedLead) {
            return (
              <div className="flex min-h-[420px] w-full items-center justify-center">
                <div className="text-center px-6 max-w-md">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                    <UserRound className="h-6 w-6 text-[#9a3412]" />
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-[var(--app-text-85)]">
                    Selecione um registro
                  </h3>
                  <p className="mt-2 text-[13px] text-[var(--app-text-60)]">
                    Clique em qualquer registro na lista para ver os detalhes, agendamentos, link de matrícula e mais.
                  </p>
                </div>
              </div>
            );
          }
          const sl = selectedLead;
          const statusMeta = buildRecurringMetaForVisaoGeral(sl);
          const expMeta = buildExperimentalMetaForList(sl);
          return (
            <div className="h-full max-h-full overflow-auto flex w-full flex-col gap-0">
              {/* HEADER DO LEAD — MODAL MOBILE */}
              <div className="flex shrink-0 flex-col gap-4 pt-1">
                {/* MOBILE (< sm): X no CANTO SUPERIOR DIREITO (layout centralizado) */}
                <div className="flex sm:hidden shrink-0 items-start justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLeadId(null);
                      setShowMobileLeadModal(false);
                    }}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                    aria-label="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* MOBILE (< sm): CONTEÚDO CENTRALIZADO. DESKTOP (sm+): layout lateral original */}
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-col items-center gap-4 text-center min-w-0 sm:flex-row sm:items-start sm:justify-start sm:text-left">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-active)] text-[22px] font-semibold text-[#9a3412] sm:h-16 sm:w-16 sm:text-[22px] sm:rounded-full">
                      {buildInitials(sl.full_name)}
                    </div>
                    <div className="min-w-0 flex-1 w-full">
                      <h2 className="truncate text-[20px] font-bold leading-tight text-[var(--app-text-85)] sm:text-[22px]">
                        {sl.full_name?.trim() || "Sem nome"}
                      </h2>
                      <div className="mt-2 flex flex-col items-center justify-center gap-2 sm:flex-row sm:items-center sm:justify-start sm:flex-wrap">
                        <span className="truncate text-[13px] font-semibold text-[var(--app-text-80)] sm:text-[14px]">
                          📞 {sl.phone?.trim() ? applyPhoneMask(sl.phone) : "Sem telefone"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyPhone(sl)}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 text-[11px] font-semibold text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copiar
                        </button>
                      </div>
                      <div className="mt-1 text-[13px] font-medium text-[var(--app-text-60)] sm:text-[14px] sm:font-semibold">
                        Criado em: {formatAtendimentoDateTime(sl.created_at)}
                      </div>
                    </div>
                  </div>

                  {/* MOBILE (< sm): botões Editar/Excluir OCUPAM TUDO centralizados lado a lado (X já tá no topo direito!) */}
                  {/* DESKTOP (sm+): 3 botões Editar/Excluir/X lado a lado normal */}
                  <div className="flex w-full shrink-0 items-center justify-center gap-2 sm:justify-end overflow-x-auto overflow-y-visible overscroll-contain sm:w-auto sm:overflow-visible">
                    <button
                      type="button"
                      onClick={() => handleOpenEditSelected()}
                      className="inline-flex h-10 shrink-0 flex-1 sm:flex-none items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] sm:flex-none"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSelected()}
                      disabled={deletingSelectedLoading}
                      className="inline-flex h-10 shrink-0 flex-1 sm:flex-none items-center justify-center gap-2 rounded-full transition-all bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none px-4 text-[13px] font-semibold disabled:opacity-60"
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </button>
                    {/* X só visível em DESKTOP (sm+). No mobile já tá no topo direito! */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLeadId(null);
                        setShowMobileLeadModal(false);
                      }}
                      className="hidden sm:inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                      aria-label="Fechar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* TABS — MODAL MOBILE (shrink-0 sempre fixo) */}
              {/*
                  MOBILE (< sm): SEGMENTED CONTROL (pills com 4 abas lado a lado),
                  SEM setas, SEM overlap, SEM overflow-x — bonito, centralizado, responsivo.
                  DESKTOP (sm+): scroll horizontal com setas laranjas overlap (mantém anterior).
              */}
              <div className="mt-6 border-b border-[var(--app-border)] shrink-0 relative px-4 py-3 sm:px-0 sm:py-0">
                {/* MOBILE (< sm): segmented control SÓ ÍCONES (sem label, economiza espaço) */}
                <div className="flex sm:hidden w-full items-center gap-1.5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] p-1.5">
                  {LEAD_DETAILS_TABS.map((tab) => {
                    const isActive = tab.id === activeTab;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                          "group inline-flex min-h-[40px] min-w-0 flex-1 shrink-0 items-center justify-center rounded-xl transition-all",
                          isActive
                            ? "bg-[var(--app-solid-surface)] text-[#9a3412] shadow-sm ring-1 ring-[var(--app-border)]"
                            : "bg-transparent text-[var(--app-text-60)] hover:text-[var(--app-text-85)]",
                        ].join(" ")}
                        title={tab.label}
                        aria-label={tab.label}
                      >
                        <span className="shrink-0">{tab.icon}</span>
                      </button>
                    );
                  })}
                </div>

                {/* DESKTOP (sm+): setas overlap + scroll horizontal */}
                <div className="hidden sm:block">
                  {mobileTabsCanLeft ? (
                    <button
                      type="button"
                      onClick={() => scrollTabsBy(tabsScrollMobileRef.current, -1, setMobileTabsCanLeft, setMobileTabsCanRight)}
                      className="absolute left-0 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 shrink-0 items-center justify-center rounded-full transition-all bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none shadow-[0_0_0_6px_var(--app-solid-surface)] disabled:opacity-60"
                      aria-label="Tabs anteriores"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  ) : null}
                  {mobileTabsCanRight ? (
                    <button
                      type="button"
                      onClick={() => scrollTabsBy(tabsScrollMobileRef.current, +1, setMobileTabsCanLeft, setMobileTabsCanRight)}
                      className="absolute right-0 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 shrink-0 items-center justify-center rounded-full transition-all bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none shadow-[0_0_0_6px_var(--app-solid-surface)] disabled:opacity-60"
                      aria-label="Próximas tabs"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : null}
                  <div
                    ref={tabsScrollMobileRef}
                    onScroll={(e) => updateTabsArrowsState(e.currentTarget as HTMLDivElement, setMobileTabsCanLeft, setMobileTabsCanRight)}
                    className="-mb-px flex items-center gap-5 sm:gap-6 overflow-x-auto scrollbar-hide px-4"
                  >
                    {LEAD_DETAILS_TABS.map((tab) => {
                      const isActive = tab.id === activeTab;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={[
                            "group inline-flex shrink-0 items-center gap-2 border-b-2 px-1 pb-4 text-[13px] font-semibold transition-colors sm:text-[14px]",
                            isActive
                              ? "border-[#ea580c] !text-[#9a3412]"
                              : "border-transparent text-[var(--app-text-60)] hover:text-[var(--app-text-85)]",
                          ].join(" ")}
                        >
                          {tab.icon}
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* CONTEUDO TABS — MODAL MOBILE: scroll natural dentro do panel (overflow-y-auto do AppModal fullscreen!) */}
              <div className="flex-1 min-h-0 pt-6">
                {/* ============== VISÃO GERAL ============== */}
                {activeTab === "visao_geral" ? (
                  <div className="grid w-full grid-cols-1 gap-4">
                    {/* CARD 1: Informações */}
                    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <UserRound className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Informações
                          </div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3.5 text-[12px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {[
                          { label: "Cidade", value: (sl as any).city ?? null },
                          { label: "Estado", value: (sl as any).state ?? null },
                          { label: "País", value: (sl as any).country ?? null },
                          { label: "Fuso horário", value: deriveLeadEffectiveTimeZone(sl) ?? null },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                              {label}
                            </div>
                            <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                              {value || "-"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* CARD 2: Link de Matrícula */}
                    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ExternalLink className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Link de Matrícula
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleOpenEditSenha}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3.5 text-[12px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar senha
                        </button>
                      </div>
                      <div className="mt-4">
                        <div className="relative overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] pr-12">
                          <div className="min-h-[44px] w-full truncate px-4 py-3 text-[13px] font-semibold text-[var(--app-text-85)]">
                            {buildRecurringClassUrl(sl)}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyMatriculaLink(sl)}
                            className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-[var(--app-solid-surface)] border border-[var(--app-border)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)]"
                            aria-label="Copiar link"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => handleOpenMatriculaLink(sl)}
                          className={[
                            "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold !text-white shadow-none transition",
                            isLeadMatriculaConcluida(sl)
                              ? "bg-sky-600 hover:bg-sky-500"
                              : "bg-emerald-600 hover:bg-emerald-500",
                          ].join(" ")}
                        >
                          <ExternalLink className="h-4 w-4" />
                          {isLeadMatriculaConcluida(sl) ? "Abrir painel" : "Abrir matrícula"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyMatriculaLink(sl)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                        >
                          <Copy className="h-4 w-4" />
                          Copiar link
                        </button>
                      </div>
                    </div>

                    {/* CARD 3: Status */}
                    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 text-[var(--app-text-70)]">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                            <path d="M3 3v18h18" />
                            <path d="M7 14l4-4 4 4 5-5" />
                          </svg>
                        </div>
                        <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                          Status
                        </div>
                      </div>
                      {!statusMeta ? (
                        <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-3">
                          <div className="font-semibold text-emerald-800">
                            Dados básicos coletados
                          </div>
                          <div className="mt-0.5 text-[13px] text-emerald-700/90">
                            Nenhum passo pendente nessa etapa.
                          </div>
                        </div>
                      ) : statusMeta.tone === "success" ? (
                        <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-3">
                          <div className="font-semibold text-emerald-800">
                            {statusMeta.title}
                          </div>
                          <div className="mt-0.5 text-[13px] text-emerald-700/90">
                            {statusMeta.body}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-[rgba(234,88,12,0.35)] bg-[rgba(234,88,12,0.14)] px-4 py-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ea580c]/20">
                              <AlertCircle className="h-5 w-5 text-[#9a3412]" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold !text-[#9a3412]">
                                {statusMeta.title}
                              </div>
                              <div className="mt-0.5 text-[13px] text-[#9a3412]/80">
                                {statusMeta.body}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* CARD 4: Próxima aula */}
                    <div className={
                      "overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none transition-opacity " +
                      (bookingLocationOk
                        ? ""
                        : "opacity-50 pointer-events-none select-none cursor-not-allowed")
                    }>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Próxima aula
                          </div>
                        </div>
                        {(() => {
                          const lead = selectedLead as any;
                          const hasExp = Boolean(
                            lead?.future_experimental_class_booking ||
                              lead?.experimental_class_booking ||
                              String(lead?.experimental_class_lead_date ?? "").trim() ||
                              String(lead?.experimental_class_lead_time ?? "").trim()
                          );
                          const weekdayRaw = String(lead?.recurring_weekday ?? "").trim();
                          const timeRaw = String(lead?.recurring_start_time ?? "").trim();
                          const freqRaw = String(lead?.recurring_frequency ?? "").trim();
                          const hasRec = Boolean(weekdayRaw || timeRaw || freqRaw);
                          const isExpFirst = !hasRec && hasExp;
                          const isRecFirst = hasRec && !hasExp;
                          if (isExpFirst) return (
                            <div className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                              Experimental
                            </div>
                          );
                          if (isRecFirst) return (
                            <div className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-[#ea580c]/30 bg-[rgba(234,88,12,0.12)] px-3 text-[11px] font-bold uppercase tracking-wide text-[#9a3412]">
                              Recorrente
                            </div>
                          );
                          if (hasExp && hasRec) return (
                            <div className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                              Experimental
                            </div>
                          );
                          return null;
                        })()}
                      </div>
                      {expMeta.tone === "success" ? (
                        <>
                          {(() => {
                            const bk = (selectedLead as any)?.experimental_class_booking;
                            const cancelled = String(bk?.status ?? "").trim().toLowerCase() === "cancelled";
                            return cancelled ? (
                              <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3">
                                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-700">
                                  <CalendarIcon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-red-800 truncate">
                                    {(() => {
                                      const label = String(expMeta.label ?? "").trim();
                                      if (!label) return "Aula cancelada";
                                      if (label.toLowerCase().startsWith("aula em:")) {
                                        return "Aula cancelada em:" + label.slice("aula em:".length);
                                      }
                                      return label.replace(/^Aula em:\s*/i, "Aula cancelada em: ");
                                    })()}
                                  </div>
                                  <div className="mt-0.5 text-[13px] text-red-700/80">
                                    Horário cancelado.
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
                                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-700">
                                  <CalendarIcon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-emerald-800 truncate">
                                    {expMeta.label}
                                  </div>
                                  <div className="mt-0.5 text-[13px] text-emerald-700/80">
                                    Horário confirmado para o registro.
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {(() => {
                            const sl = selectedLead;
                            const expBestBooking =
                              (sl as any).latest_experimental_class_booking ??
                              (sl as any).experimental_class_booking ??
                              (sl as any).future_experimental_class_booking;
                            const bk = expBestBooking as any;
                            const expEffectiveStatus =
                              String(bk?.status ?? (sl as any).experimental_class_booking_status ?? (sl as any).experimental_class_status ?? "").trim().toLowerCase();
                            const cancelled = expEffectiveStatus === "cancelled";
                            return (
                          <div className="mt-4 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenExpInfo(selectedLead)}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55"
                              disabled={cancelled}
                              title={cancelled ? "Agendamento cancelado." : undefined}
                            >
                              <Info className="h-4 w-4" />
                              Mais informações
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenExperimentalBooking(selectedLead)}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55"
                              disabled={cancelled}
                              title={cancelled ? "Agendamento cancelado. Não é possível reagendar." : undefined}
                            >
                              <Plus className="h-4 w-4" />
                              Reagendar
                            </button>
                          </div>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-solid-surface)] border border-[var(--app-border)] text-[var(--app-text-70)]">
                              <CalendarIcon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-[var(--app-text-85)]">
                                Nenhuma aula agendada
                              </div>
                              <div className="mt-0.5 text-[13px] text-[var(--app-text-60)]">
                                Este registro ainda não possui aulas agendadas.
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleOpenExperimentalBooking(selectedLead)}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                            >
                              <Plus className="h-4 w-4" />
                              Agendar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* ============== AGENDAMENTOS ============== */}
                {activeTab === "agendamentos" ? (
                  <div className="grid w-full grid-cols-1 gap-4">
                    {(() => {
                      if (showRecurringCard) {
                        return (
                          <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                            <div className="flex items-center gap-2">
                              <RefreshCw className="h-5 w-5 text-[var(--app-text-70)]" />
                              <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                                Aulas recorrentes
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Dia</div>
                                <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                  {String((sl as any).recurring_class_weekday_label ?? (sl as any).recurring_class_weekday ?? "-").trim() || "-"}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Horário</div>
                                <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                  {String((sl as any).recurring_class_professor_time ?? (sl as any).recurring_class_lead_time ?? "-").trim() || "-"}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Status</div>
                                <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                  {String((sl as any).recurring_class_status ?? "-").trim() || "-"}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">Etapa</div>
                                <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                                  Passo {Number((sl as any).recurring_registration_step ?? 0) || "-"}/12
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      const expTone = buildExperimentalMetaForList(sl).tone;
                      if (expTone === "success") {
                        const expAssigned = experimentalAssignedProfessorForLead(sl);
                        const expSavedLink = experimentalLessonLinkForLead(sl);
                        const expHasPhone = Boolean(String(sl?.phone ?? "").trim());
                        const expBestBooking =
                          (sl as any).latest_experimental_class_booking ??
                          (sl as any).experimental_class_booking ??
                          (sl as any).future_experimental_class_booking;
                        const bk = expBestBooking as any;
                        const expEffectiveAttendance =
                          String(bk?.attendance_status ?? (sl as any).experimental_class_attendance_status ?? "").trim();
                        const expEffectiveStatus =
                          String(bk?.status ?? (sl as any).experimental_class_booking_status ?? (sl as any).experimental_class_status ?? "").trim().toLowerCase();
                        const expClassJaPassou = isExperimentalClassPast(sl);
                        const expDisparoJaFoiFeito = experimentalHasAnyDisparoConcluido(sl);
                        const expHasAttendanceStatus = Boolean(expEffectiveAttendance) || expDisparoJaFoiFeito || (expClassJaPassou && experimentalLockedProf);
                          // ============================================================
                          // REGRA ALTERADA (user: 'podera sim!' 2026-09-29):
                          //   Aula experimental cancelada agora PODE ser editada,
                          //   reagendada, professor pode ser alterado, link pode ser
                          //   salvo, disparo pode ser refeito etc.
                          //
                          //   BLOQUEIOS QUE PERMANECEM (igual ao backend):
                          //     · expHasAttendanceStatus (attendance attended/no_show OU
                          //       disparo feito OU classe passou + lockedProf)
                          //
                          //   BLOQUEIOS REMOVIDOS (agora são permitidos quando
                          //   cancelada):
                          //     · Reagendar (botão Reagendar)
                          //     · Alterar professor (botão Selecionar professor /
                          //       dropdown)
                          //     · Salvar link da aula (experimental)
                          //     · Disparar (expCanSendDisparo / expCanShowDisparar)
                          // ============================================================
                          const expBookingIsCancelled = expEffectiveStatus === "cancelled";
                          // expCanShowDisparar / expCanSendDisparo: remove a condicao
                          // expBookingIsCancelled → agora mostra dispara mesmo se
                          // cancelada (pois reagendamento sera feito e o lead precisa
                          // receber as notificacoes).
                          const expCanShowDisparar = !experimentalHasAnyDisparoConcluido(sl);
                          const expCanSendDisparo = Boolean(expAssigned && expSavedLink && expHasPhone && !expSendingNotification && !experimentalLockedProf);
                          const expLessonLinkSaveDisabled = (() => {
                            const d = experimentalLessonLinkDraft.trim();
                            if (!d && !expSavedLink) return true;
                            if (d === expSavedLink) return true;
                            // Removido: expBookingIsCancelled.
                            if (expSavingLessonLink || experimentalLockedProf) return true;
                            return false;
                          })();
                        return (
                          <div className="relative overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex items-center gap-2 shrink-0 min-w-[190px] max-w-full min-[1201px]:self-center">
                                <CalendarIcon className="h-5 w-5 shrink-0 text-[var(--app-text-70)]" />
                                <div className="text-[15px] font-bold text-[var(--app-text-85)] truncate">
                                  Aula experimental
                                </div>
                              </div>
                              <div className="flex flex-wrap items-stretch justify-start sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto min-w-0 sm:mt-0 mt-6">
                                {expCanShowDisparar ? (
                                  <div className="flex w-full sm:w-auto shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => void handleSendStudentNotificationExperimental(sl)}
                                      disabled={!expCanSendDisparo}
                                      title={(() => {
                                        if (!expSavedLink && !expAssigned) {
                                          return "Adicione o link da aula e selecione o professor antes de disparar.";
                                        }
                                        if (!expSavedLink) {
                                          return "Adicione o link da aula experimental antes de disparar a notificação.";
                                        }
                                        if (!expAssigned) {
                                          return "Selecione o professor responsável antes de disparar.";
                                        }
                                        if (!expHasPhone) {
                                          return "Registro não possui telefone cadastrado para receber a notificação.";
                                        }
                                        return "Disparar notificações agora.";
                                      })()}
                                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl transition-all bg-[var(--app-btn-primary-bg)] px-5 text-[13px] font-semibold !text-[var(--app-btn-primary-fg)] shadow-none disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                                    >
                                      <Zap className="h-4 w-4 shrink-0" />
                                      {expSendingNotification ? "Disparando..." : "Disparar"}
                                    </button>
                                  </div>
                                ) : null}
                                {expHasAttendanceStatus ? (
                                  <div className="hidden sm:flex shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => void handleSendExperimentalPostAttendanceMessage(sl)}
                                      disabled={Boolean(expSendingPostAttendanceId) || Boolean((sl as any)?.experimental_class_post_attendance_message_sent_at || (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at) || !expHasPhone}
                                      title={(() => {
                                        const alreadySent = Boolean(
                                          (sl as any)?.experimental_class_post_attendance_message_sent_at ||
                                            (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at,
                                        );
                                        if (expSendingPostAttendanceId) {
                                          return "Enviando a mensagem de matrícula para este registro.";
                                        }
                                        if (alreadySent) {
                                          return "A mensagem de matrícula já foi enviada para este registro.";
                                        }
                                        if (!expHasPhone) {
                                          return "Registro não possui telefone cadastrado para receber a mensagem de matrícula.";
                                        }
                                        return "Enviar a mensagem de matrícula para o aluno após a aula experimental.";
                                      })()}
                                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                    >
                                      {expSendingPostAttendanceId ? (
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                      ) : (
                                        <Check className="h-4 w-4 shrink-0 text-emerald-700" />
                                      )}
                                    </button>
                                  </div>
                                ) : null}
                                <div className="flex w-full sm:w-auto shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenExperimentalBooking(sl)}
                                    disabled={(() => {
                                        if (expBookingIsCancelled) return true;
                                        if (Boolean(expEffectiveAttendance)) return true;
                                        return false;
                                      })()}
                                      title={(() => {
                                        if (expBookingIsCancelled) {
                                          return "Aula experimental cancelada. Não é possível reagendar.";
                                        }
                                        if (Boolean(expEffectiveAttendance)) {
                                          return "Aula experimental não pode ser reagendada após comparecimento marcado.";
                                        }
                                        return "Reagendar esta aula experimental.";
                                      })()}
                                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                                  >
                                    <Plus className="h-4 w-4" />
                                    Reagendar
                                  </button>
                                </div>
                                <div className="relative w-full sm:w-auto shrink-0 sm:shrink sm:max-w-[320px]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (experimentalLockedProf) {
                                      if (expHasAttendanceStatus) {
                                        modalToast.warning("Professor não pode ser alterado após comparecimento marcado.");
                                      } else if (expBookingIsCancelled) {
                                        modalToast.warning("Professor não pode ser alterado após a aula experimental ser cancelada.");
                                      } else {
                                        modalToast.warning("Professor não pode ser alterado após o disparo ser realizado.");
                                      }
                                      return;
                                    }
                                    setExpAssignProfDropdownOpen((v) => !v);
                                  }}
                                  onBlur={() => {
                                    setTimeout(() => setExpAssignProfDropdownOpen(false), 180);
                                  }}
                                  disabled={expAssigningProfessor || experimentalLockedProf}
                                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                                  title={(() => {
                                    if (experimentalLockedProf) {
                                      if (expHasAttendanceStatus) {
                                        return "Professor não pode ser alterado após comparecimento marcado.";
                                      } else if (expBookingIsCancelled) {
                                        return "Professor não pode ser alterado após a aula experimental ser cancelada.";
                                      }
                                      return "Professor não pode ser alterado após o disparo ser realizado.";
                                    }
                                    return expAssigned
                                      ? `Professor vinculado: ${expAssigned.name}`
                                      : "Selecionar professor responsável pela aula experimental";
                                  })()}
                                >
                                  {expAssigningProfessor ? (
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--app-text-65)]" />
                                  )}
                                  <span className="truncate">
                                    {expAssigned
                                      ? `${expAssigned.name}`
                                      : "Selecionar professor"}
                                  </span>
                                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--app-text-65)]" />
                                </button>
                                {expAssignProfDropdownOpen ? (
                                  <div className="absolute right-0 top-full z-[380] mt-2 flex w-[300px] flex-col gap-1 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-1.5 shadow-lg">
                                    {EXPERIMENTAL_PROFESSOR_OPTIONS_CLIENT.map((opt) => {
                                      const isActive = expAssigned?.phone === opt.phone && expAssigned?.name === opt.name;
                                      const optionDisabled = expAssigningProfessor || experimentalLockedProf;
                                      return (
                                        <button
                                          key={opt.phone}
                                          type="button"
                                          disabled={optionDisabled}
                                          onClick={() => {
                                            if (experimentalLockedProf) {
                                              if (expHasAttendanceStatus) {
                                                modalToast.warning("Professor não pode ser alterado após comparecimento marcado.");
                                              } else if (expBookingIsCancelled) {
                                                modalToast.warning("Professor não pode ser alterado após a aula experimental ser cancelada.");
                                              } else {
                                                modalToast.warning("Professor não pode ser alterado após o disparo ser realizado.");
                                              }
                                              setExpAssignProfDropdownOpen(false);
                                              return;
                                            }
                                            setExpAssignProfDropdownOpen(false);
                                            void handleAssignProfessorExperimental(sl, { name: opt.name, phone: opt.phone });
                                          }}
                                          className={[
                                            "flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition",
                                            isActive
                                              ? "border border-emerald-500/30 bg-emerald-500/10"
                                              : "border border-transparent hover:bg-[var(--app-hover)]",
                                            "disabled:cursor-not-allowed disabled:opacity-55",
                                          ].join(" ")}
                                          title={
                                            experimentalLockedProf
                                              ? expHasAttendanceStatus
                                                ? "Professor não pode ser alterado após comparecimento marcado."
                                                : expBookingIsCancelled
                                                  ? "Professor não pode ser alterado após a aula experimental ser cancelada."
                                                  : "Professor não pode ser alterado após o disparo ser realizado."
                                              : ""
                                          }
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate text-[13px] font-semibold text-[var(--app-text-85)]">
                                              {opt.name}
                                            </div>
                                          </div>
                                          {isActive ? (
                                            <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                                              <Check className="h-3 w-3 shrink-0" />
                                              Atual
                                            </div>
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                                <button
                                  type="button"
                                  onClick={() => void handleCancelExperimentalBooking(sl)}
                                  disabled={(() => {
                                    if (expCancellingBookingId === String(bk?.id ?? "").trim()) return true;
                                    if (expBookingIsCancelled) return true;
                                    if (expHasAttendanceStatus) return true;
                                    if (experimentalLockedProf) return true;
                                    if (!expAssigned) return true;
                                    return false;
                                  })()}
                                  title={(() => {
                                    if (expBookingIsCancelled) {
                                      return "Agendamento já foi cancelado.";
                                    }
                                    if (expHasAttendanceStatus) {
                                      return "Agendamento não pode ser cancelado após comparecimento marcado.";
                                    }
                                    if (experimentalLockedProf) {
                                      return "Agendamento não pode ser cancelado após o disparo ser realizado.";
                                    }
                                    if (!expAssigned) {
                                      return "Selecione o professor responsável antes de cancelar o agendamento.";
                                    }
                                    if (expCancellingBookingId === String(bk?.id ?? "").trim()) {
                                      return "Cancelando agendamento...";
                                    }
                                    return "Cancelar este agendamento de aula experimental.";
                                  })()}
                                  className="hidden sm:inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  {expCancellingBookingId === String(bk?.id ?? "").trim() ? (
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                  ) : (
                                    <X className="h-4 w-4 shrink-0" />
                                  )}
                                </button>
                              </div>
                              <div className="flex sm:hidden absolute top-5 right-5 z-10 items-center gap-2">
                                {expHasAttendanceStatus ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleSendExperimentalPostAttendanceMessage(sl)}
                                    disabled={Boolean(expSendingPostAttendanceId) || Boolean((sl as any)?.experimental_class_post_attendance_message_sent_at || (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at) || !expHasPhone}
                                    title={(() => {
                                      const alreadySent = Boolean(
                                        (sl as any)?.experimental_class_post_attendance_message_sent_at ||
                                          (sl as any)?.experimental_class_booking?.post_attendance_message_sent_at,
                                      );
                                      if (expSendingPostAttendanceId) {
                                        return "Enviando a mensagem de matrícula para este registro.";
                                      }
                                      if (alreadySent) {
                                        return "A mensagem de matrícula já foi enviada para este registro.";
                                      }
                                      if (!expHasPhone) {
                                        return "Registro não possui telefone cadastrado para receber a mensagem de matrícula.";
                                      }
                                      return "Enviar a mensagem de matrícula para o aluno após a aula experimental.";
                                    })()}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                  >
                                    {expSendingPostAttendanceId ? (
                                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                    ) : (
                                      <Check className="h-4 w-4 shrink-0 text-emerald-700" />
                                    )}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void handleCancelExperimentalBooking(sl)}
                                  disabled={(() => {
                                    if (expCancellingBookingId === String(bk?.id ?? "").trim()) return true;
                                    if (expBookingIsCancelled) return true;
                                    if (expHasAttendanceStatus) return true;
                                    if (experimentalLockedProf) return true;
                                    if (!expAssigned) return true;
                                    return false;
                                  })()}
                                  title={(() => {
                                    if (expBookingIsCancelled) {
                                      return "Agendamento já foi cancelado.";
                                    }
                                    if (expHasAttendanceStatus) {
                                      return "Agendamento não pode ser cancelado após comparecimento marcado.";
                                    }
                                    if (experimentalLockedProf) {
                                      return "Agendamento não pode ser cancelado após o disparo ser realizado.";
                                    }
                                    if (!expAssigned) {
                                      return "Selecione o professor responsável antes de cancelar o agendamento.";
                                    }
                                    if (expCancellingBookingId === String(bk?.id ?? "").trim()) {
                                      return "Cancelando agendamento...";
                                    }
                                    return "Cancelar este agendamento de aula experimental.";
                                  })()}
                                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  {expCancellingBookingId === String(bk?.id ?? "").trim() ? (
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                  ) : (
                                    <X className="h-4 w-4 shrink-0" />
                                  )}
                                </button>
                              </div>
                            </div>
                            {!expAssigned ? (
                              <div className="mt-3 flex sm:hidden min-w-0 items-center gap-2">
                                <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  Escolha o professor
                                </div>
                              </div>
                            ) : null}
                            {expBookingIsCancelled ? (
                              <div className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3">
                                <div className="text-[13px] font-semibold text-red-800">
                                  {(() => {
                                    const label = String(buildExperimentalMetaForList(sl).label ?? "").trim();
                                    if (!label) return "Aula cancelada";
                                    if (label.toLowerCase().startsWith("aula em:")) {
                                      return "Aula cancelada em:" + label.slice("aula em:".length);
                                    }
                                    return label.replace(/^Aula em:\s*/i, "Aula cancelada em: ");
                                  })()}
                                </div>
                                <div className="mt-1 text-[12px] text-red-700/80">
                                  Horário cancelado.
                                </div>
                              </div>
                            ) : (
                              <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3">
                                <div className="text-[13px] font-semibold text-[var(--app-text-85)]">
                                  {buildExperimentalMetaForList(sl).label}
                                </div>
                                <div className="mt-1 text-[12px] text-[var(--app-text-60)]">
                                  Horário definido para esse registro.
                                </div>
                              </div>
                            )}

                            <div className="mt-5">
                              <div className="flex flex-col items-stretch gap-3 min-[600px]:flex-row min-[600px]:items-end">
                                <div className="min-w-0 flex-1">
                                  <label className="mb-1.5 block text-[12px] font-semibold text-[var(--app-text-70)]">
                                    Link da aula
                                  </label>
                                  <input
                                    type="url"
                                    inputMode="url"
                                    placeholder="https://meet.google.com/..."
                                    value={experimentalLessonLinkDraft}
                                    onChange={(e) =>
                                      setExpLessonLinkDraftByLeadId((prev) => ({
                                        ...prev,
                                        [sl.id]: e.target.value,
                                      }))
                                    }
                                    className="w-full min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3 text-[13px] font-semibold text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] transition focus:border-[var(--app-border-strong)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                                    disabled={expSavingLessonLink || experimentalLockedProf}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveLessonLinkExperimental(sl)}
                                  disabled={expLessonLinkSaveDisabled}
                                  className="inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] min-[600px]:w-auto disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  {expSavingLessonLink ? (
                                    <>
                                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                      Salvando...
                                    </>
                                  ) : (
                                    <>
                                      <Save className="h-4 w-4 shrink-0" />
                                      {expSavedLink ? "Atualizar" : "Salvar"}
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                            <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                              Aula experimental
                            </div>
                          </div>
                          <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3 text-center">
                            <div className="text-[13px] font-semibold text-[var(--app-text-60)]">
                              Esse registro não possuí agendamentos em aberto.
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}

                {/* ============== HISTÓRICO ============== */}
                {activeTab === "historico" ? (
                  <div className="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 text-center shadow-none">
                    <div className="text-[13px] text-[var(--app-text-60)]">
                      Contrato de matrícula do aluno — em integração.
                    </div>
                  </div>
                ) : null}

                {/* ============== OBSERVAÇÕES ============== */}
                {activeTab === "observacoes" ? (
                  <div className="w-full">
                    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Pencil className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Observações internas
                          </div>
                        </div>
                      </div>
                      <textarea
                        value={observacoesDraft}
                        onChange={(e) => setObservacoesDraft(e.target.value)}
                        rows={10}
                        placeholder="Adicione anotações sobre esse registro (só visíveis para o atendimento)..."
                        className="mt-4 min-h-[160px] w-full rounded-xl border border-[var(--app-border)] !bg-[var(--app-solid-surface-2)] px-4 py-3 text-[14px] font-medium leading-relaxed text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none resize-none"
                      />
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleSaveObservacoes()}
                          disabled={observacoesSaving || observacoesDraft === String((sl as any).internal_notes ?? "").trim()}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {observacoesSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                          Salvar observações
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })()}
      </AppModal>

      {/* Modal Criar Lead (placeholder para próxima etapa) */}
      {renderCreateLeadModal()}

      {/* Modal Legenda Cores dos avatares (clicou no ícone Info ao lado do bot do bot) */}
      {renderColorLegendModal()}

      {/* Modal Editar Lead (clicou no botão Editar no header) */}
      {renderEditLeadModal()}

      {/* Modal Editar LOCALIZAÇÃO (clicou no botão Editar DENTRO do card Informações — SÓ Cidade + Estado) */}
      {renderEditLocationModal()}

      {/* MODAL MÉTRICAS: Resumo dos registros (clicou no ícone BarChart3 no header) */}
      {renderMetricsModal()}

      {/* MODAL FILTROS AVANCADOS: Clicou no ícone SlidersHorizontal (ao lado ESQUERDO do Bot!) */}
      {renderFiltersModal()}

      {/* Modal Agendar / Reagendar aula experimental */}
      <AppModal
        open={isEditExperimentalOpen}
        onClose={handleCloseExperimentalBooking}
        size="md"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
        closeOnBackdrop={savingExperimentalLeadId === null}
        closeOnEscape={savingExperimentalLeadId === null}
      >
        <div className="flex w-full flex-col gap-0">
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <CalendarIcon className="h-5 w-5 text-[#9a3412]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  {editingExperimentalLead && (editingExperimentalLead as any)?.experimental_class_booking?.status === "scheduled"
                    ? "Reagendamento de aula"
                    : "Agendamento de aula"}
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Selecione dia e horário para a aula.
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={savingExperimentalLeadId !== null}
              onClick={handleCloseExperimentalBooking}
              aria-label="Fechar"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {loadingExperimentalAvailability ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-8 text-[13px] text-[var(--app-text-70)]">
                <Loader2 className="h-4 w-4 animate-spin text-[#ea580c]" />
                Carregando disponibilidade...
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold text-[var(--app-text-70)]">
                      Dias disponíveis
                      {experimentalAvailability?.dates?.length ? (
                        <span className="ml-2 font-normal text-[var(--app-text-45)]">
                          ({String(experimentalAvailability.dates.length)})
                        </span>
                      ) : null}
                    </label>
                    <div className="text-[11px] font-medium text-[var(--app-text-55)]">
                      Fuso horário: {String(experimentalAvailability?.lead_timezone ?? ATENDIMENTO_PROFESSOR_TIME_ZONE)}
                    </div>
                  </div>

                  {!experimentalAvailability?.dates?.length ? (
                    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-6 text-[13px] text-[var(--app-text-55)]">
                      No momento, não há dias disponíveis para aula experimental até o fim do mês atual.
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
                        const dateRaw = String(dateOption?.professorDate ?? dateId ?? "").slice(0, 10);
                        let weekdayShort = displayLabel
                          ? displayLabel.split(",")[0]?.trim() ?? ""
                          : "";
                        if (!weekdayShort || /^\d+$/.test(weekdayShort.replace(/\s/g, "")) || weekdayShort.length > 4) {
                          try {
                            if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
                              const d = new Date(dateRaw + "T00:00:00");
                              weekdayShort = new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
                                .format(d)
                                .replace(/\./g, "")
                                .slice(0, 3)
                                .toLowerCase();
                              weekdayShort =
                                weekdayShort.charAt(0).toUpperCase() + weekdayShort.slice(1);
                            }
                          } catch {}
                        }
                        if (!weekdayShort) weekdayShort = "Dia";
                        return (
                          <button
                            key={dateId}
                            type="button"
                            onClick={() => {
                              setSelectedExperimentalDateId(dateId);
                              setSelectedExperimentalSlotId(null);
                            }}
                            className={
                              "flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 text-center transition duration-150 " +
                              (isSelected
                                ? "!border-transparent !bg-[#ea580c] !text-white shadow-md"
                                : "border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-85)] hover:border-[#ea580c]/35 hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)]")
                            }
                          >
                            <div className={
                              "text-[11px] uppercase tracking-wide font-semibold " +
                              (isSelected ? "!text-white/95" : "text-[var(--app-text-50)]")
                            }>
                              {weekdayShort}
                            </div>
                            <div className={
                              "text-[20px] font-semibold leading-none " +
                              (isSelected ? "!text-white" : "text-[var(--app-text-92)]")
                            }>
                              {dayLabel}
                            </div>
                            <div className={
                              "text-[10px] font-semibold " +
                              (isSelected ? "!text-white/90" : "text-[var(--app-text-55)]")
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
                  <label className="text-xs font-semibold text-[var(--app-text-70)]">
                    Horários disponíveis
                    {selectedExperimentalDateId ? (
                      <span className="ml-2 font-normal text-[var(--app-text-45)]">
                        (dia selecionado)
                      </span>
                    ) : (
                      <span className="ml-2 font-normal text-[var(--app-text-45)]">
                        (selecione um dia primeiro)
                      </span>
                    )}
                  </label>

                  {!selectedExperimentalDateId ? (
                    <div className="rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-4 text-center text-[13px] text-[var(--app-text-55)]">
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
                          <div className="rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-4 text-center text-[13px] text-[var(--app-text-55)]">
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
                                  "flex h-12 items-center justify-center rounded-2xl border px-2 text-[15px] font-semibold transition duration-150 " +
                                  (isSelected
                                    ? "!border-transparent !bg-[#ea580c] !text-white shadow-md"
                                    : "border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-85)] hover:border-[#ea580c]/35 hover:bg-[var(--app-hover)] hover:text-[var(--app-text-90)]")
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
              </>
            )}

            <div className="mt-2 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleCloseExperimentalBooking}
                disabled={savingExperimentalLeadId !== null}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
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
                onClick={() => void handleSaveExperimentalBooking()}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold !text-white shadow-none hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingExperimentalLeadId !== null ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar aula"
                )}
              </button>
            </div>
          </div>
        </div>
      </AppModal>

      {/* Modal MAIS INFORMAÇÕES: Resumo do agendamento aula experimental (só quando existe) */}
      <AppModal
        open={isExpInfoOpen}
        onClose={handleCloseExpInfo}
        size="md"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
        closeOnBackdrop={true}
        closeOnEscape={true}
      >
        <div className="flex w-full flex-col gap-0">
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <Info className="h-5 w-5 text-[#9a3412]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Agendamento da aula
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Resumo completo do horário marcado para a aula.
                </div>
              </div>
            </div>
            <button
              type="button"
              aria-label="Fechar"
              onClick={handleCloseExpInfo}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {(() => {
              const lead = expInfoLead ?? selectedLead;
              if (!lead) {
                return (
                  <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-6 text-[13px] text-[var(--app-text-55)]">
                    Dados indisponíveis no momento.
                  </div>
                );
              }

              const bookingObj =
                (lead as any)?.future_experimental_class_booking ??
                (lead as any)?.experimental_class_booking ??
                null;
              const bookingStatus = String((bookingObj as any)?.status ?? "").trim().toLowerCase();
              const bookingHasId = Boolean(String((bookingObj as any)?.id ?? "").trim());
              const bookingIsNotDraft =
                bookingHasId &&
                String((bookingObj as any)?.source ?? "draft").trim().toLowerCase() !== "draft";
              const latestCancelledAt = String(
                (lead as any)?.latest_experimental_class_cancelled_at ?? "",
              ).trim();
              const hasLatestCancelledMarker =
                Boolean(latestCancelledAt) && latestCancelledAt !== "null";

              const bookingProfDate =
                bookingObj && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled"
                  ? String((bookingObj as any)?.professor_date ?? "").slice(0, 10).trim()
                  : "";
              const bookingProfTime =
                bookingObj && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled"
                  ? String((bookingObj as any)?.professor_time ?? "").trim()
                  : "";
              const futureBookingProfDate =
                (lead as any)?.future_experimental_class_booking &&
                String(
                  ((lead as any).future_experimental_class_booking as any)?.status ?? "",
                ).trim().toLowerCase() !== "cancelled"
                  ? String(
                      ((lead as any).future_experimental_class_booking as any)?.professor_date ??
                        "",
                    )
                      .slice(0, 10)
                      .trim()
                  : "";
              const futureBookingProfTime =
                (lead as any)?.future_experimental_class_booking &&
                String(
                  ((lead as any).future_experimental_class_booking as any)?.status ?? "",
                ).trim().toLowerCase() !== "cancelled"
                  ? String(
                      ((lead as any).future_experimental_class_booking as any)?.professor_time ??
                        "",
                    ).trim()
                  : "";
              const leadFlatProfDate = hasLatestCancelledMarker
                ? ""
                : String((lead as any)?.experimental_class_professor_date ?? "").slice(0, 10).trim();
              const leadFlatProfTime = hasLatestCancelledMarker
                ? ""
                : String((lead as any)?.experimental_class_professor_time ?? "").trim();
              const bestProfDate = bookingProfDate || futureBookingProfDate || leadFlatProfDate;
              const bestProfTime = bookingProfTime || futureBookingProfTime || leadFlatProfTime;

              const fallbackLeadDateRaw = hasLatestCancelledMarker
                ? ""
                : String(
                    (lead as any)?.experimental_class_lead_date ??
                      (bookingObj as any)?.lead_date ??
                      "",
                  ).trim();
              const fallbackLeadTimeRaw = hasLatestCancelledMarker
                ? ""
                : String(
                    (lead as any)?.experimental_class_lead_time ??
                      (bookingObj as any)?.lead_time ??
                      "",
                  ).trim();

              let leadDateRaw = "";
              let leadTimeRaw = "";
              if (bestProfDate && bestProfTime) {
                try {
                  const leadEffectiveTz = deriveLeadEffectiveTimeZone(lead);
                  const utcIso = zonedDateTimeToUtcIso({
                    date: bestProfDate,
                    time: bestProfTime,
                    timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
                  });
                  if (utcIso) {
                    leadDateRaw = extractLocalDateFromUtcIso(utcIso, leadEffectiveTz);
                    leadTimeRaw = extractLocalTimeFromUtcIso(utcIso, leadEffectiveTz);
                  }
                } catch {
                  leadDateRaw = "";
                  leadTimeRaw = "";
                }
              }
              if (!leadDateRaw || !leadTimeRaw) {
                leadDateRaw = fallbackLeadDateRaw;
                leadTimeRaw = fallbackLeadTimeRaw;
              }

              const profDateRaw = String(
                (lead as any)?.experimental_class_professor_date ??
                  (bookingObj as any)?.professor_date ??
                  "",
              ).trim();
              const profTimeRaw = String(
                (lead as any)?.experimental_class_professor_time ??
                  (bookingObj as any)?.professor_time ??
                  "",
              ).trim();
              const formatTime = (raw: string) => {
                if (!raw) return "—";
                const clean = raw.replace(/h/gi, "").trim();
                return clean ? `${clean}h` : "—";
              };

              return (
                <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] p-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-3 space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--app-text-50)]">
                        Dia (aluno)
                      </div>
                      <div className="text-[15px] font-semibold text-[var(--app-text-88)]">
                        {leadDateRaw ? formatAtendimentoDate(leadDateRaw) : "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-3 space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--app-text-50)]">
                        Horário (aluno)
                      </div>
                      <div className="text-[15px] font-semibold text-[var(--app-text-88)]">
                        {formatTime(leadTimeRaw)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-3 space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--app-text-50)]">
                        Dia (professor)
                      </div>
                      <div className="text-[15px] font-semibold text-[var(--app-text-88)]">
                        {profDateRaw ? formatAtendimentoDate(profDateRaw) : "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-3 space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--app-text-50)]">
                        Horário (professor)
                      </div>
                      <div className="text-[15px] font-semibold text-[var(--app-text-88)]">
                        {formatTime(profTimeRaw)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="mt-2 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleCloseExpInfo}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={isEditSenhaOpen}
        onClose={handleCloseEditSenha}
        size="md"
        closeOnBackdrop={!editSenhaSaving}
        closeOnEscape={!editSenhaSaving}
      >
        <form
          className="flex w-full flex-col gap-0"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveEditSenha();
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <Pencil className="h-5 w-5 text-[#9a3412]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Editar senha
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Atualize a senha de acesso ao fluxo de matrícula.
                </div>
              </div>
            </div>
            <button
              type="button"
              aria-label="Fechar"
              onClick={handleCloseEditSenha}
              disabled={editSenhaSaving}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 w-full space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[var(--app-text-70)]">
                Senha
                <span className="ml-2 font-normal text-[var(--app-text-45)]">(mín. 4 caracteres, obrigatório)</span>
              </label>
              <input
                autoFocus
                type="text"
                required
                minLength={4}
                value={editSenhaValue}
                onChange={(e) => setEditSenhaValue(e.target.value)}
                placeholder="Digite a senha do aluno..."
                disabled={editSenhaSaving}
                className="min-h-[44px] w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-3 text-[14px] font-semibold text-[var(--app-text-90)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-ring)] focus:outline-none focus:ring-4 focus:ring-[var(--app-ring)]/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          <div className="mt-5 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={handleCloseEditSenha}
              disabled={editSenhaSaving}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={editSenhaSaving || String(editSenhaValue ?? "").trim().length < 4}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold !text-white shadow-none transition-colors hover:bg-[#c2410c] active:bg-[#9a3412] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editSenhaSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Salvar
            </button>
          </div>
        </form>
      </AppModal>
    </div>
  );
}
