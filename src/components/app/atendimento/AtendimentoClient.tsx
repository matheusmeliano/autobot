"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  AtendimentoConversation,
  AtendimentoLeadListItem,
  AtendimentoMessage,
  AtendimentoSummary,
} from "@/lib/atendimento/types";
import { AtendimentoConversationPanel } from "@/components/app/atendimento/AtendimentoConversationPanel";
import { AtendimentoLeadList } from "@/components/app/atendimento/AtendimentoLeadList";
import { AtendimentoSummaryCards } from "@/components/app/atendimento/AtendimentoSummaryCards";
import { AppModal } from "@/components/app/AppModal";
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
  const [publicUrl, setPublicUrl] = useState("");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<AtendimentoConversation | null>(null);
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    const res = await fetch("/api/atendimento/resumo", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      setSummary(json.summary as AtendimentoSummary);
      setLoadError(null);
      return;
    }
    const message = String(json?.error ?? "Falha ao carregar resumo.");
    setLoadError(message);
    modalToast.error(message);
  }, []);

  const loadPublicLink = useCallback(async () => {
    const res = await fetch("/api/atendimento/link-publico", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      setPublicUrl(String(json.link?.public_url ?? ""));
      return;
    }
    const message = String(json?.error ?? "Falha ao carregar link público.");
    setLoadError(message);
    modalToast.error(message);
  }, []);

  const loadLeads = useCallback(
    async (nextQuery: string) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const res = await fetch(`/api/atendimento/leads?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        const nextLeads = (json.leads ?? []) as AtendimentoLeadListItem[];
        setLeads(nextLeads);
        if (!selectedLeadId && nextLeads[0]?.id) setSelectedLeadId(String(nextLeads[0].id));
        setLoadError(null);
      } else if (json?.error) {
        const message = String(json?.error ?? "Falha ao carregar atendimentos.");
        setLoadError(message);
        modalToast.error(message);
      }
      setLoading(false);
    },
    [selectedLeadId],
  );

  const loadLeadDetail = useCallback(async (leadId: string) => {
    const res = await fetch(`/api/atendimento/leads/${leadId}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      const message = String(json?.error ?? "Falha ao carregar detalhes do lead.");
      setLoadError(message);
      modalToast.error(message);
      return;
    }
    setSelectedConversation((json.lead?.conversation ?? null) as AtendimentoConversation | null);
    setLoadError(null);

    const conversationId = String(json.lead?.conversation?.id ?? "");
    if (!conversationId) {
      setMessages([]);
      return;
    }

    const messagesRes = await fetch(`/api/atendimento/conversas/${conversationId}/messages`, { cache: "no-store" });
    const messagesJson = await messagesRes.json().catch(() => null);
    if (messagesJson?.ok) {
      setMessages((messagesJson.messages ?? []) as AtendimentoMessage[]);
      return;
    }
    const message = String(messagesJson?.error ?? "Falha ao carregar mensagens.");
    setLoadError(message);
    modalToast.error(message);
  }, []);

  useEffect(() => {
    loadSummary();
    loadPublicLink();
    loadLeads(query);
  }, [loadLeads, loadPublicLink, loadSummary, query]);

  useEffect(() => {
    if (!selectedLeadId) return;
    loadLeadDetail(selectedLeadId);
  }, [loadLeadDetail, selectedLeadId]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      if (mobileConversationOpen && media.matches) {
        setMobileConversationOpen(false);
      }
    };
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, [mobileConversationOpen]);

  useEffect(() => {
    const channel = supabase
      .channel("atendimento-private")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimento_leads" }, () => {
        loadSummary();
        loadLeads(query);
        if (selectedLeadId) loadLeadDetail(selectedLeadId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimento_messages" }, () => {
        loadSummary();
        loadLeads(query);
        if (selectedLeadId) loadLeadDetail(selectedLeadId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLeadDetail, loadLeads, loadSummary, query, selectedLeadId, supabase]);

  async function handleCopyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    modalToast.success("Link copiado.");
  }

  async function handleSendMessage(payload: { content_text: string }) {
    if (!selectedConversation?.id) return;
    setSending(true);
    try {
      const res = await fetch(`/api/atendimento/conversas/${selectedConversation.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        modalToast.error(json?.error ?? "Falha ao enviar mensagem.");
        return;
      }
      await loadLeadDetail(selectedLeadId || "");
      await loadSummary();
      await loadLeads(query);
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteLead(lead: AtendimentoLeadListItem) {
    const res = await fetch(`/api/atendimento/leads/${lead.id}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      throw new Error(String(json?.error ?? "Falha ao excluir lead."));
    }

    if (selectedLeadId === lead.id) {
      const fallbackLeadId = leads.find((item) => item.id !== lead.id)?.id ?? null;
      setSelectedLeadId(fallbackLeadId);
      setSelectedConversation(null);
      setMessages([]);
      setMobileConversationOpen(false);
    }

    await loadSummary();
    await loadLeads(query);
    modalToast.success("Lead excluído definitivamente.");
    window.location.reload();
  }

  function openMobileConversation(leadId: string) {
    setSelectedLeadId(leadId);
    setMobileConversationOpen(true);
  }

  return (
    <div>
      {loadError ? (
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 text-sm text-[var(--app-text-55)]">
          {loadError}
        </div>
      ) : null}
      <div>
        <div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Atendimento</h1>
          <div className="mt-2 text-sm text-white/60">
            CRM exclusivo para captação, acompanhamento e conversão dos leads do projeto Lucas Brum Online Music USA.
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75 sm:shrink-0">
              Link Publico de Atendimento
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
              {publicUrl || "Carregando link..."}
            </div>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15 sm:shrink-0"
            >
              <Copy className="h-4 w-4" />
              Copiar Link
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <AtendimentoSummaryCards summary={summary} />
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
        <div className="flex flex-col gap-3 xl:flex-row">
          <label className="flex flex-1 items-center gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
            <Search className="h-4 w-4 text-[var(--app-text-45)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar por nome, telefone ou CPF"
              className="w-full bg-transparent text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)]"
            />
          </label>
          <div className="flex items-center text-sm text-[var(--app-text-45)]">
            {loading ? "Atualizando atendimentos..." : `${leads.length} atendimento(s) encontrado(s)`}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <AtendimentoLeadList
          leads={leads}
          selectedLeadId={selectedLeadId}
          onSelectLead={(leadId) => setSelectedLeadId(leadId)}
          onOpenConversation={openMobileConversation}
          onDeleteLead={async (lead) => {
            try {
              await handleDeleteLead(lead);
            } catch (error) {
              modalToast.error(error instanceof Error ? error.message : "Falha ao excluir lead.");
              throw error;
            }
          }}
        />
        <div className="hidden lg:block lg:h-[34rem]">
          <AtendimentoConversationPanel
            conversation={selectedConversation}
            messages={messages}
            disabled={sending}
            onSendMessage={handleSendMessage}
          />
        </div>
      </div>

      <div className="lg:hidden">
        <AppModal
          open={mobileConversationOpen}
          onClose={() => setMobileConversationOpen(false)}
          position="bottom"
          size="xl"
          zIndexClass="z-[120]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--app-text-85)]">Conversa</div>
              <div className="mt-1 text-xs text-[var(--app-text-55)]">Envie mensagens para o lead por aqui.</div>
            </div>
            <button
              type="button"
              onClick={() => setMobileConversationOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <AtendimentoConversationPanel
              compact
              conversation={selectedConversation}
              messages={messages}
              disabled={sending}
              onSendMessage={handleSendMessage}
            />
          </div>
        </AppModal>
      </div>
    </div>
  );
}
