"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, RefreshCw, Search, Trash2, X } from "lucide-react";
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

function AtendimentoLinkCard({
  publicUrl,
  onCopy,
}: {
  publicUrl: string;
  onCopy: () => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75 sm:shrink-0">
          Link de Atendimento
        </div>
        <div
          className="min-w-0 flex-1 truncate text-sm font-semibold text-white"
          title={publicUrl || undefined}
        >
          {publicUrl || "Carregando link..."}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] sm:shrink-0"
        >
          <Copy className="h-4 w-4" />
          Copiar Link
        </button>
      </div>
    </div>
  );
}

function LeadRow({
  lead,
  onDelete,
  deleting,
}: {
  lead: AtendimentoLeadListItem;
  onDelete: (leadId: string) => void;
  deleting: boolean;
}) {
  const funnelStage = String((lead as any)?.funnel_stage ?? "").trim() || "novo_lead";
  const status = String((lead as any)?.status ?? "").trim() || "novo_lead";
  const phone = String((lead as any)?.phone ?? "").trim();
  const city = String((lead as any)?.city ?? "").trim();
  const state = String((lead as any)?.state ?? "").trim();
  const createdAtRaw = String((lead as any)?.created_at ?? "").trim();
  const createdAt = createdAtRaw ? new Date(createdAtRaw).toLocaleString("pt-BR") : "";
  const origin = String((lead as any)?.origin ?? "").trim();

  return (
    <div className="group grid grid-cols-12 items-center gap-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-5 py-4 transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-hover)]">
      <div className="col-span-12 min-[960px]:col-span-5 min-w-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--app-accent)]/30 to-[var(--app-accent)]/5 text-sm font-bold text-[var(--app-accent)] ring-1 ring-inset ring-[var(--app-accent)]/20">
            {(String((lead as any)?.full_name ?? "L ").trim() || "L ")
              .split(" ")
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("")
              .slice(0, 2) || "L"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight text-[var(--app-text-92)]">
              {String((lead as any)?.full_name ?? "").trim() || "Lead sem nome"}
            </div>
            <div className="mt-0.5 truncate text-xs text-[var(--app-text-55)]">
              {phone || "Telefone não identificado"}
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-12 min-[960px]:col-span-3 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-indigo-300">
            Funnel · {funnelStage.replace(/_/g, " ")}
          </span>
          <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-300">
            {status.replace(/_/g, " ")}
          </span>
          {origin ? (
            <span className="inline-flex items-center rounded-full border border-[var(--app-accent)]/20 bg-[var(--app-accent)]/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--app-accent)]">
              {origin.replace(/_/g, " ")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="col-span-12 min-[960px]:col-span-2 min-w-0">
        <div className="truncate text-sm font-medium text-[var(--app-text-78)]">
          {city && state ? `${city}/${state}` : state || city || "Localização pendente"}
        </div>
        {createdAt ? (
          <div className="mt-0.5 truncate text-[11px] text-[var(--app-text-52)]">
            Criado em {createdAt}
          </div>
        ) : null}
      </div>

      <div className="col-span-12 min-[960px]:col-span-2 flex min-[960px]:justify-end">
        <button
          type="button"
          onClick={() => onDelete(String((lead as any)?.id ?? ""))}
          disabled={deleting}
          title="Excluir lead — zera todo histórico e atendimento para este número"
          className="inline-flex w-full min-[960px]:w-auto items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3.5 py-2 text-xs font-semibold text-red-400 transition hover:border-red-500/50 hover:bg-red-500/12 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir lead
        </button>
      </div>
    </div>
  );
}

function DeleteLeadConfirmDialog({
  lead,
  onCancel,
  onConfirm,
  working,
}: {
  lead: AtendimentoLeadListItem | null;
  onCancel: () => void;
  onConfirm: () => void;
  working: boolean;
}) {
  if (!lead) return null;
  const name = String((lead as any)?.full_name ?? "").trim() || "Lead sem nome";
  const phone = String((lead as any)?.phone ?? "").trim() || "-";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-400">
              Excluir lead
            </div>
            <div className="mt-1 truncate text-lg font-semibold text-[var(--app-text-90)]">
              {name}
            </div>
            <div className="mt-0.5 text-xs text-[var(--app-text-55)]">{phone}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-60)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-200">
          <p>
            <span className="font-semibold text-red-300">Atenção:</span> esta ação é permanente e
            não pode ser desfeita.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Todas as mensagens da conversa serão apagadas.</li>
            <li>Histórico completo de eventos de atendimento será apagado.</li>
            <li>Agendamento de aula experimental (se existir) será apagado.</li>
            <li>Campos capturados serão apagados.</li>
            <li>
              Se este mesmo número enviar uma nova mensagem no WhatsApp, o atendimento irá
              reiniciar do zero, como se fosse o primeiro contato.
            </li>
          </ul>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-80)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={working}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AtendimentoClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [summary, setSummary] = useState<AtendimentoSummary>(EMPTY_SUMMARY);
  const [publicUrl, setPublicUrl] = useState("");
  const [panelLeads, setPanelLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSubscribedRef = useRef(false);
  const [leadSearchQuery, setLeadSearchQuery] = useState("");
  const [deleteLeadDialog, setDeleteLeadDialog] = useState<AtendimentoLeadListItem | null>(null);
  const [deleteWorking, setDeleteWorking] = useState(false);

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

  const loadPublicLink = useCallback(async () => {
    const res = await fetch("/api/atendimento/link-publico", { cache: "no-store" });
    if (handleForbiddenResponse(res)) return;
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      setPublicUrl(String(json.link?.public_url ?? ""));
      return;
    }
    const message = String(json?.error ?? "Falha ao carregar link público.");
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

  async function handleCopyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    modalToast.success("Link copiado.");
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([loadSummary({ silent: true }), loadPanelLeads(), loadPublicLink()]);
      modalToast.success("Painel atualizado.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDeleteLeadConfirm() {
    if (!deleteLeadDialog || deleteWorking) return;
    const leadId = String((deleteLeadDialog as any)?.id ?? "").trim();
    if (!leadId) return;
    setDeleteWorking(true);
    try {
      const res = await fetch(`/api/atendimento/leads/${encodeURIComponent(leadId)}`, {
        method: "DELETE",
      });
      if (handleForbiddenResponse(res)) return;
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        throw new Error(String(json?.error ?? "Falha ao excluir lead."));
      }
      modalToast.success("Lead excluído completamente.");
      setDeleteLeadDialog(null);
      setPanelLeads((current) =>
        current.filter((row) => String((row as any)?.id ?? "") !== leadId),
      );
      await loadSummary({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao excluir lead.";
      modalToast.error(message);
    } finally {
      setDeleteWorking(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSummary(), loadPublicLink(), loadPanelLeads()])
      .then(() => {
        setLoadError(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadPanelLeads, loadPublicLink, loadSummary]);

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
    <div className="flex min-h-0 min-w-0 flex-col gap-5 bg-[var(--app-bg)] lg:h-full lg:min-h-0">
      <div className="mx-auto w-full max-w-[1480px] flex-1 px-0 sm:px-3 lg:px-6 xl:px-10 2xl:px-16">
        <div className="shrink-0 rounded-[2rem] border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <div className="flex flex-col gap-3 min-[880px]:flex-row min-[880px]:items-center min-[880px]:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--app-text-45)]">
                Painel de Dados
              </div>
              <div className="mt-1 truncate text-[20px] font-semibold tracking-tight text-[var(--app-text-90)]">
                Atendimento Lucas Brum Online Music USA
              </div>
              <div className="mt-1 text-xs text-[var(--app-text-58)]">
                Visão consolidada dos leads, agendamentos e conversas por WhatsApp.
              </div>
            </div>
            <div className="min-[880px]:ml-auto">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-5 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Atualizando..." : "Atualizar painel"}
              </button>
            </div>
          </div>
          {loading && !loadError ? (
            <div className="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 text-sm text-[var(--app-text-55)]">
              Carregando painel...
            </div>
          ) : null}
          {loadError ? (
            <div className="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 text-sm text-[var(--app-text-55)]">
              {loadError}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col gap-5">
          <AtendimentoLinkCard publicUrl={publicUrl} onCopy={handleCopyLink} />
          <AtendimentoSummaryCards summary={summary} leads={panelLeads} />
          <div className="rounded-[2rem] border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 sm:p-5 lg:p-7">
            <div className="flex flex-col gap-4 min-[980px]:flex-row min-[980px]:items-start min-[980px]:justify-between">
              <div className="min-w-0 flex-1 pr-0 min-[980px]:pr-12">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--app-text-45)]">
                  Gerenciar Leads
                </div>
                <div className="mt-1.5 text-[17px] font-semibold leading-snug text-[var(--app-text-90)]">
                  Exclua um lead para zerar todo o histórico e reiniciar o fluxo do WhatsApp
                </div>
                <div className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-[var(--app-text-58)]">
                  Ao confirmar a exclusão, todas as mensagens, eventos do histórico, campos
                  capturados e agendamentos são apagados permanentemente. O mesmo número poderá
                  enviar uma nova mensagem que o bot iniciará do zero, como se fosse o primeiro
                  contato.
                </div>
              </div>
              <label className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3 min-[980px]:w-[440px] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
                <Search className="h-4 w-4 shrink-0 text-[var(--app-text-48)]" />
                <input
                  value={leadSearchQuery}
                  onChange={(e) => setLeadSearchQuery(e.target.value)}
                  placeholder="Buscar por nome, telefone ou e-mail..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--app-text-88)] placeholder:text-[var(--app-text-45)] focus:outline-none"
                />
              </label>
            </div>
            <LeadsGrid
              panelLeads={panelLeads}
              leadSearchQuery={leadSearchQuery}
              onDelete={(row) => setDeleteLeadDialog(row)}
            />
          </div>
        </div>
      </div>
      <DeleteLeadConfirmDialog
        lead={deleteLeadDialog}
        onCancel={() => {
          if (deleteWorking) return;
          setDeleteLeadDialog(null);
        }}
        onConfirm={() => void handleDeleteLeadConfirm()}
        working={deleteWorking}
      />
    </div>
  );
}

function LeadsGrid({
  panelLeads,
  leadSearchQuery,
  onDelete,
}: {
  panelLeads: AtendimentoLeadListItem[];
  leadSearchQuery: string;
  onDelete: (row: AtendimentoLeadListItem) => void;
}) {
  const filtered = useMemo(() => {
    const q = String(leadSearchQuery ?? "").trim().toLowerCase();
    if (!q) return panelLeads.slice(0, 80);
    return panelLeads
      .filter((row) => {
        const name = String((row as any)?.full_name ?? "").toLowerCase();
        const phone = String((row as any)?.phone ?? "").toLowerCase();
        const email = String((row as any)?.email ?? "").toLowerCase();
        return (
          name.includes(q) ||
          phone.includes(q) ||
          email.includes(q) ||
          String(q).replace(/\D/g, "") &&
            phone.replace(/\D/g, "").includes(String(q).replace(/\D/g, ""))
        );
      })
      .slice(0, 80);
  }, [panelLeads, leadSearchQuery]);

  if (!panelLeads.length) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)] p-8 text-center text-sm text-[var(--app-text-55)]">
        Nenhum lead encontrado no painel.
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-2.5 max-h-[640px] overflow-y-auto pr-1.5 scroll-smooth">
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)] p-8 text-center text-sm text-[var(--app-text-55)]">
          Nenhum lead corresponde à busca.
        </div>
      ) : (
        filtered.map((row) => (
          <LeadRow
            key={String((row as any)?.id ?? "")}
            lead={row}
            onDelete={() => onDelete(row)}
            deleting={false}
          />
        ))
      )}
    </div>
  );
}
