"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { logoutAction } from "@/app/app/actions";
import { getAtendimentoAccountPath, getAtendimentoPortalPath } from "@/lib/auth/access";
import type { AtendimentoMessage } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PortalPage = "bot" | "conta";

function dateTimeBR(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function getInitialLetter(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "U";
  return normalized.charAt(0).toUpperCase();
}

function getFirstName(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Usuario";
  return normalized.split(/\s+/)[0] || "Usuario";
}

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
      String(message.created_at ?? "") === String(other?.created_at ?? "") &&
      String(message.read_at ?? "") === String(other?.read_at ?? "")
    );
  });
}

export function PublicAtendimentoClient({
  initialSlug,
  page,
  currentUser,
  profile,
}: {
  initialSlug: string;
  page: PortalPage;
  currentUser: { id: string; email: string };
  profile: { nome: string; email: string; created_at: string };
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const linkSlug = String(initialSlug ?? "").trim();
  const isAccountPage = page === "conta";
  const [publicSlug, setPublicSlug] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(!isAccountPage);
  const [sending, setSending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [initialTotal, setInitialTotal] = useState(4);
  const [awaitingBotSince, setAwaitingBotSince] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesRequestIdRef = useRef(0);
  const sessionRequestIdRef = useRef(0);
  const sessionRefreshTimeoutRef = useRef<number | null>(null);

  const botCount = useMemo(
    () => messages.reduce((acc, msg) => acc + (msg.sender_role === "bot" ? 1 : 0), 0),
    [messages],
  );
  const hasLeadMessage = useMemo(() => messages.some((msg) => msg.sender_role === "lead"), [messages]);
  const isInitialFlow = !hasLeadMessage && initialTotal > 0 && botCount < initialTotal;
  const typing = !loading && !authError && !isAccountPage && (isInitialFlow || awaitingBotSince != null);
  const displayName = profile.nome || currentUser.email.split("@")[0] || "Usuario";
  const firstName = getFirstName(displayName);
  const initialLetter = getInitialLetter(displayName);
  const accountHref = getAtendimentoAccountPath(linkSlug);
  const botHref = getAtendimentoPortalPath(linkSlug);

  async function redirectToLoginAfterSessionLoss() {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {}
    window.location.replace("/login");
  }

  useLayoutEffect(() => {
    if (isAccountPage) return;
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = "56px";
    element.style.overflowY = "hidden";

    const nextHeight = Math.min(element.scrollHeight, 144);
    element.style.height = `${Math.max(56, nextHeight)}px`;
    if (element.scrollHeight > 144) {
      element.style.overflowY = "auto";
    }
  }, [draft, isAccountPage]);

  useLayoutEffect(() => {
    if (isAccountPage) return;
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isAccountPage, publicSlug, messages.length, typing]);

  function restoreTextareaFocus() {
    if (isAccountPage) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element || element.disabled) return;
        element.focus();
        const cursorPosition = element.value.length;
        element.setSelectionRange(cursorPosition, cursorPosition);
      });
    });
  }

  const applyMessages = useCallback(
    (incomingMessages: AtendimentoMessage[], mode: "replace" | "merge" = "replace") => {
      const normalizedMessages = sortAndDedupeMessages(incomingMessages);
      setMessages((currentMessages) => {
        const nextMessages =
          mode === "merge"
            ? sortAndDedupeMessages([...currentMessages, ...normalizedMessages])
            : normalizedMessages;
        return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
      });

      if (awaitingBotSince != null) {
        const since = awaitingBotSince;
        const hasBotAfter = normalizedMessages.some((message) => {
          if (message.sender_role === "lead") return false;
          const createdAt = new Date(message.created_at).getTime();
          return Number.isFinite(createdAt) && createdAt >= since;
        });
        if (hasBotAfter) {
          setAwaitingBotSince(null);
        }
      }
    },
    [awaitingBotSince],
  );

  const removeMessage = useCallback((messageId: string) => {
    setMessages((currentMessages) => {
      const nextMessages = currentMessages.filter((message) => String(message.id) !== messageId);
      return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
    });
  }, []);

  const loadMessages = useCallback(
    async (nextPublicSlug: string, mode: "replace" | "merge" = "replace") => {
      if (!nextPublicSlug) return [] as AtendimentoMessage[];
      const requestId = ++messagesRequestIdRef.current;
      const res = await fetch(`/api/atendimento/public/messages?public_slug=${encodeURIComponent(nextPublicSlug)}`, {
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        setAuthError("Sua sessão de atendimento expirou. Entre novamente para continuar.");
        setMessages([]);
        void redirectToLoginAfterSessionLoss();
        return [] as AtendimentoMessage[];
      }

      const json = await res.json().catch(() => null);
      const nextMessages = json?.ok ? ((json.messages ?? []) as AtendimentoMessage[]) : [];
      if (json?.ok && requestId === messagesRequestIdRef.current) {
        applyMessages(nextMessages, mode);
      }
      return nextMessages;
    },
    [applyMessages],
  );

  const loadSession = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = Boolean(options?.silent);
      const requestId = ++sessionRequestIdRef.current;
      if (!silent) {
        setLoading(true);
      }
      setAuthError("");

      try {
        const res = await fetch("/api/atendimento/public/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: linkSlug }),
        });

        if (res.status === 401) {
          setAuthError("Sua sessão de atendimento expirou. Entre novamente para continuar.");
          setMessages([]);
          void redirectToLoginAfterSessionLoss();
          return;
        }

        const json = await res.json().catch(() => null);
        if (!json?.ok) {
          if (!silent) {
            setAuthError(String(json?.error ?? "Não foi possível carregar o seu atendimento."));
            setConversationId("");
            setLeadId("");
            setMessages([]);
          }
          return;
        }

        if (requestId !== sessionRequestIdRef.current) {
          return;
        }

        setLeadId(String(json.session?.lead?.id ?? ""));
        setConversationId(String(json.session?.conversation?.id ?? ""));
        const nextSlug = String(json.session?.conversation?.public_slug ?? "");
        const initialMessages = (json.session?.messages ?? []) as AtendimentoMessage[];
        const nextTotal = Number(json.session?.initial_total ?? 0);
        if (Number.isFinite(nextTotal) && nextTotal > 0) {
          setInitialTotal(nextTotal);
        }
        setPublicSlug(nextSlug);
        applyMessages(initialMessages, "replace");

        if (!initialMessages.length) {
          await loadMessages(nextSlug, "replace");
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [applyMessages, linkSlug, loadMessages],
  );

  const scheduleSessionRefresh = useCallback(() => {
    if (sessionRefreshTimeoutRef.current != null) {
      window.clearTimeout(sessionRefreshTimeoutRef.current);
    }
    sessionRefreshTimeoutRef.current = window.setTimeout(() => {
      void loadSession({ silent: true });
    }, 160);
  }, [loadSession]);

  async function submitDraft() {
    const contentText = draft.trim();
    if (!contentText || !publicSlug || sending || authError || isAccountPage) return;
    setSending(true);
    setDraft("");
    setAwaitingBotSince(Date.now());
    try {
      const res = await fetch("/api/atendimento/public/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_slug: publicSlug, content_text: contentText }),
      });
      if (res.status === 401 || res.status === 403) {
        setAuthError("Sua sessão de atendimento expirou. Entre novamente para continuar.");
        void redirectToLoginAfterSessionLoss();
        return;
      }
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        const optimisticMessages = [json.inbound, json.outbound].filter(Boolean) as AtendimentoMessage[];
        if (optimisticMessages.length) {
          applyMessages(optimisticMessages, "merge");
        } else {
          await loadMessages(publicSlug, "replace");
        }
      }
    } finally {
      setSending(false);
      restoreTextareaFocus();
    }
  }

  useEffect(() => {
    if (isAccountPage) return;
    void loadSession();
  }, [isAccountPage, loadSession]);

  useEffect(() => {
    if (isAccountPage || !publicSlug || authError || loading || !isInitialFlow) return;
    let active = true;
    let timeoutId: number | null = null;

    const tick = async () => {
      if (!active) return;
      await loadMessages(publicSlug, "replace");
      if (!active) return;
      timeoutId = window.setTimeout(tick, 950);
    };

    timeoutId = window.setTimeout(tick, 180);

    return () => {
      active = false;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [authError, isAccountPage, isInitialFlow, loadMessages, loading, publicSlug]);

  useEffect(() => {
    if (isAccountPage || !publicSlug || !conversationId || !leadId || authError) return;

    const channel = supabase
      .channel(`atendimento-public:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "atendimento_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          if (payload.eventType === "DELETE") {
            removeMessage(String(payload.old?.id ?? ""));
            return;
          }

          const nextMessage = (payload.new ?? null) as AtendimentoMessage | null;
          if (!nextMessage?.id) {
            void loadMessages(publicSlug, "replace");
            return;
          }
          applyMessages([nextMessage], "merge");
        },
      )
      .subscribe();

    return () => {
      if (sessionRefreshTimeoutRef.current != null) {
        window.clearTimeout(sessionRefreshTimeoutRef.current);
        sessionRefreshTimeoutRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [
    applyMessages,
    authError,
    conversationId,
    isAccountPage,
    leadId,
    loadMessages,
    publicSlug,
    removeMessage,
    supabase,
  ]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDraft();
  }

  async function handleTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await submitDraft();
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#09111A] px-4 py-4 text-white md:px-8 md:py-6">
      <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0E1723] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
        <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(14,23,35,0.9))] px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-white">Olá, {firstName}!</div>
            </div>
            <Link
              href={accountHref}
              aria-label="Abrir sua conta"
              className={[
                "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-base font-semibold transition",
                isAccountPage
                  ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-100"
                  : "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]",
              ].join(" ")}
            >
              {initialLetter}
            </Link>
          </div>

          {isAccountPage ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={botHref}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] sm:w-auto"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar ao bot
              </Link>

              <form action={logoutAction}>
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] sm:w-auto"
                >
                  Sair
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {isAccountPage ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Nome</div>
                <div className="mt-3 text-lg font-semibold text-white">{displayName}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Email</div>
                <div className="mt-3 break-all text-lg font-semibold text-white">{profile.email || currentUser.email}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Cadastro</div>
                <div className="mt-3 text-lg font-semibold text-white">{dateTimeBR(profile.created_at)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Portal</div>
                <div className="mt-3 text-lg font-semibold text-white">Conta exclusiva de atendimento</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={messagesViewportRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 md:px-6">
              {loading ? (
                <div className="text-sm text-white/55">Iniciando atendimento...</div>
              ) : authError ? (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm text-amber-100">
                  {authError}
                </div>
              ) : (
                <>
                  {messages.map((message) => {
                    const isLead = message.sender_role === "lead";
                    return (
                      <div key={message.id} className={`flex ${isLead ? "justify-end" : "justify-start"}`}>
                        <div
                          className={[
                            "max-w-[85%] rounded-[1.5rem] border px-4 py-3",
                            isLead
                              ? "border-emerald-500/20 bg-emerald-500/15"
                              : "border-white/10 bg-white/[0.04]",
                          ].join(" ")}
                        >
                          {message.content_text ? (
                            <div className="whitespace-pre-wrap text-sm text-white/90">{message.content_text}</div>
                          ) : null}
                          {message.media_url ? (
                            <a
                              href={message.media_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex text-xs font-semibold text-emerald-200 underline"
                            >
                              Abrir anexo
                            </a>
                          ) : null}
                          <div className="mt-3 text-[11px] text-white/45">
                            {formatAtendimentoDateTime(message.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {typing ? (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] animate-pulse rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
                        Digitando...
                      </div>
                    </div>
                  ) : !messages.length ? (
                    <div className="text-sm text-white/55">Aguardando as primeiras mensagens do bot...</div>
                  ) : null}
                </>
              )}
            </div>

            <form onSubmit={handleSend} className="border-t border-white/10 bg-black/10 px-4 py-4 md:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Digite sua mensagem..."
                  rows={1}
                  disabled={Boolean(authError)}
                  className="h-14 w-full flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-white outline-none transition placeholder:text-white/30 focus:border-emerald-500/40 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending || Boolean(authError)}
                  className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-2xl border border-emerald-500/70 bg-emerald-600 text-[rgb(255,255,255)] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-emerald-500/50 disabled:bg-emerald-600/60 disabled:text-[rgb(255,255,255)] disabled:opacity-100 sm:h-auto sm:min-h-14 sm:w-14"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
