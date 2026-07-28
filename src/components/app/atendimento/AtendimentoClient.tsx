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
  const lastInteractionRaw =
    String((lead as any)?.last_interaction_at ?? "").trim() ||
    String((lead as any)?.conversation?.last_message_at ?? "").trim() ||
    String((lead as any)?.updated_at ?? "").trim();
  const lastInteraction = lastInteractionRaw
    ? new Date(lastInteractionRaw).toLocaleString("pt-BR")
    : "";
  const name = String((lead as any)?.full_name ?? "").trim() || "Lead sem nome";
  const initials = (name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") ||
    "L").slice(0, 2);

  return (
    <div className="group grid grid-cols-12 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2.5 transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-hover)]">
      <div className="col-span-12 min-[1024px]:col-span-4 min-w-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] text-[11px] font-bold text-[var(--app-text-70)]">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[13.5px] font-semibold leading-tight text-[var(--app-text-92)]"
              title={name}
            >
              {name}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-[var(--app-text-55)]" title={phone}>
              {phone || "Telefone não identificado"}
            </div>
          </div>
        </div>
      </div>

      <div className="col-span-7 min-[1024px]:col-span-4 min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <span className="inline-flex items-center rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-wide text-indigo-300">
            {funnelStage.replace(/_/g, " ")}
          </span>
          <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-wide text-emerald-300">
            {status.replace(/_/g, " ")}
          </span>
        </div>
        <div className="mt-1.5 truncate text-[11px] text-[var(--app-text-52)]">
          {lastInteraction ? `Última interação: ${lastInteraction}` : createdAt ? `Criado em ${createdAt}` : ""}
        </div>
      </div>

      <div className="col-span-5 min-[1024px]:col-span-2 min-w-0">
        <div
          className="truncate text-[12.5px] font-medium text-[var(--app-text-78)]"
          title={city && state ? `${city}/${state}` : state || city || "Localização pendente"}
        >
          {city && state ? `${city}/${state}` : state || city || "Localização pendente"}
        </div>
      </div>

      <div className="col-span-12 min-[1024px]:col-span-2 flex min-[1024px]:justify-end">
        <button
          type="button"
          onClick={() => onDelete(String((lead as any)?.id ?? ""))}
          disabled={deleting}
          title="Excluir lead — zera todo histórico e atendimento para este número"
          className="inline-flex w-full min-[1024px]:w-auto items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-[11px] font-semibold text-red-400 transition hover:border-red-500/50 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
          Excluir
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
    <div className="flex min-h-0 min-w-0 h-full w-full flex-col gap-3 bg-[var(--app-bg)] p-3 lg:p-4">
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
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-xs font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="shrink-0">
        <AtendimentoLinkCard publicUrl={publicUrl} onCopy={handleCopyLink} />
      </div>

      <div className="shrink-0">
        <AtendimentoSummaryCards summary={summary} leads={panelLeads} />
      </div>

      <div className="min-h-0 min-w-0 flex-1 lg:block lg:h-full">
        <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3 lg:h-full lg:overflow-y-auto lg:pr-1.5">
          <div className="min-w-0 flex flex-col gap-3 border-b border-[var(--app-border)] pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--app-text-45)]">
                Gerenciar Leads
              </div>
              <div className="mt-1 truncate text-base font-semibold text-[var(--app-text-90)]">
                Exclua um lead para zerar o histórico e reiniciar o fluxo do WhatsApp
              </div>
              <div className="mt-1 truncate text-[12px] text-[var(--app-text-58)]">
                Excluir remove mensagens, histórico, campos capturados e agendamentos. O mesmo
                número poderá iniciar um novo atendimento do zero.
              </div>
            </div>
            <label className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 sm:w-[360px]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-48)]" />
              <input
                value={leadSearchQuery}
                onChange={(e) => setLeadSearchQuery(e.target.value)}
                placeholder="Buscar nome, telefone ou e-mail..."
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--app-text-88)] placeholder:text-[var(--app-text-45)] focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-3">
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
      <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)] p-6 text-center text-xs text-[var(--app-text-55)]">
        Nenhum lead encontrado no painel.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)] p-6 text-center text-xs text-[var(--app-text-55)]">
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
