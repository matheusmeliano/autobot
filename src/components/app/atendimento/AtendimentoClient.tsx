"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, Calendar as CalendarIcon, ChevronRight, Copy, ExternalLink, MoreVertical, Pencil, Plus, RefreshCw, Search, UserRound } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { modalToast } from "@/lib/modalToast";
import { formatAtendimentoDateTime, leadMatchesSearchQuery } from "@/lib/atendimento/utils";

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
  return { label: "Novo interessado", tone: "default" };
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
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [observacoesDraft, setObservacoesDraft] = useState<string>("");
  const [observacoesSaving, setObservacoesSaving] = useState(false);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSubscribedRef = useRef(false);
  const initialLoadCompletedRef = useRef(false);

  const selectedLead = useMemo<AtendimentoLeadListItem | null>(() => {
    if (!selectedLeadId) return null;
    return panelLeads.find((l) => l.id === selectedLeadId) ?? null;
  }, [panelLeads, selectedLeadId]);

  const filteredLeads = useMemo<AtendimentoLeadListItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return panelLeads;
    return panelLeads.filter((l) => leadMatchesSearchQuery(l, q));
  }, [panelLeads, searchQuery]);

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
      await Promise.all([loadSummary({ silent: true }), loadPanelLeads()]);
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
    Promise.all([loadSummary(), loadPanelLeads()])
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
    return null;
  }

  function renderLeadDetailSection() {
    return (
      <section className="flex min-h-0 min-w-0 w-full flex-1 h-0 flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none">
        {!selectedLead ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center px-6 max-w-md">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(234,88,12,0.15)]">
                <UserRound className="h-6 w-6 text-[#9a3412]" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-[var(--app-text-85)]">
                Selecione um interessado
              </h3>
              <p className="mt-2 text-[13px] text-[var(--app-text-60)]">
                Clique em qualquer interessado ao lado para ver os detalhes, agendamentos, link de matrícula e mais.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--app-active)] text-[24px] font-semibold text-[#9a3412]">
                  {buildInitials(selectedLead.full_name)}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-[22px] font-bold leading-tight text-[var(--app-text-85)]">
                    {selectedLead.full_name?.trim() || "Sem nome"}
                  </h2>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold text-[var(--app-text-80)]">
                      📞 {selectedLead.phone?.trim() || "Sem telefone"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyPhone(selectedLead)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-3 text-[11px] font-semibold text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </button>
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--app-text-55)]">
                    Criado em: {formatAtendimentoDateTime(selectedLead.created_at)}
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

            <div className="flex-1 min-h-0 h-0 overflow-y-auto scrollbar-hide px-6 py-6">
              {activeTab === "visao_geral" ? (
                <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
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
                        { label: "Cidade", value: (selectedLead as any).city ?? null },
                        { label: "Estado", value: (selectedLead as any).state ?? null },
                        { label: "País", value: (selectedLead as any).country ?? null },
                        { label: "Fuso horário", value: (selectedLead as any).timezone ?? null },
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
                          {buildRecurringClassUrl(selectedLead)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyMatriculaLink(selectedLead)}
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
                        onClick={() => handleOpenMatriculaLink(selectedLead)}
                        className={[
                          "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold !text-white shadow-none transition",
                          isLeadMatriculaConcluida(selectedLead)
                            ? "bg-sky-600 hover:bg-sky-500"
                            : "bg-emerald-600 hover:bg-emerald-500",
                        ].join(" ")}
                      >
                        <ExternalLink className="h-4 w-4" />
                        {isLeadMatriculaConcluida(selectedLead) ? "Abrir painel" : "Abrir matrícula"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyMatriculaLink(selectedLead)}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 text-[13px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                      >
                        <Copy className="h-4 w-4" />
                        Copiar link
                      </button>
                    </div>
                  </div>

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
                    {(() => {
                      const statusMeta = buildRecurringMetaForVisaoGeral(selectedLead);
                      if (!statusMeta) {
                        return (
                          <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-3">
                            <div className="font-semibold text-emerald-800">
                              Dados básicos coletados
                            </div>
                            <div className="mt-0.5 text-[13px] text-emerald-700/90">
                              Nenhum passo pendente identificado.
                            </div>
                          </div>
                        );
                      }
                      if (statusMeta.tone === "success") {
                        return (
                          <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-3">
                            <div className="font-semibold text-emerald-800">
                              {statusMeta.title}
                            </div>
                            <div className="mt-0.5 text-[13px] text-emerald-700/90">
                              {statusMeta.body}
                            </div>
                          </div>
                        );
                      }
                      return (
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
                      );
                    })()}
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-5 w-5 text-[var(--app-text-70)]" />
                      <div className="text-[15px] font-bold text-[var(--app-text-85)]">
                        Próxima aula
                      </div>
                    </div>
                    {(() => {
                      const meta = buildExperimentalMetaForList(selectedLead);
                      if (meta.tone === "success") {
                        return (
                          <>
                            <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
                              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-700">
                                <CalendarIcon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-emerald-800 truncate">
                                  {meta.label}
                                </div>
                                <div className="mt-0.5 text-[13px] text-emerald-700/80">
                                  Horário confirmado para o interessado.
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
                        );
                      }
                      return (
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
                                Este interessado ainda não possui aulas agendadas.
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
                      );
                    })()}
                  </div>
                </div>
              ) : null}

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
                        {buildExperimentalMetaForList(selectedLead).label}
                      </div>
                      <div className="mt-1 text-[12px] text-[var(--app-text-60)]">
                        Horário definido com o interessado.
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
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                          Dia
                        </div>
                        <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                          {String((selectedLead as any).recurring_class_weekday_label ?? (selectedLead as any).recurring_class_weekday ?? "-").trim() || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                          Horário
                        </div>
                        <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                          {String((selectedLead as any).recurring_class_professor_time ?? (selectedLead as any).recurring_class_lead_time ?? "-").trim() || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                          Status
                        </div>
                        <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                          {String((selectedLead as any).recurring_class_status ?? "-").trim() || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--app-text-60)]">
                          Etapa
                        </div>
                        <div className="mt-1 text-[14px] font-semibold text-[var(--app-text-85)]">
                          Passo {Number((selectedLead as any).recurring_registration_step ?? 0) || "-"}/12
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "historico" ? (
                <div className="w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 text-center shadow-none">
                  <div className="text-[13px] text-[var(--app-text-60)]">
                    Histórico de eventos e interações do interessado — em integração.
                  </div>
                </div>
              ) : null}

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
                      placeholder="Adicione anotações sobre esse interessado (só visíveis para o atendimento)..."
                      className="mt-4 min-h-[160px] w-full rounded-xl border border-[var(--app-border)] !bg-[var(--app-solid-surface-2)] px-4 py-3 text-[14px] font-medium leading-relaxed text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none resize-none"
                    />
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSaveObservacoes()}
                        disabled={observacoesSaving || observacoesDraft === String((selectedLead as any).internal_notes ?? "").trim()}
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
        )}
      </section>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <div className="flex min-h-0 min-w-0 h-0 w-full flex-1 flex-col gap-4 min-[1201px]:flex-row overflow-hidden">
        <aside className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none min-[1201px]:shrink-0 min-[1201px]:w-[360px] flex-1">
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || loading}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Atualizar"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => setCreateLeadOpen(true)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-70)] hover:bg-[var(--app-hover)]"
                aria-label="Adicionar interessado"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold !text-white shadow-none hover:bg-emerald-500"
            >
              <Bot className="h-4 w-4" />
              Bot
            </button>
          </div>

          <div className="mt-4 px-5 shrink-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-text-55)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar interessado..."
                className="h-11 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] pl-10 pr-4 text-[13px] font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] focus:border-[var(--app-accent-color)]/35 focus:ring-0 outline-none"
              />
            </div>
            <div className="mt-2 text-[11px] font-semibold text-[var(--app-text-60)]">
              {filteredLeads.length} interessado{filteredLeads.length === 1 ? "" : "s"} encontrado{filteredLeads.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-4 flex-1 min-h-0 h-0 overflow-y-auto scrollbar-hide px-3 pb-5">
            {loading ? (
              <div className="space-y-2 px-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[78px] w-full rounded-xl bg-[var(--app-solid-surface-2)] animate-pulse" />
                ))}
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <div className="text-[13px] text-[var(--app-text-60)]">
                  Nenhum interessado encontrado.
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredLeads.map((lead) => {
                  const meta = buildExperimentalMetaForList(lead);
                  const isSelected = lead.id === selectedLeadId;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        setLeadDetailOpen(true);
                      }}
                      className={[
                        "group flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors",
                        isSelected
                          ? "bg-[rgba(234,88,12,0.16)]"
                          : "hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--app-active)] text-[16px] font-semibold text-[#9a3412]">
                        {buildInitials(lead.full_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-bold leading-tight text-[var(--app-text-85)]">
                              {lead.full_name?.trim() || "Sem nome"}
                            </div>
                            <div className="mt-1 truncate text-[12px] font-medium text-[var(--app-text-60)]">
                              📞 {lead.phone?.trim() || "Sem telefone"}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-[var(--app-text-50)]">
                              {formatAtendimentoDateTime(lead.created_at)}
                            </div>
                          </div>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--app-text-50)]" />
                        </div>
                        <div className="mt-2">
                          <span
                            className={[
                              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              meta.tone === "success"
                                ? "bg-emerald-600 !text-white"
                                : meta.tone === "warning"
                                ? "bg-[#ea580c] !text-white"
                                : "bg-[var(--app-solid-surface-2)] text-[var(--app-text-65)]",
                            ].join(" ")}
                          >
                            {meta.label}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="hidden min-[1201px]:flex min-h-0 min-w-0 w-full flex-1 h-0 overflow-hidden">
          {renderLeadDetailSection()}
        </div>
      </div>

      <AppModal
        open={leadDetailOpen}
        onClose={() => setLeadDetailOpen(false)}
        size="xl"
        zIndexClass="z-[320]"
        fullScreenOnMobile
      >
        {renderLeadDetailSection()}
      </AppModal>

      {renderCreateLeadModal()}
    </div>
  );
}
