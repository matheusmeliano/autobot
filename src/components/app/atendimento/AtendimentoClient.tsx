"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, Bot, Calendar as CalendarIcon, CheckCircle2, ChevronRight, Copy, ExternalLink, MoreVertical, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { STAGE_LABELS, STATUS_LABELS } from "@/lib/atendimento/constants";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { modalToast } from "@/lib/modalToast";
import { formatAtendimentoDateTime, leadMatchesSearchQuery } from "@/lib/atendimento/utils";
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

type LeadDetailsTab = "visao_geral" | "agendamentos" | "historico" | "observacoes";

function buildInitials(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  if (!clean) return "??";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function applyPhoneMask(input: string): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("55")) {
    const rest = digits.slice(2);
    if (rest.length === 0) return "+55";
    if (rest.length <= 2) return `+55 (${rest}`;
    if (rest.length === 3) return `+55 (${rest.slice(0, 2)}) ${rest[2]}`;
    if (rest.length <= 6) return `+55 (${rest.slice(0, 2)}) ${rest.slice(2)}`;
    if (rest.length === 7) return `+55 (${rest.slice(0, 2)}) ${rest[2]} ${rest.slice(3, 7)}`;
    if (rest.length <= 10) return `+55 (${rest.slice(0, 2)}) ${rest[2]} ${rest.slice(3, 7)}-${rest.slice(7)}`;
    if (rest.length === 11) return `+55 (${rest.slice(0, 2)}) ${rest[2]} ${rest.slice(3, 7)}-${rest.slice(7, 11)}`;
    const extra = rest.slice(11);
    return `+55 (${rest.slice(0, 2)}) ${rest[2]} ${rest.slice(3, 7)}-${rest.slice(7, 11)} ${extra}`;
  }

  if (digits.startsWith("1")) {
    const rest = digits.slice(1);
    if (rest.length === 0) return "+1";
    if (rest.length <= 3) return `+1 (${rest}`;
    if (rest.length === 4) return `+1 (${rest.slice(0, 3)}) ${rest[3]}`;
    if (rest.length <= 6) return `+1 (${rest.slice(0, 3)}) ${rest.slice(3)}`;
    if (rest.length === 7) return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest[6]}`;
    if (rest.length <= 10) return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
    const extra = rest.slice(10);
    return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)} ${extra}`;
  }

  if (digits.startsWith("7")) {
    const rest = digits.slice(1);
    if (rest.length === 0) return "+7";
    if (rest.length <= 3) return `+7 (${rest}`;
    if (rest.length <= 6) return `+7 (${rest.slice(0, 3)}) ${rest.slice(3)}`;
    if (rest.length <= 10) return `+7 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
    const extra = rest.slice(10);
    return `+7 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)} ${extra}`;
  }

  if (digits.length <= 3) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
  const country = digits.slice(0, 2);
  const num = digits.slice(2);
  const groups: string[] = [];
  for (let i = 0; i < num.length; i += 4) groups.push(num.slice(i, i + 4));
  return `+${country} ${groups.join(" ")}`;
}

function buildExperimentalMetaForList(lead: AtendimentoLeadListItem): { label: string; tone: "success" | "warning" | "default" } {
  const booking = lead.experimental_class_booking;
  const bookingStatus = String(booking?.status ?? "").trim().toLowerCase();
  const bookingHasId = Boolean(String(booking?.id ?? "").trim());
  const bookingIsNotDraft = bookingHasId && String(booking?.source ?? "draft").trim().toLowerCase() !== "draft";
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
  const futureExp = (lead as any)?.future_experimental_class_booking ?? null;
  const futureExpStatus = String(futureExp?.status ?? "").trim().toLowerCase();
  const hasFutureExp = Boolean(futureExp && futureExpStatus !== "cancelled");
  const futureExpDateLabel = hasFutureExp
    ? String((futureExp?.lead_date ?? futureExp?.professor_date) ?? "").trim()
    : "";
  const futureExpTimeLabel = hasFutureExp
    ? String(futureExp?.lead_time ?? futureExp?.professor_time ?? "").trim()
    : "";
  if (hasFutureExp && futureExpDateLabel && futureExpTimeLabel) {
    const dmy = new Date(futureExpDateLabel).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    return { label: `Aula em: ${dmy}, ${futureExpTimeLabel.replace("h", "")}h`, tone: "success" };
  }
  if (expDraftDate && expDraftTime) {
    const dmy = new Date(expDraftDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    return { label: `Aula em: ${dmy}, ${expDraftTime.replace("h", "")}h`, tone: "success" };
  }
  if (booking && bookingHasId && bookingIsNotDraft && bookingStatus !== "cancelled") {
    const dateRaw = String((lead as any)?.experimental_class_lead_date ?? "").trim() || String((lead as any)?.experimental_class_professor_date ?? "").trim();
    const timeRaw = String((lead as any)?.experimental_class_lead_time ?? "").trim() || String((lead as any)?.experimental_class_professor_time ?? "").trim();
    if (dateRaw && timeRaw) {
      const dmy = new Date(dateRaw).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      return { label: `Aula em: ${dmy}, ${timeRaw.replace("h", "")}h`, tone: "success" };
    }
  }
  const recurringWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(String(lead.recurring_class_weekday ?? "").trim().toLowerCase());
  const recurringTimeOk = Boolean(String(lead.recurring_class_professor_time ?? "").trim()) || Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const regStepOk = Number.isFinite(regStepRaw) && regStepRaw >= 1 && regStepRaw <= 12;
  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  const rcsRaw = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const hasAnyRecurring = recurringWeekdayOk || recurringTimeOk || regStepOk || Boolean(rcsRaw);
  if (hasAnyRecurring && !(Boolean(stateRaw) && Boolean(cityRaw)) && regStepOk && regStepRaw >= 1) {
    return { label: "Falta estado e cidade", tone: "warning" };
  }
  if (!recurringWeekdayOk && !recurringTimeOk && !hasFutureExp && !expDraftDate) {
    return { label: "Falta dia e horário", tone: "warning" };
  }
  return { label: "Novo registro", tone: "default" };
}

function buildRecurringMetaForVisaoGeral(lead: AtendimentoLeadListItem): { title: string; body: string; tone: "warning" | "success" | "default" } | null {
  const st = String(lead.status ?? "").trim().toLowerCase();
  const fs = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const rcsRaw = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
  const recurringWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(String(lead.recurring_class_weekday ?? "").trim().toLowerCase());
  const recurringTimeOk = Boolean(String(lead.recurring_class_professor_time ?? "").trim()) || Boolean(String(lead.recurring_class_lead_time ?? "").trim());
  const regStepRaw = Number((lead as any)?.recurring_registration_step ?? NaN);
  const regStepOk = Number.isFinite(regStepRaw) && regStepRaw >= 1 && regStepRaw <= 12;
  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  const locationOk = Boolean(stateRaw) && Boolean(cityRaw);
  const ps = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmed = ps === "confirmado" || ps === "matriculado" || st === "matriculado" || st === "aluno" || fs === "matriculado" || fs === "matricula_confirmada";
  if (payConfirmed) return { title: "Matrícula concluída", body: "Todos os dados foram confirmados.", tone: "success" };
  const rec = recurringWeekdayOk || recurringTimeOk || regStepOk || Boolean(rcsRaw);
  if (rec && !locationOk && regStepOk && regStepRaw >= 1) {
    return { title: "Falta estado e cidade", body: "Complete as informações para avançar.", tone: "warning" };
  }
  if (rec && !recurringWeekdayOk && !recurringTimeOk) {
    return { title: "Falta dia e horário recorrentes", body: "Defina dia e horário para continuar.", tone: "warning" };
  }
  const expMeta = buildExperimentalMetaForList(lead);
  if (!rec && expMeta.tone === "warning") {
    return { title: expMeta.label, body: "Complete os dados para agendar a aula experimental.", tone: "warning" };
  }
  if (!locationOk && st !== "aluno" && !rec) {
    return null;
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
  const [summary, setSummary] = useState<AtendimentoSummary>(EMPTY_SUMMARY);
  const [panelLeads, setPanelLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<LeadDetailsTab>("visao_geral");
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadPhone, setCreateLeadPhone] = useState("");
  const [createLeadName, setCreateLeadName] = useState("");
  const [createLeadSaving, setCreateLeadSaving] = useState(false);
  const [observacoesDraft, setObservacoesDraft] = useState<string>("");
  const [observacoesSaving, setObservacoesSaving] = useState(false);
  const [showMobileLeadModal, setShowMobileLeadModal] = useState(false);
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [botExperimentalDisabled, setBotExperimentalDisabled] = useState<boolean>(false);
  const [botExperimentalLoading, setBotExperimentalLoading] = useState<boolean>(false);

  type LeadFilters = {
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
  };
  const EMPTY_FILTERS: LeadFilters = {
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
  };
  const [activeFilters, setActiveFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSubscribedRef = useRef(false);
  const initialLoadCompletedRef = useRef(false);

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

  // Quando troca pra desktop, fecha modal (nao precisa mais, section esta visivel!)
  useEffect(() => {
    if (!isMobileViewport) setShowMobileLeadModal(false);
  }, [isMobileViewport]);

  const selectedLead = useMemo<AtendimentoLeadListItem | null>(() => {
    if (!selectedLeadId) return null;
    return panelLeads.find((l) => l.id === selectedLeadId) ?? null;
  }, [panelLeads, selectedLeadId]);

  const applyFiltersToLeads = (
    leads: AtendimentoLeadListItem[],
    f: LeadFilters,
  ): AtendimentoLeadListItem[] => {
    const hasAnyFilter = Object.values(f).some((v) =>
      Array.isArray(v) ? v.length > 0 : Boolean(v),
    );
    if (!hasAnyFilter) return leads;
    return leads.filter((l) => {
      if (f.statusList.length > 0 && !f.statusList.includes(String(l.status ?? ""))) return false;
      if (f.stageList.length > 0 && !f.stageList.includes(String(l.funnel_stage ?? ""))) return false;
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
      if (f.createdFrom) {
        const fromMs = new Date(`${f.createdFrom}T00:00:00`).getTime();
        const leadMs = new Date(String(l.created_at ?? "")).getTime();
        if (!Number.isNaN(fromMs) && leadMs < fromMs) return false;
      }
      if (f.createdTo) {
        const toMs = new Date(`${f.createdTo}T23:59:59`).getTime();
        const leadMs = new Date(String(l.created_at ?? "")).getTime();
        if (!Number.isNaN(toMs) && leadMs > toMs) return false;
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
    let out = applyFiltersToLeads(panelLeads, activeFilters);
    if (!q) return out;
    return out.filter((l) => leadMatchesSearchQuery(l, q));
  }, [panelLeads, searchQuery, activeFilters]);

  useEffect(() => {
    if (selectedLead && filteredLeads.findIndex((l) => l.id === selectedLead.id) === -1 && panelLeads.findIndex((l) => l.id === selectedLead.id) >= 0) {
      return;
    }
    if (filteredLeads.length && !selectedLead) {
      setSelectedLeadId(filteredLeads[0].id);
    }
  }, [filteredLeads, selectedLead, panelLeads]);

  useEffect(() => {
    if (selectedLead) {
      setObservacoesDraft(String((selectedLead as any).internal_notes ?? "").trim());
      setActiveTab("visao_geral");
    }
  }, [selectedLead?.id]);

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
                  Cadastre um número para iniciar o atendimento
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

  function renderMetricsModal() {
    const items: Array<{ label: string; value: number; icon: React.ReactNode; tone: "default" | "success" | "warning" | "info" | "danger" }> = [
      { label: "Total de registros", value: summary.totalLeads, icon: <UserRound className="h-5 w-5" />, tone: "default" },
      { label: "Registros Completos", value: summary.novosLeads, icon: <UserRound className="h-5 w-5" />, tone: "info" },
      { label: "Em atendimento", value: summary.emAtendimento, icon: <Bot className="h-5 w-5" />, tone: "warning" },
      { label: "Aulas experimentais agendadas", value: summary.aulasExperimentaisAgendadas, icon: <CalendarIcon className="h-5 w-5" />, tone: "success" },
      { label: "Matrículas pendentes", value: summary.matriculasPendentes, icon: <ExternalLink className="h-5 w-5" />, tone: "warning" },
      { label: "Matriculados", value: summary.matriculados, icon: <ExternalLink className="h-5 w-5" />, tone: "success" },
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
                  Visão geral dos registros e do funil
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
                it.tone === "success"
                  ? "border-emerald-500/35 bg-emerald-500/10"
                  : it.tone === "warning"
                  ? "border-[rgba(234,88,12,0.35)] bg-[rgba(234,88,12,0.10)]"
                  : it.tone === "info"
                  ? "border-sky-500/35 bg-sky-500/10"
                  : it.tone === "danger"
                  ? "border-rose-500/35 bg-rose-500/10"
                  : "border-[var(--app-border)] bg-[var(--app-solid-surface-2)]";
              const iconTone =
                it.tone === "success"
                  ? "text-emerald-700"
                  : it.tone === "warning"
                  ? "text-[#9a3412]"
                  : it.tone === "info"
                  ? "text-sky-700"
                  : it.tone === "danger"
                  ? "text-rose-700"
                  : "text-[var(--app-text-70)]";
              return (
                <div
                  key={it.label}
                  className={`flex items-start justify-between gap-3 overflow-hidden rounded-2xl border p-4 shadow-none ${toneClasses}`}
                >
                  <div className="min-w-0">
                    <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${iconTone}`}>
                      {it.label}
                    </div>
                    <div className="mt-1 text-[22px] font-extrabold leading-tight text-[var(--app-text-85)]">
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
    // Opcoes dinâmicas a partir dos leads carregados
    // OPCOES ESSENCIAIS (ENXUGADAS): remove duplicadas/repetidas/menos usadas
    // STATUS: foco em status do processo de matricula (pagamento, contrato, aluno, encerrado, etc)
    const STATUS_ALLOWLIST = new Set([
      "novo_lead",
      "em_atendimento",
      "matricula_pendente",
      "contrato_aguardando_aceite",
      "contrato_assinado",
      "pagamento_pendente_confirmacao",
      "pagamento_nao_realizado",
      "matricula_confirmada",
      "matriculado",
      "aluno",
      "encerrado",
    ]);
    // ETAPA DO FUNIL: foco no caminho do aluno (convidado → agendada → pré-cadastro etc); REMOVIDOS que ja aparecem em STATUS acima
    const STAGE_ALLOWLIST = new Set([
      "aula_experimental_convidada",
      "aula_experimental_agendada",
      "pre_cadastro_concluido",
      "metodologia_apresentada",
    ]);
    const countryOptions = Array.from(
      new Set(panelLeads.map((l) => String(l.country ?? "").trim()).filter(Boolean)),
    ).sort();
    const stateOptions = Array.from(
      new Set(panelLeads.map((l) => String(l.state ?? "").trim()).filter(Boolean)),
    ).sort();
    const statusOptions = Object.entries(STATUS_LABELS)
      .filter(([id, label]) => STATUS_ALLOWLIST.has(id) && Boolean(id) && Boolean(String(label ?? "").trim()))
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR"));
    const stageOptions = Object.entries(STAGE_LABELS)
      .filter(([id, label]) => STAGE_ALLOWLIST.has(id) && Boolean(id) && Boolean(String(label ?? "").trim()))
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR"));

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
                key === "statusList"
                  ? STATUS_LABELS[v] ?? v
                  : key === "stageList"
                  ? STAGE_LABELS[v] ?? v
                  : v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggle(key, v)}
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
        size="xl"
        position="center"
        zIndexClass="z-[400]"
        fullScreenOnMobile={false}
      >
        <div className="flex w-full flex-col gap-0">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <SlidersHorizontal className="h-5 w-5 text-[#9a3412]" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold leading-tight text-[var(--app-text-85)]">
                  Filtros avançados
                </h3>
                <div className="mt-0.5 text-[12px] text-[var(--app-text-55)]">
                  Filtre a lista de registros por status, etapa, localização e mais
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowFiltersModal(false)}
              aria-label="Fechar filtros"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Conteudo filtros (scroll interno) */}
          <div className="mt-4 flex max-h-[65vh] min-h-0 w-full flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
            {/* BLOCO 1: Status + Etapa (seleção rápida por chip/label) */}
            <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                Status
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {statusOptions.map(([id, label]) => {
                  const lbl = String(label ?? id ?? "").trim() || String(id);
                  const sel = draftFilters.statusList.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle("statusList", id)}
                      className={[
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium text-left shadow-none",
                        sel
                          ? "border-[rgba(234,88,12,0.4)] bg-[rgba(234,88,12,0.10)] text-[var(--app-text-85)]"
                          : "border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      <span className="min-w-0 truncate">{lbl}</span>
                      {sel ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#ea580c]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                Etapa do funil
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {stageOptions.map(([id, label]) => {
                  const lbl = String(label ?? id ?? "").trim() || String(id);
                  const sel = draftFilters.stageList.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle("stageList", id)}
                      className={[
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium text-left shadow-none",
                        sel
                          ? "border-[rgba(234,88,12,0.4)] bg-[rgba(234,88,12,0.10)] text-[var(--app-text-85)]"
                          : "border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      <span className="min-w-0 truncate">{lbl}</span>
                      {sel ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#ea580c]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* BLOCO 2: Checkboxes booleanos (rápidos) */}
            <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                Dados obrigatórios
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["onlyWithUnread", "Apenas com mensagens não lidas"],
                    ["onlyWithPhone", "Apenas com telefone cadastrado"],
                    ["onlyWithScheduledClass", "Apenas com aula experimental agendada"],
                    ["onlyWithContract", "Apenas com contrato iniciado"],
                  ] as Array<[keyof LeadFilters, string]>
                ).map(([key, label]) => {
                  const val = Boolean((draftFilters as any)[key]);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setDraftFilters((p) => ({ ...p, [key]: !(p as any)[key] } as LeadFilters))
                      }
                      className={[
                        "flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium text-left shadow-none",
                        val
                          ? "border-[rgba(234,88,12,0.4)] bg-[rgba(234,88,12,0.10)] text-[var(--app-text-85)]"
                          : "border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      <span>{label}</span>
                      {val ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#ea580c]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* BLOCO 3: País + Estado */}
            <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                Localização
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-[var(--app-text-60)]">País</label>
                  {countryOptions.length === 0 ? (
                    <div className="mt-1.5 text-[12px] text-[var(--app-text-50)]">
                      Sem países na lista ainda.
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {countryOptions.map((c) => {
                        const sel = draftFilters.countries.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => toggle("countries", c)}
                            className={[
                              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-none",
                              sel
                                ? "border-[rgba(234,88,12,0.4)] bg-[rgba(234,88,12,0.12)] text-[var(--app-text-85)]"
                                : "border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)]",
                            ].join(" ")}
                          >
                            {c}
                            {sel ? <X className="h-3 w-3 opacity-70" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--app-text-60)]">Estado</label>
                  {stateOptions.length === 0 ? (
                    <div className="mt-1.5 text-[12px] text-[var(--app-text-50)]">
                      Sem estados na lista ainda.
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {stateOptions.map((c) => {
                        const sel = draftFilters.states.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => toggle("states", c)}
                            className={[
                              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-none",
                              sel
                                ? "border-[rgba(234,88,12,0.4)] bg-[rgba(234,88,12,0.12)] text-[var(--app-text-85)]"
                                : "border-[var(--app-border)] bg-[var(--app-solid-surface-2)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)]",
                            ].join(" ")}
                          >
                            {c}
                            {sel ? <X className="h-3 w-3 opacity-70" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* BLOCO 4: Data de criação — calendário customizado (NÃO usa input date nativo!) */}
            <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                Data de cadastro
              </div>
              <div className="mt-3">
                <AppDateRangePicker
                  placeholder="Selecione o período de cadastro..."
                  value={{
                    from: (draftFilters.createdFrom ?? null) as string | null,
                    to: (draftFilters.createdTo ?? null) as string | null,
                  }}
                  onChange={(next: AppDateRange) => {
                    setDraftFilters((p) => ({
                      ...p,
                      createdFrom: next.from ?? "",
                      createdTo: next.to ?? "",
                    }));
                  }}
                  showLabel={false}
                />
              </div>
            </div>

            {/* Resumo filtros ativos (chips rápidos para remover) */}
            {isFilled ? (
              <div className="rounded-2xl border border-[rgba(234,88,12,0.3)] bg-[rgba(234,88,12,0.08)] p-3.5 shadow-none">
                <div className="flex flex-col gap-2">
                  {headerPill("Status", draftFilters.statusList, "statusList")}
                  {draftFilters.stageList.length > 0
                    ? headerPill("Etapa", draftFilters.stageList, "stageList")
                    : null}
                  {draftFilters.countries.length > 0
                    ? headerPill("País", draftFilters.countries, "countries")
                    : null}
                  {draftFilters.states.length > 0
                    ? headerPill("Estado", draftFilters.states, "states")
                    : null}
                  {Object.entries(draftFilters)
                    .filter(([k, v]) => typeof v === "boolean" && v)
                    .map(([k]) => {
                      const lbl = (
                        {
                          onlyWithUnread: "🔔 Com não lidas",
                          onlyWithPhone: "📞 Com telefone",
                          onlyWithEmail: "✉️ Com e-mail",
                          onlyWithScheduledClass: "📅 Com aula",
                          onlyWithContract: "📝 Com contrato",
                        } as Record<string, string>
                      )[k] ?? k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() =>
                            setDraftFilters((p) => ({ ...p, [k]: false }) as LeadFilters)
                          }
                          className="mr-auto inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                        >
                          {lbl}
                          <span className="text-[var(--app-text-45)]">×</span>
                        </button>
                      );
                    })}
                  {(draftFilters.createdFrom || draftFilters.createdTo) ? (
                    <div className="text-[11px] font-semibold text-[var(--app-text-75)]">
                      📆 Cadastro:{" "}
                      <span className="text-[var(--app-text-85)]">
                        {draftFilters.createdFrom ?? "—"} até{" "}
                        {draftFilters.createdTo ?? "—"}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Rodapé ações */}
          <div className="mt-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[12px] text-[var(--app-text-55)]">
              Resultado filtrado: <strong className="text-[var(--app-text-85)]">{liveFilteredCount}</strong>{" "}
              {liveFilteredCount === 1 ? "registro" : "registros"}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setDraftFilters(EMPTY_FILTERS);
                  setActiveFilters(EMPTY_FILTERS);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
              >
                Limpar filtros
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFilters(draftFilters);
                  setShowFiltersModal(false);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[#ea580c] px-5 text-[13px] font-semibold !text-white shadow-none hover:bg-[#c2410c] active:bg-[#9a3412] transition-colors"
              >
                Aplicar filtros
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
        <aside className="flex h-auto w-full min-h-0 min-w-0 shrink-0 min-[1201px]:w-[360px] min-[1201px]:h-full min-[1201px]:min-h-0 flex-col overflow-visible min-[1201px]:overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none">
          {/* Header: Apenas ícones (otimizar espaço) — Atualizar | Métricas | Adicionar | Bot Experimental */}
          <div className="flex shrink-0 items-center justify-start gap-2 px-5 pt-5">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loading}
              aria-label="Atualizar lista"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 shadow-none"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            {/* MÉTRICAS: Ao lado ESQUERDO do "+ Adicionar" (usuário pediu) */}
            <button
              type="button"
              onClick={() => setShowMetricsModal(true)}
              aria-label="Métricas e resumo de registros"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 shadow-none"
            >
              <BarChart3 className="h-4 w-4" />
            </button>
            {/* FILTROS AVANCADOS: ao lado ESQUERDO de Adicionar registro (+) */}
            <button
              type="button"
              onClick={() => {
                setDraftFilters(activeFilters);
                setShowFiltersModal(true);
              }}
              aria-label="Filtros avançados de registros"
              className={[
                "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all shadow-none",
                Object.values(activeFilters).some((v) => Array.isArray(v) ? v.length > 0 : Boolean(v))
                  ? "border-[rgba(234,88,12,0.4)] bg-[rgba(234,88,12,0.12)] text-[#9a3412] hover:bg-[rgba(234,88,12,0.18)]"
                  : "border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-75)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60",
              ].join(" ")}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCreateLeadOpen(true)}
              disabled={loading}
              aria-label="Adicionar registro"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 shadow-none"
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="Alternar bot de agendamento experimental"
                aria-pressed={!botExperimentalDisabled}
                disabled={botExperimentalLoading || loading}
                onClick={() => void handleToggleBotExperimental()}
                className={[
                  "inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition-all shadow-none disabled:cursor-not-allowed disabled:opacity-60",
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

          {/* Lista Leads (scroll INTERNO só em DESKTOP; mobile: scroll de pagina toda!) */}
          <div className="mt-4 flex-1 min-h-0 overflow-visible min-[1201px]:overflow-y-auto min-[1201px]:scrollbar-hide pb-5">
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
                filteredLeads.map((lead) => {
                  const isSelected = lead.id === selectedLeadId;
                  const meta = buildExperimentalMetaForList(lead);
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        // Em telas menores, clicar em registro ABRE MODAL de detalhe
                        if (isMobileViewport) setShowMobileLeadModal(true);
                      }}
                      className={[
                        "group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors",
                        isSelected
                          ? "bg-[rgba(234,88,12,0.14)]"
                          : "hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      {/* Avatar 2 letras */}
                      <div
                        className={[
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold",
                          isSelected
                            ? "bg-[#ea580c] !text-white"
                            : "bg-[var(--app-active)] text-[#9a3412]",
                        ].join(" ")}
                      >
                        {buildInitials(lead.full_name)}
                      </div>

                      {/* Nome + Subtítulo + Criado em */}
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
                        <div className="mt-1 text-[11px] text-[var(--app-text-45)]">
                          Criado em: {formatAtendimentoDateTime(lead.created_at)}
                        </div>
                      </div>

                      {/* Seta direita */}
                      <ChevronRight
                        className={[
                          "mt-2 h-4 w-4 shrink-0 transition-colors",
                          isSelected ? "text-[#9a3412]" : "text-[var(--app-text-45)] group-hover:text-[var(--app-text-70)]",
                        ].join(" ")}
                      />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* ========================================================= */}
        {/* COLUNA DIREITA: Detalhe do Lead selecionado */}
        {/* ========================================================= */}
        {/* AVISO: Section SÓ é visível em DESKTOP (min-[1201px])! Em telas menores (mobile), */}
        {/* o usuário clica no item da lista → ABRE MODAL (abaixo, AppMobileLeadDetailModal) */}
        <section className="hidden min-[1201px]:flex h-auto w-full min-h-0 min-w-0 flex-1 flex-col overflow-visible min-[1201px]:h-full min-[1201px]:min-h-0 min-[1201px]:overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none mb-4 min-[1201px]:mb-0">
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
                <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--app-active)] text-[24px] font-semibold text-[#9a3412]">
                      {buildInitials(sl.full_name)}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-[22px] font-bold leading-tight text-[var(--app-text-85)]">
                        {sl.full_name?.trim() || "Sem nome"}
                      </h2>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-[var(--app-text-80)]">
                          📞 {sl.phone?.trim() ? applyPhoneMask(sl.phone) : "Sem telefone"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyPhone(sl)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 text-[11px] font-semibold text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                        >
                          <Copy className="h-3 w-3" />
                          Copiar
                        </button>
                      </div>
                      <div className="mt-1 text-[12px] text-[var(--app-text-55)]">
                        Criado em: {formatAtendimentoDateTime(sl.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                      aria-label="Mais opções"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* TABS — FIXAS (shrink-0, abaixo do header, sempre fixo) */}
                <div className="mt-6 border-b border-[var(--app-border)] px-6 shrink-0">
                  <div className="-mb-px flex items-center gap-6 overflow-x-auto">
                    {([
                      { id: "visao_geral", label: "Visão geral", icon: <UserRound className="h-4 w-4" /> },
                      { id: "agendamentos", label: "Agendamentos", icon: <CalendarIcon className="h-4 w-4" /> },
                      { id: "historico", label: "Histórico", icon: <RefreshCw className="h-4 w-4" /> },
                      { id: "observacoes", label: "Observações", icon: <Pencil className="h-4 w-4" /> },
                    ] as const).map((tab) => {
                      const isActive = tab.id === activeTab;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={[
                            "group inline-flex shrink-0 items-center gap-2 border-b-2 px-1 pb-4 text-[14px] font-semibold transition-colors",
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
                            { label: "Fuso horário", value: (sl as any).timezone ?? null },
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
                        <div className="flex items-center gap-2">
                          <ExternalLink className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Link de Matrícula
                          </div>
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
                              Nenhum passo pendente identificado.
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
                      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Próxima aula
                          </div>
                        </div>
                        {expMeta.tone === "success" ? (
                          <>
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
                            <div className="mt-4 flex justify-end">
                              <button
                                type="button"
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                              >
                                <Plus className="h-4 w-4" />
                                Reagendar aula
                              </button>
                            </div>
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
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                              >
                                <Plus className="h-4 w-4" />
                                Agendar aula
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* ============== AGENDAMENTOS ============== */}
                  {activeTab === "agendamentos" ? (
                    <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                          <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                            Aulas experimentais
                          </div>
                        </div>
                        <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3">
                          <div className="text-[13px] font-semibold text-[var(--app-text-85)]">
                            {buildExperimentalMetaForList(sl).label}
                          </div>
                          <div className="mt-1 text-[12px] text-[var(--app-text-60)]">
                            Horário definido com o registro.
                          </div>
                        </div>
                      </div>
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
                    </div>
                  ) : null}

                  {/* ============== HISTÓRICO ============== */}
                  {activeTab === "historico" ? (
                    <div className="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 text-center shadow-none">
                      <div className="text-[13px] text-[var(--app-text-60)]">
                        Histórico de eventos e interações do registro — em integração.
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
            <div className="flex w-full flex-col gap-0">
              {/* HEADER DO LEAD — MODAL MOBILE */}
              <div className="flex shrink-0 items-start justify-between gap-4 pt-1">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--app-active)] text-[24px] font-semibold text-[#9a3412]">
                    {buildInitials(sl.full_name)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-[22px] font-bold leading-tight text-[var(--app-text-85)]">
                      {sl.full_name?.trim() || "Sem nome"}
                    </h2>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-[var(--app-text-80)]">
                        📞 {sl.phone?.trim() || "Sem telefone"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyPhone(sl)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 text-[11px] font-semibold text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                      >
                        <Copy className="h-3 w-3" />
                        Copiar
                      </button>
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--app-text-55)]">
                      Criado em: {formatAtendimentoDateTime(sl.created_at)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>
                  <button
                    type="button"
                    aria-label="Mais opções"
                    onClick={() => setShowMobileLeadModal(false)}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* TABS — MODAL MOBILE (shrink-0 sempre fixo) */}
              <div className="mt-6 border-b border-[var(--app-border)] shrink-0 -mx-1 px-1">
                <div className="-mb-px flex items-center gap-6 overflow-x-auto">
                  {([
                    { id: "visao_geral", label: "Visão geral", icon: <UserRound className="h-4 w-4" /> },
                    { id: "agendamentos", label: "Agendamentos", icon: <CalendarIcon className="h-4 w-4" /> },
                    { id: "historico", label: "Histórico", icon: <RefreshCw className="h-4 w-4" /> },
                    { id: "observacoes", label: "Observações", icon: <Pencil className="h-4 w-4" /> },
                  ] as const).map((tab) => {
                    const isActive = tab.id === activeTab;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                          "group inline-flex shrink-0 items-center gap-2 border-b-2 px-1 pb-4 text-[14px] font-semibold transition-colors",
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
                          { label: "Fuso horário", value: (sl as any).timezone ?? null },
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
                      <div className="flex items-center gap-2">
                        <ExternalLink className="h-5 w-5 text-[var(--app-text-70)]" />
                        <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                          Link de Matrícula
                        </div>
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
                            Nenhum passo pendente identificado.
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
                    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                        <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                          Próxima aula
                        </div>
                      </div>
                      {expMeta.tone === "success" ? (
                        <>
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
                          <div className="mt-4 flex justify-end">
                            <button
                              type="button"
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                            >
                              <Plus className="h-4 w-4" />
                              Reagendar aula
                            </button>
                          </div>
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
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                            >
                              <Plus className="h-4 w-4" />
                              Agendar aula
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
                    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                        <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                          Aulas experimentais
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 py-3">
                        <div className="text-[13px] font-semibold text-[var(--app-text-85)]">
                          {buildExperimentalMetaForList(sl).label}
                        </div>
                        <div className="mt-1 text-[12px] text-[var(--app-text-60)]">
                          Horário definido com o registro.
                        </div>
                      </div>
                    </div>
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
                  </div>
                ) : null}

                {/* ============== HISTÓRICO ============== */}
                {activeTab === "historico" ? (
                  <div className="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 text-center shadow-none">
                    <div className="text-[13px] text-[var(--app-text-60)]">
                      Histórico de eventos e interações do registro — em integração.
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

      {/* MODAL MÉTRICAS: Resumo dos registros (clicou no ícone BarChart3 no header) */}
      {renderMetricsModal()}

      {/* MODAL FILTROS AVANCADOS: Clicou no ícone SlidersHorizontal (ao lado ESQUERDO do Bot!) */}
      {renderFiltersModal()}
    </div>
  );
}
