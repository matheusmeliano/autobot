"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
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

function getLeadSortTime(lead: AtendimentoLeadListItem) {
  const candidates = [
    lead.last_interaction_at,
    lead.conversation?.last_message_at,
    lead.conversation?.updated_at,
    lead.updated_at,
    lead.created_at,
  ];

  for (const candidate of candidates) {
    const time = new Date(String(candidate ?? "")).getTime();
    if (Number.isFinite(time) && time > 0) return time;
  }

  return 0;
}

function sortLeadsByRecentActivity(items: AtendimentoLeadListItem[]) {
  return items.slice().sort((left, right) => {
    const timeDiff = getLeadSortTime(right) - getLeadSortTime(left);
    if (timeDiff !== 0) return timeDiff;

    return new Date(String(right.created_at ?? "")).getTime() - new Date(String(left.created_at ?? "")).getTime();
  });
}

function bumpLeadRecencyByConversation(
  items: AtendimentoLeadListItem[],
  conversationId: string,
  message: AtendimentoMessage | null,
  options?: { markAsUnread?: boolean },
) {
  if (!conversationId) return items;

  let changed = false;
  const shouldMarkAsUnread = Boolean(options?.markAsUnread);
  const nextItems = items.map((lead) => {
    if (String(lead.conversation?.id ?? "") !== conversationId) return lead;

    changed = true;
    const messageTime = String(message?.created_at ?? "").trim() || new Date().toISOString();

    return {
      ...lead,
      unread_count: shouldMarkAsUnread ? Number(lead.unread_count ?? 0) + 1 : Number(lead.unread_count ?? 0),
      is_new_for_attendant: shouldMarkAsUnread ? true : Boolean(lead.is_new_for_attendant),
      last_interaction_at: messageTime,
      conversation: lead.conversation
        ? {
            ...lead.conversation,
            last_message_at: messageTime,
            last_message_preview: String(message?.content_text ?? "").trim() || lead.conversation.last_message_preview,
          }
        : lead.conversation,
    };
  });

  return changed ? sortLeadsByRecentActivity(nextItems) : items;
}

function markLeadConversationAsOpened(items: AtendimentoLeadListItem[], leadId: string | null) {
  const normalizedLeadId = String(leadId ?? "").trim();
  if (!normalizedLeadId) return items;

  let changed = false;
  const nextItems = items.map((lead) => {
    if (String(lead.id ?? "").trim() !== normalizedLeadId) return lead;
    if (Number(lead.unread_count ?? 0) === 0 && !lead.is_new_for_attendant) return lead;

    changed = true;
    return {
      ...lead,
      unread_count: 0,
      is_new_for_attendant: false,
    };
  });

  return changed ? nextItems : items;
}

function clearUnreadForSelectedLead(items: AtendimentoLeadListItem[], leadId: string | null) {
  return markLeadConversationAsOpened(items, leadId);
}

type AtendimentoSidebarModule = "public-link" | "summary";
type AtendimentoRightPanel = "conversation" | AtendimentoSidebarModule;

const SIDEBAR_MODULES: Array<{
  id: AtendimentoSidebarModule;
  label: string;
}> = [
  {
    id: "public-link",
    label: "Link de Atendimento",
  },
  {
    id: "summary",
    label: "Painel de Dados",
  },
];

const LEAD_PRESENCE_CHANNEL = "atendimento-lead-presence";

function getOnlineLeadIdsFromPresence(channel: RealtimeChannel) {
  const state = channel.presenceState<Record<string, unknown>>();
  const onlineLeadIds = new Set<string>();

  for (const entries of Object.values(state)) {
    for (const entry of entries ?? []) {
      const leadId = String(entry?.leadId ?? "").trim();
      const role = String(entry?.role ?? "").trim();
      if (!leadId || role !== "lead") continue;
      onlineLeadIds.add(leadId);
    }
  }

  return Array.from(onlineLeadIds);
}

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

export function AtendimentoClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [summary, setSummary] = useState<AtendimentoSummary>(EMPTY_SUMMARY);
  const [publicUrl, setPublicUrl] = useState("");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [panelLeads, setPanelLeads] = useState<AtendimentoLeadListItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<AtendimentoConversation | null>(null);
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoadError, setMessagesLoadError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [activeView, setActiveView] = useState<AtendimentoSidebarModule>("public-link");
  const [rightPanel, setRightPanel] = useState<AtendimentoRightPanel>("conversation");
  const [mobileModuleOpen, setMobileModuleOpen] = useState<AtendimentoSidebarModule | null>(null);
  const [onlineLeadIds, setOnlineLeadIds] = useState<string[]>([]);
  const leadsRef = useRef<AtendimentoLeadListItem[]>([]);
  const messagesRef = useRef<AtendimentoMessage[]>([]);
  const messagesLoadingRef = useRef(false);
  const messagesLoadingTokenRef = useRef(0);
  const selectedLeadIdRef = useRef<string | null>(null);
  const openedLeadIdRef = useRef<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const rightPanelRef = useRef<AtendimentoRightPanel>("conversation");
  const mobileConversationOpenRef = useRef(false);
  const queryRef = useRef("");
  const listRefreshTimeoutRef = useRef<number | null>(null);
  const detailRefreshTimeoutRef = useRef<number | null>(null);
  const fallbackRefreshIntervalRef = useRef<number | null>(null);
  const realtimeSuspendedRef = useRef(false);
  const realtimeSubscribedRef = useRef(false);
  const leadsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
  const selectedLead = useMemo(
    () => leads.find((lead) => String(lead.id ?? "") === String(selectedLeadId ?? "")) ?? null,
    [leads, selectedLeadId],
  );

  const clearLeadUnreadLocally = useCallback((leadId: string | null) => {
    setLeads((currentLeads) => markLeadConversationAsOpened(currentLeads, leadId));
    setPanelLeads((currentLeads) => markLeadConversationAsOpened(currentLeads, leadId));
  }, []);

  const getOpenedLeadIdForUnreadClear = useCallback(() => {
    const conversationVisible = rightPanelRef.current === "conversation" || mobileConversationOpenRef.current;
    const openedLeadId = String(openedLeadIdRef.current ?? "").trim();
    const selectedLeadId = String(selectedLeadIdRef.current ?? "").trim();
    if (!conversationVisible || !openedLeadId || openedLeadId !== selectedLeadId) {
      return null;
    }
    return openedLeadId;
  }, []);

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
    if (handleForbiddenResponse(res)) {
      if (!silent) setLoading(false);
      return;
    }
      const json = await res.json().catch(() => null);
      if (json?.ok && requestId === leadsRequestIdRef.current) {
        const nextLeads = clearUnreadForSelectedLead(
          sortLeadsByRecentActivity((json.leads ?? []) as AtendimentoLeadListItem[]),
          getOpenedLeadIdForUnreadClear(),
        );
        const currentSelectedLeadId = String(selectedLeadIdRef.current ?? "").trim();
        const preservedSelectedLeadId =
          nextLeads.find((lead) => String(lead.id ?? "").trim() === currentSelectedLeadId)?.id ?? null;
        const fallbackSelectedLeadId = preservedSelectedLeadId ?? nextLeads[0]?.id ?? null;
        setLeads(nextLeads);
        const normalizedFallbackSelectedLeadId =
          fallbackSelectedLeadId != null ? String(fallbackSelectedLeadId) : null;
        if (normalizedFallbackSelectedLeadId !== selectedLeadIdRef.current) {
          selectedLeadIdRef.current = normalizedFallbackSelectedLeadId;
          setSelectedLeadId(normalizedFallbackSelectedLeadId);
        }
        if (!normalizedFallbackSelectedLeadId) {
          selectedConversationIdRef.current = null;
          setSelectedConversation(null);
          setMessages([]);
          setMessagesLoading(false);
          messagesLoadingRef.current = false;
        }
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
    [],
  );

  const loadPanelLeads = useCallback(async () => {
    const res = await fetch("/api/atendimento/leads", { cache: "no-store" });
    if (handleForbiddenResponse(res)) return;
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      setPanelLeads(
        clearUnreadForSelectedLead(
          sortLeadsByRecentActivity((json.leads ?? []) as AtendimentoLeadListItem[]),
          getOpenedLeadIdForUnreadClear(),
        ),
      );
    }
  }, [getOpenedLeadIdForUnreadClear]);

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
      const wantsLoading = Boolean(options?.showLoading);
      if (!wantsLoading && messagesLoadingRef.current) return;
      const requestId = ++messagesRequestIdRef.current;
      if (wantsLoading) {
        messagesLoadingRef.current = true;
        messagesLoadingTokenRef.current = requestId;
        setMessagesLoadError(null);
        setMessagesLoading(true);
      }
      let messagesRes: Response;
      try {
        messagesRes = await fetch(`/api/atendimento/conversas/${conversationId}/messages?limit=200`, { cache: "no-store" });
      } catch (error) {
        const message = "Falha ao carregar as mensagens.";
        if (wantsLoading || messagesRef.current.length === 0) {
          setMessagesLoadError(message);
        }
        if (wantsLoading && requestId === messagesLoadingTokenRef.current) {
          setMessagesLoading(false);
          messagesLoadingRef.current = false;
        }
        return;
      }
      if (handleForbiddenResponse(messagesRes)) {
        if (wantsLoading && requestId === messagesLoadingTokenRef.current) {
          setMessagesLoading(false);
          messagesLoadingRef.current = false;
        }
        return;
      }
      const messagesJson = await messagesRes.json().catch(() => null);
      const acceptResponse = wantsLoading
        ? requestId === messagesLoadingTokenRef.current
        : requestId === messagesRequestIdRef.current;
      if (messagesJson?.ok && acceptResponse) {
        applyMessages((messagesJson.messages ?? []) as AtendimentoMessage[], mode);
        setMessagesLoadError(null);
        if (wantsLoading && requestId === messagesLoadingTokenRef.current) {
          setMessagesLoading(false);
          messagesLoadingRef.current = false;
        }
        return;
      }
      const message = "Falha ao carregar as mensagens.";
      if (wantsLoading || messagesRef.current.length === 0) {
        setMessagesLoadError(message);
      }
      if (wantsLoading && requestId === messagesLoadingTokenRef.current) {
        setMessagesLoading(false);
        messagesLoadingRef.current = false;
      }
    },
    [applyMessages],
  );

  const loadLeadDetail = useCallback(
    async (leadId: string, options?: { skipMessages?: boolean; suppressNotFound?: boolean }) => {
      const requestId = ++detailRequestIdRef.current;
      let res: Response;
      try {
        res = await fetch(`/api/atendimento/leads/${leadId}?skipEvents=1`, { cache: "no-store" });
      } catch (error) {
        setLoadError("Falha ao carregar detalhes do lead.");
        modalToast.error("Falha ao carregar detalhes do lead.");
        if (requestId === detailRequestIdRef.current) {
          setMessagesLoading(false);
          messagesLoadingRef.current = false;
        }
        return;
      }
      if (handleForbiddenResponse(res)) return;
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        const errorMessage = String(json?.error ?? (res.status === 404 ? "not_found" : "Falha ao carregar detalhes do lead."));
        if (errorMessage === "not_found") {
          const fallbackLeadId =
            leadsRef.current.find((lead) => String(lead.id ?? "").trim() !== String(leadId).trim())?.id ?? null;
          const normalizedFallbackLeadId = fallbackLeadId != null ? String(fallbackLeadId) : null;
          selectedLeadIdRef.current = normalizedFallbackLeadId;
          setSelectedLeadId(normalizedFallbackLeadId);
          if (!normalizedFallbackLeadId) {
            selectedConversationIdRef.current = null;
            setSelectedConversation(null);
            setMessages([]);
            setMessagesLoading(false);
            messagesLoadingRef.current = false;
          }
          setLoadError(null);
          if (options?.suppressNotFound) {
            return;
          }
          return;
        }
        if (options?.suppressNotFound) {
          return;
        }
        setLoadError(errorMessage);
        modalToast.error(errorMessage);
        if (requestId === detailRequestIdRef.current) {
          setMessagesLoading(false);
          messagesLoadingRef.current = false;
        }
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
        messagesLoadingRef.current = false;
        return;
      }

      if (!options?.skipMessages) {
        void loadConversationMessages(conversationId, "replace", { showLoading: true });
      }
    },
    [loadConversationMessages],
  );

  const openLeadConversation = useCallback(
    (leadId: string) => {
      const normalizedLeadId = String(leadId ?? "").trim();
      if (!normalizedLeadId) return;

      openedLeadIdRef.current = normalizedLeadId;
      const isSameSelectedLead = String(selectedLeadIdRef.current ?? "").trim() === normalizedLeadId;
      setSelectedLeadId(normalizedLeadId);

      if (!isSameSelectedLead) {
        return;
      }

      clearLeadUnreadLocally(normalizedLeadId);
      setMessages([]);
      setMessagesLoadError(null);
      setMessagesLoading(true);
      messagesLoadingRef.current = true;
      setSelectedConversation(null);
      void loadLeadDetail(normalizedLeadId);
    },
    [clearLeadUnreadLocally, loadLeadDetail],
  );

  useEffect(() => {
    loadSummary();
    loadPublicLink();
    loadLeads(query);
    loadPanelLeads();
  }, [loadLeads, loadPanelLeads, loadPublicLink, loadSummary, query]);

  useEffect(() => {
    if (!selectedLeadId) return;
    if (String(openedLeadIdRef.current ?? "").trim() !== String(selectedLeadId).trim()) return;
    clearLeadUnreadLocally(selectedLeadId);
    setMessages([]);
    setMessagesLoadError(null);
    setMessagesLoading(true);
    messagesLoadingRef.current = true;
    setSelectedConversation(null);
    void loadLeadDetail(selectedLeadId);
  }, [clearLeadUnreadLocally, loadLeadDetail, selectedLeadId]);

  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId;
  }, [selectedLeadId]);

  useEffect(() => {
    rightPanelRef.current = rightPanel;
  }, [rightPanel]);

  useEffect(() => {
    mobileConversationOpenRef.current = mobileConversationOpen;
  }, [mobileConversationOpen]);

  useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    messagesLoadingRef.current = messagesLoading;
  }, [messagesLoading]);

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
      void loadSummary({ silent: true });
      void loadLeads(queryRef.current, { silent: true });
      void loadPanelLeads();
    }, 120);
  }, [loadLeads, loadPanelLeads, loadSummary]);

  const scheduleSelectedLeadRefresh = useCallback(() => {
    if (realtimeSuspendedRef.current || !selectedLeadIdRef.current) return;
    if (messagesLoadingRef.current) return;
    if (detailRefreshTimeoutRef.current != null) {
      window.clearTimeout(detailRefreshTimeoutRef.current);
    }
    detailRefreshTimeoutRef.current = window.setTimeout(() => {
      if (!selectedLeadIdRef.current) return;
      if (messagesLoadingRef.current) return;
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
      void loadPanelLeads();
      if (selectedLeadIdRef.current) {
        if (messagesLoadingRef.current) return;
        void loadLeadDetail(selectedLeadIdRef.current, { suppressNotFound: true, skipMessages: true });
        if (selectedConversationIdRef.current) {
          void loadConversationMessages(selectedConversationIdRef.current, "replace");
        }
      }
    }, 1500);
  }, [loadConversationMessages, loadLeadDetail, loadLeads, loadPanelLeads, loadSummary]);

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
        const nextMessage = (payload.new ?? null) as AtendimentoMessage | null;
        const shouldMarkAsUnread =
          payload.eventType !== "DELETE" &&
          affectedConversationId !== selectedConversationIdRef.current &&
          String(nextMessage?.sender_role ?? "") === "lead";

        if (payload.eventType !== "DELETE" && affectedConversationId) {
          setLeads((currentLeads) =>
            bumpLeadRecencyByConversation(currentLeads, affectedConversationId, nextMessage, { markAsUnread: shouldMarkAsUnread }),
          );
          setPanelLeads((currentLeads) =>
            bumpLeadRecencyByConversation(currentLeads, affectedConversationId, nextMessage, { markAsUnread: shouldMarkAsUnread }),
          );
        }

        if (affectedConversationId && affectedConversationId === selectedConversationIdRef.current) {
          if (payload.eventType === "DELETE") {
            removeMessage(String(payload.old?.id ?? ""));
          } else {
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
          void loadPanelLeads();
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
    loadPanelLeads,
    loadSummary,
    removeMessage,
    scheduleListRefresh,
    scheduleSelectedLeadRefresh,
    startFallbackRefresh,
    stopFallbackRefresh,
    supabase,
  ]);

  useEffect(() => {
    const channel = supabase
      .channel(LEAD_PRESENCE_CHANNEL)
      .on("presence", { event: "sync" }, () => {
        setOnlineLeadIds(getOnlineLeadIdsFromPresence(channel));
      })
      .on("presence", { event: "join" }, () => {
        setOnlineLeadIds(getOnlineLeadIdsFromPresence(channel));
      })
      .on("presence", { event: "leave" }, () => {
        setOnlineLeadIds(getOnlineLeadIdsFromPresence(channel));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setOnlineLeadIds(getOnlineLeadIdsFromPresence(channel));
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setOnlineLeadIds([]);
        }
      });

    return () => {
      setOnlineLeadIds([]);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

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
      if (handleForbiddenResponse(res)) return;
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
    if (handleForbiddenResponse(res)) return;
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      realtimeSuspendedRef.current = false;
      throw new Error(String(json?.error ?? "Falha ao excluir lead."));
    }

    if (selectedLeadId === lead.id) {
      const fallbackLeadId = leads.find((item) => item.id !== lead.id)?.id ?? null;
      openedLeadIdRef.current = null;
      selectedLeadIdRef.current = fallbackLeadId;
      setSelectedLeadId(fallbackLeadId);
      setSelectedConversation(null);
      setMessages([]);
      setMobileConversationOpen(false);
    }

    await loadSummary();
    await loadLeads(query);
    await loadPanelLeads();
    realtimeSuspendedRef.current = false;
  }

  function openMobileConversation(leadId: string) {
    setSelectedLeadId(leadId);
    setRightPanel("conversation");
    setMobileModuleOpen(null);
    setMobileConversationOpen(true);
  }

  function renderModuleContent(module: AtendimentoSidebarModule) {
    if (module === "public-link") {
      return <AtendimentoLinkCard publicUrl={publicUrl} onCopy={handleCopyLink} />;
    }
    return <AtendimentoSummaryCards summary={summary} leads={panelLeads} />;
  }

  function renderRightPanelContent() {
    if (rightPanel === "public-link") return renderModuleContent("public-link");
    if (rightPanel === "summary") return renderModuleContent("summary");

    return (
      <AtendimentoConversationPanel
        conversation={selectedConversation}
        messages={messages}
        messagesLoading={messagesLoading}
        disabled={sending}
        leadOnline={selectedLead ? onlineLeadIds.includes(String(selectedLead.id ?? "")) : false}
        onSendMessage={handleSendMessage}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4 bg-[var(--app-bg)] lg:h-full lg:min-h-0 lg:flex-row lg:gap-6 lg:overflow-hidden">
      <aside className="flex min-h-0 w-full min-w-0 flex-col gap-4 lg:h-full lg:max-w-[340px] lg:min-w-[340px]">
        <div className="shrink-0 space-y-4 rounded-[2rem] border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-4">
          {loadError ? (
            <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 text-sm text-[var(--app-text-55)]">
              {loadError}
            </div>
          ) : null}

          <div className="space-y-2">
            {SIDEBAR_MODULES.map((module) => {
              const active =
                module.id === activeView && (rightPanel === module.id || mobileModuleOpen === module.id);
              return (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => {
                    setActiveView(module.id);
                    const shouldUseSidePanel =
                      typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
                    if (shouldUseSidePanel) {
                      setMobileModuleOpen(null);
                      setRightPanel(module.id);
                      return;
                    }
                    setMobileConversationOpen(false);
                    setMobileModuleOpen(module.id);
                  }}
                  className={[
                    "w-full rounded-2xl border px-4 py-3 text-left transition",
                    active
                      ? "border-yellow-500/30 bg-yellow-500/10 text-[var(--app-text-85)]"
                      : "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
                  ].join(" ")}
                >
                  <div className="truncate text-sm font-semibold">{module.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 lg:overflow-hidden">
          <AtendimentoLeadList
            leads={leads}
            query={query}
            loading={loading}
            onlineLeadIds={onlineLeadIds}
            selectedLeadId={selectedLeadId}
            onQueryChange={setQuery}
            onSelectLead={(leadId) => {
              openLeadConversation(leadId);
              setMobileModuleOpen(null);
              setRightPanel("conversation");
            }}
            onOpenConversation={(leadId) => {
              openLeadConversation(leadId);
              openMobileConversation(leadId);
            }}
            onDeleteLead={async (lead) => {
              try {
                await handleDeleteLead(lead);
              } catch (error) {
                modalToast.error(error instanceof Error ? error.message : "Falha ao excluir lead.");
                throw error;
              }
            }}
          />
        </div>
      </aside>

      <div className="hidden min-w-0 flex-1 lg:block lg:min-h-0">
        <div className="min-h-[520px] lg:h-full lg:min-h-0">
          {rightPanel === "conversation" ? (
            renderRightPanelContent()
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]">
              <div className="border-b border-[var(--app-border)] px-6 py-5">
                <div className="text-sm font-semibold text-[var(--app-text-85)]">
                  {rightPanel === "public-link" ? "Link de Atendimento" : "Painel de Dados"}
                </div>
                <div className="mt-1 text-xs text-[var(--app-text-55)]">
                  {rightPanel === "public-link"
                    ? "Acesso rapido ao link publico do atendimento."
                    : "Painel completo com os dados dos alunos."}
                </div>
              </div>
              <div
                className={[
                  "min-h-0 flex-1 p-6",
                  rightPanel === "summary" ? "overflow-hidden" : "overflow-y-auto",
                ].join(" ")}
              >
                {renderRightPanelContent()}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lg:hidden">
        <AppModal
          open={mobileModuleOpen != null}
          onClose={() => setMobileModuleOpen(null)}
          position="bottom"
          size="xl"
          zIndexClass="z-[340]"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div className="text-sm font-semibold text-[var(--app-text-85)]">
                {SIDEBAR_MODULES.find((item) => item.id === mobileModuleOpen)?.label ?? ""}
              </div>
              <button
                type="button"
                onClick={() => setMobileModuleOpen(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {mobileModuleOpen ? renderModuleContent(mobileModuleOpen) : null}
            </div>
          </div>
        </AppModal>

        <AppModal
          open={mobileConversationOpen}
          onClose={() => setMobileConversationOpen(false)}
          position="bottom"
          size="xl"
          zIndexClass="z-[320]"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4">
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
                leadOnline={selectedLead ? onlineLeadIds.includes(String(selectedLead.id ?? "")) : false}
                onSendMessage={handleSendMessage}
              />
            </div>
          </div>
        </AppModal>
      </div>

      <AppModal
        open={messagesLoadError != null}
        onClose={() => {
          setMessagesLoadError(null);
          window.location.replace(window.location.href);
        }}
        size="md"
        zIndexClass="z-[520]"
        fullScreenOnMobile
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-text-85)]">Falha ao carregar as mensagens.</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">Tente novamente.</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMessagesLoadError(null);
              window.location.replace(window.location.href);
            }}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-0 text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setMessagesLoadError(null);
              window.location.replace(window.location.href);
            }}
            className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              setMessagesLoadError(null);
              window.location.replace(window.location.href);
            }}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-500/70 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Ok
          </button>
        </div>
      </AppModal>
    </div>
  );
}
