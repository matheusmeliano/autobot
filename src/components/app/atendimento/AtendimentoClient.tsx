"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
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

function sortAndDedupeMessages(messageList: AtendimentoMessage[]) {
  const unique = new Map<string, AtendimentoMessage>();
  for (const message of messageList) {
    const key =
      String(message.id ?? "").trim() ||
      `${message.created_at}:${message.sender_role}:${message.content_text ?? ""}:${message.media_url ?? ""}`;
    unique.set(key, message);
  }

  return Array.from(unique.values()).sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

function sameMessages(left: AtendimentoMessage[], right: AtendimentoMessage[]) {
  if (left.length !== right.length) return false;
  return left.every((message, index) => {
    const other = right[index];
    return (
      String(message.id ?? "") === String(other?.id ?? "") &&
      String(message.status ?? "") === String(other?.status ?? "") &&
      String(message.content_text ?? "") === String(other?.content_text ?? "") &&
      String(message.media_url ?? "") === String(other?.media_url ?? "") &&
      String(message.file_name ?? "") === String(other?.file_name ?? "") &&
      String(message.file_size_bytes ?? "") === String(other?.file_size_bytes ?? "") &&
      String(message.created_at ?? "") === String(other?.created_at ?? "") &&
      String(message.read_at ?? "") === String(other?.read_at ?? "")
    );
  });
}

export function AtendimentoClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [summary, setSummary] = useState<AtendimentoSummary>(EMPTY_SUMMARY);
  const [publicUrl, setPublicUrl] = useState("");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<AtendimentoConversation | null>(null);
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [desktopListHeight, setDesktopListHeight] = useState<number | null>(null);
  const selectedLeadIdRef = useRef<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const queryRef = useRef("");
  const listRefreshTimeoutRef = useRef<number | null>(null);
  const detailRefreshTimeoutRef = useRef<number | null>(null);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSuspendedRef = useRef(false);
  const realtimeSubscribedRef = useRef(false);
  const leadsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);

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
    async (nextQuery: string, options?: { silent?: boolean }) => {
      const requestId = ++leadsRequestIdRef.current;
      const silent = Boolean(options?.silent);
      if (!silent) {
        setLoading(true);
      }
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const res = await fetch(`/api/atendimento/leads?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok && requestId === leadsRequestIdRef.current) {
        const nextLeads = (json.leads ?? []) as AtendimentoLeadListItem[];
        setLeads(nextLeads);
        if (!selectedLeadId && nextLeads[0]?.id) setSelectedLeadId(String(nextLeads[0].id));
        setLoadError(null);
      } else if (json?.error) {
        const message = String(json?.error ?? "Falha ao carregar atendimentos.");
        setLoadError(message);
        modalToast.error(message);
      }
      if (!silent) {
        setLoading(false);
      }
    },
    [selectedLeadId],
  );

  const applyMessages = useCallback((incomingMessages: AtendimentoMessage[], mode: "replace" | "merge" = "replace") => {
    const normalizedMessages = sortAndDedupeMessages(incomingMessages);
    setMessages((currentMessages) => {
      const nextMessages =
        mode === "merge"
          ? sortAndDedupeMessages([...currentMessages, ...normalizedMessages])
          : normalizedMessages;
      return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
    });
  }, []);

  const removeMessage = useCallback((messageId: string) => {
    setMessages((currentMessages) => {
      const nextMessages = currentMessages.filter((message) => String(message.id) !== messageId);
      return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
    });
  }, []);

  const loadConversationMessages = useCallback(
    async (conversationId: string, mode: "replace" | "merge" = "replace", options?: { showLoading?: boolean }) => {
      if (!conversationId) return;
      const requestId = ++messagesRequestIdRef.current;
      if (options?.showLoading) setMessagesLoading(true);
      const messagesRes = await fetch(`/api/atendimento/conversas/${conversationId}/messages`, { cache: "no-store" });
      const messagesJson = await messagesRes.json().catch(() => null);
      if (messagesJson?.ok && requestId === messagesRequestIdRef.current) {
        applyMessages((messagesJson.messages ?? []) as AtendimentoMessage[], mode);
        if (options?.showLoading) setMessagesLoading(false);
        return;
      }
      const message = String(messagesJson?.error ?? "Falha ao carregar mensagens.");
      setLoadError(message);
      modalToast.error(message);
      if (options?.showLoading && requestId === messagesRequestIdRef.current) setMessagesLoading(false);
    },
    [applyMessages],
  );

  const loadLeadDetail = useCallback(
    async (leadId: string, options?: { skipMessages?: boolean; suppressNotFound?: boolean }) => {
      const requestId = ++detailRequestIdRef.current;
      const res = await fetch(`/api/atendimento/leads/${leadId}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        const errorMessage = String(json?.error ?? "Falha ao carregar detalhes do lead.");
        if (options?.suppressNotFound && errorMessage === "not_found") {
          return;
        }
        setLoadError(errorMessage);
        modalToast.error(errorMessage);
        return;
      }

      if (requestId !== detailRequestIdRef.current) {
        return;
      }

      const nextConversation = (json.lead?.conversation ?? null) as AtendimentoConversation | null;
      setSelectedConversation(nextConversation);
      selectedConversationIdRef.current = String(nextConversation?.id ?? "") || null;
      setLoadError(null);

      const conversationId = String(nextConversation?.id ?? "");
      if (!conversationId) {
        setMessages([]);
        setMessagesLoading(false);
        return;
      }

      if (!options?.skipMessages) {
        await loadConversationMessages(conversationId, "replace", { showLoading: true });
      } else {
        setMessagesLoading(false);
      }
    },
    [loadConversationMessages],
  );

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
    selectedLeadIdRef.current = selectedLeadId;
  }, [selectedLeadId]);

  useEffect(() => {
    selectedConversationIdRef.current = String(selectedConversation?.id ?? "") || null;
  }, [selectedConversation]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

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

  const scheduleListRefresh = useCallback(() => {
    if (realtimeSuspendedRef.current) return;
    if (listRefreshTimeoutRef.current != null) {
      window.clearTimeout(listRefreshTimeoutRef.current);
    }
    listRefreshTimeoutRef.current = window.setTimeout(() => {
      void loadSummary();
      void loadLeads(queryRef.current, { silent: true });
    }, 120);
  }, [loadLeads, loadSummary]);

  const scheduleSelectedLeadRefresh = useCallback(() => {
    if (realtimeSuspendedRef.current || !selectedLeadIdRef.current) return;
    if (detailRefreshTimeoutRef.current != null) {
      window.clearTimeout(detailRefreshTimeoutRef.current);
    }
    detailRefreshTimeoutRef.current = window.setTimeout(() => {
      if (!selectedLeadIdRef.current) return;
      void loadLeadDetail(selectedLeadIdRef.current, { skipMessages: true, suppressNotFound: true });
    }, 120);
  }, [loadLeadDetail]);

  const startFallbackRefresh = useCallback(() => {
    if (fallbackRefreshIntervalRef.current != null) return;
    fallbackRefreshIntervalRef.current = window.setInterval(() => {
      if (realtimeSuspendedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadSummary();
      void loadLeads(queryRef.current, { silent: true });
      if (selectedLeadIdRef.current) {
        void loadLeadDetail(selectedLeadIdRef.current, { suppressNotFound: true });
      }
    }, 1500);
  }, [loadLeadDetail, loadLeads, loadSummary]);

  const stopFallbackRefresh = useCallback(() => {
    if (fallbackRefreshIntervalRef.current != null) {
      window.clearInterval(fallbackRefreshIntervalRef.current);
      fallbackRefreshIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    startFallbackRefresh();
    return () => {
      stopFallbackRefresh();
    };
  }, [startFallbackRefresh, stopFallbackRefresh]);

  useEffect(() => {
    const channel = supabase
      .channel("atendimento-private")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimento_leads" }, (payload: any) => {
        scheduleListRefresh();
        const affectedLeadId = String(payload.new?.id ?? payload.old?.id ?? "");
        if (affectedLeadId && affectedLeadId === selectedLeadIdRef.current) {
          scheduleSelectedLeadRefresh();
        }
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atendimento_conversations" },
        (payload: any) => {
        scheduleListRefresh();
        const affectedConversationId = String(payload.new?.id ?? payload.old?.id ?? "");
        if (affectedConversationId && affectedConversationId === selectedConversationIdRef.current) {
          scheduleSelectedLeadRefresh();
        }
      },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimento_messages" }, (payload: any) => {
        const affectedConversationId = String(payload.new?.conversation_id ?? payload.old?.conversation_id ?? "");
        if (affectedConversationId && affectedConversationId === selectedConversationIdRef.current) {
          if (payload.eventType === "DELETE") {
            removeMessage(String(payload.old?.id ?? ""));
          } else {
            const nextMessage = (payload.new ?? null) as AtendimentoMessage | null;
            if (nextMessage?.id) {
              applyMessages([nextMessage], "merge");
            } else {
              void loadConversationMessages(affectedConversationId, "replace");
            }
          }
        }
        scheduleListRefresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeSubscribedRef.current = true;
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeSubscribedRef.current = false;
          void loadSummary();
          void loadLeads(queryRef.current, { silent: true });
        }
      });

    return () => {
      realtimeSubscribedRef.current = false;
      if (listRefreshTimeoutRef.current != null) {
        window.clearTimeout(listRefreshTimeoutRef.current);
        listRefreshTimeoutRef.current = null;
      }
      if (detailRefreshTimeoutRef.current != null) {
        window.clearTimeout(detailRefreshTimeoutRef.current);
        detailRefreshTimeoutRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [
    applyMessages,
    loadConversationMessages,
    loadLeads,
    loadSummary,
    removeMessage,
    scheduleListRefresh,
    scheduleSelectedLeadRefresh,
    startFallbackRefresh,
    stopFallbackRefresh,
    supabase,
  ]);

  async function handleCopyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    modalToast.success("Link copiado.");
  }

  async function handleSendMessage(payload: {
    content_text?: string;
    media_type?: AtendimentoMessage["media_type"];
    media_url?: string | null;
    mime_type?: string | null;
    file_name?: string | null;
    file_size_bytes?: number | null;
  }) {
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
      if (json.message?.id) {
        applyMessages([json.message as AtendimentoMessage], "merge");
      }
      scheduleListRefresh();
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteLead(lead: AtendimentoLeadListItem) {
    realtimeSuspendedRef.current = true;
    const res = await fetch(`/api/atendimento/leads/${lead.id}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      realtimeSuspendedRef.current = false;
      throw new Error(String(json?.error ?? "Falha ao excluir lead."));
    }

    if (selectedLeadId === lead.id) {
      const fallbackLeadId = leads.find((item) => item.id !== lead.id)?.id ?? null;
      selectedLeadIdRef.current = fallbackLeadId;
      setSelectedLeadId(fallbackLeadId);
      setSelectedConversation(null);
      setMessages([]);
      setMobileConversationOpen(false);
    }

    await loadSummary();
    await loadLeads(query);
    realtimeSuspendedRef.current = false;
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
            CRM exclusivo para captação, acompanhamento e conversão dos alunos do projeto Lucas Brum Online Music USA.
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75 sm:shrink-0">
              Link de Atendimento
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
              {publicUrl || "Carregando link..."}
            </div>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] sm:shrink-0"
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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <AtendimentoLeadList
          leads={leads}
          query={query}
          loading={loading}
          selectedLeadId={selectedLeadId}
          onQueryChange={setQuery}
          onListHeightChange={setDesktopListHeight}
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
        <div className="hidden lg:block" style={desktopListHeight != null ? { height: desktopListHeight } : undefined}>
          <AtendimentoConversationPanel
            conversation={selectedConversation}
            messages={messages}
            messagesLoading={messagesLoading}
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
          zIndexClass="z-[320]"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

            <div className="mt-4 min-h-0 flex-1 overflow-hidden">
              <AtendimentoConversationPanel
                compact
                conversation={selectedConversation}
                messages={messages}
                messagesLoading={messagesLoading}
                disabled={sending}
                onSendMessage={handleSendMessage}
              />
            </div>
          </div>
        </AppModal>
      </div>
    </div>
  );
}
