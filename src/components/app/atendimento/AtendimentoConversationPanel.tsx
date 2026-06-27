"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { AtendimentoConversation, AtendimentoMessage } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";

function statusLabel(status: string) {
  if (status === "lida") return "Lida";
  if (status === "entregue") return "Entregue";
  if (status === "enviada") return "Enviada";
  if (status === "recebida") return "Recebida";
  return status || "-";
}

export function AtendimentoConversationPanel({
  conversation,
  messages,
  disabled,
  onSendMessage,
  compact,
}: {
  conversation: AtendimentoConversation | null;
  messages: AtendimentoMessage[];
  disabled?: boolean;
  onSendMessage: (payload: { content_text: string }) => Promise<void>;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const orderedMessages = useMemo(() => messages.slice(), [messages]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  async function submitDraft() {
    const content = draft.trim();
    if (!content || !conversation?.id || disabled) return;
    setDraft("");
    await onSendMessage({ content_text: content });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDraft();
  }

  async function handleTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await submitDraft();
  }

  return (
    <div
      className={
        compact
          ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]"
          : "flex min-h-[520px] flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:h-full lg:min-h-0"
      }
    >
      <div className="border-b border-[var(--app-border)] px-4 py-4">
        <div className="text-sm font-semibold text-[var(--app-text-85)]">Conversa</div>
        <div className="mt-1 text-xs text-[var(--app-text-45)]">
          Conversa completa do lead dentro do módulo Atendimento.
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {orderedMessages.length ? (
          orderedMessages.map((message) => {
            const isLead = message.sender_role === "lead";
            const isBot = message.sender_role === "bot";
            return (
              <div
                key={message.id}
                className={`flex ${isLead ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={[
                    "max-w-[85%] rounded-2xl border px-4 py-3",
                    isLead
                      ? "border-[var(--app-border)] bg-[var(--app-card)]"
                      : isBot
                        ? "border-emerald-500/20 bg-emerald-500/10"
                        : "border-sky-500/20 bg-sky-500/10",
                  ].join(" ")}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-45)]">
                    {isLead ? "Lead" : isBot ? "Bot" : "Atendente"}
                  </div>
                  {message.content_text ? (
                    <div className="mt-2 whitespace-pre-wrap text-sm text-[var(--app-text-85)]">
                      {message.content_text}
                    </div>
                  ) : null}
                  {message.media_url ? (
                    <a
                      href={message.media_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex text-xs font-semibold text-[var(--app-text-85)] underline"
                    >
                      Abrir anexo
                    </a>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-text-45)]">
                    <span>{formatAtendimentoDateTime(message.created_at)}</span>
                    <span>{statusLabel(message.status)}</span>
                    <span>{message.media_type}</span>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full min-h-56 items-center justify-center text-sm text-[var(--app-text-45)]">
            Nenhuma mensagem nesta conversa.
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--app-border)] px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={conversation?.id ? "Digite uma mensagem para o lead..." : "Selecione um atendimento"}
            disabled={!conversation?.id || disabled}
            rows={1}
            className="h-14 w-full flex-1 resize-none rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-4 text-sm leading-6 text-[var(--app-text-85)] outline-none transition placeholder:text-[var(--app-text-35)] focus:border-emerald-500/40 focus:bg-[var(--app-hover)]"
          />
          <button
            type="submit"
            disabled={!conversation?.id || disabled || !draft.trim()}
            className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-2xl border border-emerald-500/70 bg-emerald-600 text-[rgb(255,255,255)] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-emerald-500/50 disabled:bg-emerald-600/60 disabled:text-[rgb(255,255,255)] disabled:opacity-100 sm:h-auto sm:min-h-14 sm:w-14"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
