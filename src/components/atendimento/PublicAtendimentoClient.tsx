"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { logoutAction } from "@/app/app/actions";
import type { AtendimentoMessage } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";

type PortalTab = "bot" | "conta";

function dateTimeBR(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

export function PublicAtendimentoClient({
  initialSlug,
  initialTab,
  currentUser,
  profile,
}: {
  initialSlug: string;
  initialTab: PortalTab;
  currentUser: { id: string; email: string };
  profile: { nome: string; email: string; created_at: string };
}) {
  const router = useRouter();
  const linkSlug = String(initialSlug ?? "").trim();
  const [activeTab, setActiveTab] = useState<PortalTab>(initialTab);
  const [publicSlug, setPublicSlug] = useState("");
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [initialTotal, setInitialTotal] = useState(4);
  const [awaitingBotSince, setAwaitingBotSince] = useState<number | null>(null);
  const [isTabPending, startTabTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

  const botCount = useMemo(
    () => messages.reduce((acc, msg) => acc + (msg.sender_role === "bot" ? 1 : 0), 0),
    [messages],
  );
  const hasLeadMessage = useMemo(() => messages.some((msg) => msg.sender_role === "lead"), [messages]);
  const isInitialFlow = !hasLeadMessage && initialTotal > 0 && botCount < initialTotal;
  const typing = !loading && !authError && (isInitialFlow || awaitingBotSince != null);
  const totalMessages = messages.length;
  const displayName = profile.nome || currentUser.email.split("@")[0] || "Usuário";

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = "56px";
    element.style.overflowY = "hidden";

    const nextHeight = Math.min(element.scrollHeight, 144);
    element.style.height = `${Math.max(56, nextHeight)}px`;
    if (element.scrollHeight > 144) {
      element.style.overflowY = "auto";
    }
  }, [draft]);

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || activeTab !== "bot") return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [activeTab, publicSlug, messages.length, typing]);

  function updatePortalUrl(nextTab: PortalTab) {
    const params = new URLSearchParams();
    if (linkSlug) params.set("slug", linkSlug);
    params.set("tab", nextTab);
    router.replace(`/atendimento?${params.toString()}`);
  }

  function handleTabChange(nextTab: PortalTab) {
    if (nextTab === activeTab) return;
    startTabTransition(() => {
      setActiveTab(nextTab);
      updatePortalUrl(nextTab);
    });
  }

  function restoreTextareaFocus() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element || element.disabled || activeTab !== "bot") return;
        element.focus();
        const cursorPosition = element.value.length;
        element.setSelectionRange(cursorPosition, cursorPosition);
      });
    });
  }

  async function loadMessages(nextPublicSlug: string) {
    if (!nextPublicSlug) return [] as AtendimentoMessage[];
    const res = await fetch(`/api/atendimento/public/messages?public_slug=${encodeURIComponent(nextPublicSlug)}`, {
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      setAuthError("Sua sessão de atendimento expirou. Entre novamente para continuar.");
      setMessages([]);
      return [] as AtendimentoMessage[];
    }
    const json = await res.json().catch(() => null);
    const nextMessages = json?.ok ? ((json.messages ?? []) as AtendimentoMessage[]) : [];
    if (json?.ok) {
      setMessages(nextMessages);
      if (awaitingBotSince != null) {
        const since = awaitingBotSince;
        const hasBotAfter = nextMessages.some((msg) => {
          if (msg.sender_role === "lead") return false;
          const time = new Date(msg.created_at).getTime();
          return Number.isFinite(time) && time >= since;
        });
        if (hasBotAfter) setAwaitingBotSince(null);
      }
    }
    return nextMessages;
  }

  async function loadMessagesWithRetry(nextPublicSlug: string) {
    const firstBatch = await loadMessages(nextPublicSlug);
    if (firstBatch.length > 0) return firstBatch;
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    return loadMessages(nextPublicSlug);
  }

  async function loadSession() {
    setLoading(true);
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
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setAuthError(String(json?.error ?? "Não foi possível carregar o seu atendimento."));
        setMessages([]);
        return;
      }
      const nextSlug = String(json.session?.conversation?.public_slug ?? "");
      const initialMessages = (json.session?.messages ?? []) as AtendimentoMessage[];
      const nextTotal = Number(json.session?.initial_total ?? 0);
      if (Number.isFinite(nextTotal) && nextTotal > 0) setInitialTotal(nextTotal);
      setPublicSlug(nextSlug);
      setMessages(initialMessages);
      if (!initialMessages.length) {
        await loadMessagesWithRetry(nextSlug);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitDraft() {
    const contentText = draft.trim();
    if (!contentText || !publicSlug || sending || authError) return;
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
        return;
      }
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        await loadMessagesWithRetry(publicSlug);
      }
    } finally {
      setSending(false);
      restoreTextareaFocus();
    }
  }

  useEffect(() => {
    loadSession();
  }, [linkSlug]);

  useEffect(() => {
    if (!publicSlug || authError) return;
    let active = true;
    let timeoutId: number | null = null;

    const tick = async () => {
      if (!active) return;
      await loadMessages(publicSlug);
      if (!active) return;
      timeoutId = window.setTimeout(tick, typing ? 700 : 2500);
    };

    tick();

    return () => {
      active = false;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [authError, publicSlug, typing]);

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
        <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(14,23,35,0.9))] px-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/65">
                Fale com nosso bot, agende sua aula experimental e faca seu pre-cadastro em poucos minutos.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/75">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                Conta logada
              </div>
              <div className="mt-2 font-semibold text-white">{profile.email || currentUser.email}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-2 gap-2 sm:inline-flex">
              <button
                type="button"
                onClick={() => handleTabChange("bot")}
                className={[
                  "inline-flex min-w-[120px] items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  activeTab === "bot"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.07]",
                ].join(" ")}
              >
                Bot
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("conta")}
                className={[
                  "inline-flex min-w-[120px] items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  activeTab === "conta"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.07]",
                ].join(" ")}
              >
                Conta
              </button>
            </div>

            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] sm:w-auto"
              >
                Sair
              </button>
            </form>
          </div>
        </div>

        {activeTab === "conta" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Nome</div>
                <div className="mt-3 text-lg font-semibold text-white">{displayName}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Email</div>
                <div className="mt-3 text-lg font-semibold text-white">{profile.email || currentUser.email}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Cadastro</div>
                <div className="mt-3 text-lg font-semibold text-white">{dateTimeBR(profile.created_at)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Bot</div>
                <div className="mt-3 text-lg font-semibold text-white">
                  {totalMessages} mensagem(ns) no seu historico
                </div>
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

        {isTabPending ? <div className="sr-only">Carregando aba...</div> : null}
      </div>
    </div>
  );
}
