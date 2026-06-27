"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { AtendimentoMessage } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";

const STORAGE_PREFIX = "autobot_atendimento_session_";

export function PublicAtendimentoClient({ initialSlug }: { initialSlug: string }) {
  const linkSlug = String(initialSlug ?? "").trim();
  const storageKey = useMemo(() => `${STORAGE_PREFIX}${linkSlug || "default"}`, [linkSlug]);
  const [publicSlug, setPublicSlug] = useState("");
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [initialTotal, setInitialTotal] = useState(4);
  const [awaitingBotSince, setAwaitingBotSince] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

  const botCount = useMemo(
    () => messages.reduce((acc, msg) => acc + (msg.sender_role === "bot" ? 1 : 0), 0),
    [messages],
  );
  const hasLeadMessage = useMemo(() => messages.some((msg) => msg.sender_role === "lead"), [messages]);
  const isInitialFlow = !hasLeadMessage && initialTotal > 0 && botCount < initialTotal;
  const typing = !loading && (isInitialFlow || awaitingBotSince != null);

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
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [publicSlug, messages.length, typing]);

  async function submitDraft() {
    const contentText = draft.trim();
    if (!contentText || !publicSlug || sending) return;
    setSending(true);
    setDraft("");
    setAwaitingBotSince(Date.now());
    try {
      const res = await fetch("/api/atendimento/public/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_slug: publicSlug, content_text: contentText }),
      });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        await loadMessagesWithRetry(publicSlug);
      }
    } finally {
      setSending(false);
    }
  }

  async function loadMessages(nextPublicSlug: string) {
    if (!nextPublicSlug) return [] as AtendimentoMessage[];
    const res = await fetch(`/api/atendimento/public/messages?public_slug=${encodeURIComponent(nextPublicSlug)}`, {
      cache: "no-store",
    });
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

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : "";
    if (saved) {
      setPublicSlug(saved);
      loadMessagesWithRetry(saved).finally(() => setLoading(false));
      return;
    }

    fetch("/api/atendimento/public/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: linkSlug }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json?.ok) return;
        const nextSlug = String(json.session?.conversation?.public_slug ?? "");
        if (!nextSlug) return;
        const initialMessages = (json.session?.messages ?? []) as AtendimentoMessage[];
        const nextTotal = Number(json.session?.initial_total ?? 0);
        if (Number.isFinite(nextTotal) && nextTotal > 0) setInitialTotal(nextTotal);
        setPublicSlug(nextSlug);
        window.localStorage.setItem(storageKey, nextSlug);
        if (initialMessages.length > 0) {
          setMessages(initialMessages);
          return initialMessages;
        }
        return loadMessagesWithRetry(nextSlug);
      })
      .finally(() => setLoading(false));
  }, [linkSlug, storageKey]);

  useEffect(() => {
    if (!publicSlug) return;
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
  }, [publicSlug, typing]);

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
          <div className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-200/80">
            Lucas Brum Online Music USA
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Atendimento</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/65">
            Converse com nosso bot para conhecer a metodologia, receber o convite para aula experimental e concluir seu pré-cadastro sem sair desta conversa.
          </p>
        </div>

        <div ref={messagesViewportRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 md:px-6">
          {loading ? (
            <div className="text-sm text-white/55">Iniciando atendimento...</div>
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
                  <div className="max-w-[85%] rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 animate-pulse">
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
              className="h-14 w-full flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-white outline-none transition placeholder:text-white/30 focus:border-emerald-500/40 focus:bg-white/[0.06]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-2xl border border-emerald-500/70 bg-emerald-600 text-[rgb(255,255,255)] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-emerald-500/50 disabled:bg-emerald-600/60 disabled:text-[rgb(255,255,255)] disabled:opacity-100 sm:h-auto sm:min-h-14 sm:w-14"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
