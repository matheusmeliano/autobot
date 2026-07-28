"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { AtendimentoSummaryCards } from "@/components/app/atendimento/AtendimentoSummaryCards";
import { modalToast } from "@/lib/modalToast";

const EMPTY_SUMMARY: AtendimentoSummary = {
  totalLeads: 0,
  novosLeads: 0,
  emAtendimento: 0,
  aulasExperimentaisAgendadas: 0,
  matriculasPendentes: 0,
  matriculados: 0,
  conversasNaoLidas: 0,
};

export function AtendimentoClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [summary, setSummary] = useState<AtendimentoSummary>(EMPTY_SUMMARY);
  const [panelLeads, setPanelLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSubscribedRef = useRef(false);

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

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSummary(), loadPanelLeads()])
      .then(() => {
        setLoadError(null);
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

  return (
    <div className="flex min-h-0 min-w-0 h-full w-full flex-col gap-4 bg-[var(--app-bg)]">
      <div className="shrink-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 lg:px-5 lg:py-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--app-text-45)]">
              Painel de Dados
            </div>
            <div className="mt-0.5 truncate text-[17px] font-semibold tracking-tight text-[var(--app-text-90)]">
              Atendimento Lucas Brum Online Music USA
            </div>
          </div>
          <div className="sm:ml-auto">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loading}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-xs font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>
        {loading && !loadError ? (
          <div className="mt-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-3 text-xs text-[var(--app-text-55)]">
            Carregando painel...
          </div>
        ) : null}
        {loadError ? (
          <div className="mt-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-3 text-xs text-[var(--app-text-55)]">
            {loadError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <AtendimentoSummaryCards summary={summary} leads={panelLeads} />
      </div>
    </div>
  );
}
