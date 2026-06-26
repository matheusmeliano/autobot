"use client";

import { useEffect, useMemo, useState } from "react";
import { Paperclip, Send } from "lucide-react";
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

  async function loadMessages(nextPublicSlug: string) {
    if (!nextPublicSlug) return [] as AtendimentoMessage[];
    const res = await fetch(`/api/atendimento/public/messages?public_slug=${encodeURIComponent(nextPublicSlug)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    const nextMessages = json?.ok ? ((json.messages ?? []) as AtendimentoMessage[]) : [];
    if (json?.ok) setMessages(nextMessages);
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
    const id = window.setInterval(() => loadMessages(publicSlug), 2500);
    return () => window.clearInterval(id);
  }, [publicSlug]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contentText = draft.trim();
    if (!contentText || !publicSlug || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch("/api/atendimento/public/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_slug: publicSlug, content_text: contentText }),
      });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        await loadMessages(publicSlug);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#09111A] px-4 py-6 text-white md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0E1723] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
        <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(14,23,35,0.9))] px-6 py-6">
          <div className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-200/80">
            Lucas Brum Online Music USA
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Atendimento</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/65">
            Converse com nosso bot para conhecer a metodologia, receber o convite para aula experimental e concluir seu pré-cadastro sem sair desta conversa.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 md:px-6">
          {loading ? (
            <div className="text-sm text-white/55">Iniciando atendimento...</div>
          ) : !messages.length ? (
            <div className="text-sm text-white/55">Aguardando as primeiras mensagens do bot...</div>
          ) : (
            messages.map((message) => {
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
            })
          )}
        </div>

        <form onSubmit={handleSend} className="border-t border-white/10 bg-black/10 px-4 py-4 md:px-6">
          <div className="flex items-end gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/55">
              <Paperclip className="h-4 w-4" />
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Digite sua mensagem..."
              className="min-h-24 flex-1 rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/20 text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
