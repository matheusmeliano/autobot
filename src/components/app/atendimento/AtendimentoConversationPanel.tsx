"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, FileText, ImageIcon, Maximize2, Minimize2, Paperclip, Play, Send, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import {
  ATENDIMENTO_DOCUMENT_MIME_ACCEPT,
  ATENDIMENTO_IMAGE_MIME_ACCEPT,
  ATENDIMENTO_VIDEO_MIME_ACCEPT,
  formatAtendimentoFileSize,
  getAtendimentoAttachmentTitle,
  getAtendimentoMediaTypeFromMimeType,
  isAtendimentoDocumentExtensionAllowed,
  type AtendimentoUploadItem,
  validateAtendimentoFiles,
} from "@/lib/atendimento/files";
import { uploadAtendimentoFileWithProgress } from "@/lib/atendimento/upload-client";
import type { AtendimentoConversation, AtendimentoMessage } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function statusLabel(status: string) {
  if (status === "lida") return "Lida";
  if (status === "entregue") return "Entregue";
  if (status === "enviada") return "Enviada";
  if (status === "recebida") return "Recebida";
  return status || "-";
}

function getAtendimentoDownloadLabel(mediaType?: AtendimentoMessage["media_type"] | null) {
  if (mediaType === "image") return "Baixar imagem";
  if (mediaType === "video") return "Baixar vídeo";
  return "Baixar arquivo";
}

function getAtendimentoDownloadHref(url: string | null | undefined, fileName: string | null | undefined) {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  const downloadValue = fileName ? encodeURIComponent(fileName) : "";
  return `${url}${separator}download=${downloadValue}`;
}

function isViewportNearBottom(element: HTMLDivElement, threshold = 40) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

// #region debug-point D:reporter
const DEBUG_SESSION_ID = "atendimento-flicker-loading";
const DEBUG_SERVER_URL = "http://127.0.0.1:7777/event";
const DEBUG_RUN_ID = "post-fix";

function reportDebugEvent(payload: {
  hypothesisId: string;
  location: string;
  msg: string;
  data?: Record<string, unknown>;
}) {
  if (typeof window === "undefined") return;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return;
  void fetch(DEBUG_SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: DEBUG_RUN_ID,
      ts: Date.now(),
      ...payload,
      msg: `[DEBUG] ${payload.msg}`,
      data: payload.data ?? {},
    }),
  }).catch(() => {});
}
// #endregion

export function AtendimentoConversationPanel({
  conversation,
  messages,
  messagesLoading,
  disabled,
  onSendMessage,
  compact,
}: {
  conversation: AtendimentoConversation | null;
  messages: AtendimentoMessage[];
  messagesLoading?: boolean;
  disabled?: boolean;
  onSendMessage: (payload: {
    content_text?: string;
    media_type?: AtendimentoMessage["media_type"];
    media_url?: string | null;
    mime_type?: string | null;
    file_name?: string | null;
    file_size_bytes?: number | null;
  }) => Promise<void>;
  compact?: boolean;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [draft, setDraft] = useState("");
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const [uploadItems, setUploadItems] = useState<AtendimentoUploadItem[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<AtendimentoMessage | null>(null);
  const orderedMessages = useMemo(() => messages.slice(), [messages]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastConversationIdRef = useRef<string>("");
  const lastMessageKeyRef = useRef<string>("");
  const shouldStickToBottomRef = useRef(true);
  const previewAttachmentTitle = previewMessage
    ? getAtendimentoAttachmentTitle({
        mediaType: previewMessage.media_type,
        fileName: previewMessage.file_name,
        contentText: previewMessage.content_text,
      })
    : "";

  const renderBranch = messagesLoading
    ? "loading"
    : orderedMessages.length
      ? "messages"
      : "empty";

  useEffect(() => {
    // #region debug-point D:panel-branch
    reportDebugEvent({
      hypothesisId: "D",
      location: "AtendimentoConversationPanel:renderBranch",
      msg: "panel branch change",
      data: {
        conversationId: String(conversation?.id ?? ""),
        messagesLoading: Boolean(messagesLoading),
        messagesCount: orderedMessages.length,
        branch: renderBranch,
        compact: Boolean(compact),
        desktopExpanded,
      },
    });
    // #endregion
  }, [compact, conversation?.id, desktopExpanded, messagesLoading, orderedMessages.length, renderBranch]);

  useEffect(() => {
    if (!desktopExpanded) return;
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    if (!media.matches) {
      setDesktopExpanded(false);
      return;
    }
    const listener = () => {
      if (!media.matches) setDesktopExpanded(false);
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, [desktopExpanded]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!desktopExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [desktopExpanded]);

  useEffect(() => {
    if (!desktopExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDesktopExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [desktopExpanded]);

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

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    const end = messagesEndRef.current;
    if (!viewport || !end) return;

    const currentConversationId = String(conversation?.id ?? "");
    const lastMessage = orderedMessages[orderedMessages.length - 1];
    const nextMessageKey = lastMessage
      ? `${String(lastMessage.id ?? "")}:${String(lastMessage.created_at ?? "")}`
      : "";
    const conversationChanged = currentConversationId !== lastConversationIdRef.current;
    const newMessageArrived =
      !conversationChanged &&
      Boolean(nextMessageKey) &&
      nextMessageKey !== lastMessageKeyRef.current;
    const shouldAutoScroll =
      conversationChanged || (newMessageArrived && shouldStickToBottomRef.current);

    lastConversationIdRef.current = currentConversationId;
    lastMessageKeyRef.current = nextMessageKey;

    if (!shouldAutoScroll) return;

    let frameA = 0;
    let frameB = 0;
    const scrollToBottom = () => {
      end.scrollIntoView({ block: "end", behavior: "auto" });
      viewport.scrollTop = viewport.scrollHeight;
      shouldStickToBottomRef.current = true;
    };

    frameA = window.requestAnimationFrame(() => {
      scrollToBottom();
      frameB = window.requestAnimationFrame(scrollToBottom);
    });

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [conversation?.id, orderedMessages, messagesLoading]);

  function restoreTextareaFocus() {
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

  function updateUploadItem(id: string, patch: Partial<AtendimentoUploadItem>) {
    setUploadItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeUploadItem(id: string) {
    setUploadItems((currentItems) => currentItems.filter((item) => item.id !== id));
  }

  async function submitDraft() {
    const content = draft.trim();
    if (!content || !conversation?.id || disabled) return;
    setDraft("");
    await onSendMessage({ content_text: content });
    restoreTextareaFocus();
  }

  async function uploadSelectedFiles(fileList: FileList | File[]) {
    if (!conversation?.id || disabled) return;
    const { files, errors } = validateAtendimentoFiles(fileList);
    if (errors.length) {
      alert(errors.join("\n"));
      return;
    }

    for (const file of files) {
      const mediaType =
        getAtendimentoMediaTypeFromMimeType(file.type) ?? (isAtendimentoDocumentExtensionAllowed(file.name) ? "file" : null);
      if (!mediaType) continue;

      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setUploadItems((currentItems) => [
        ...currentItems,
        {
          id: uploadId,
          fileName: file.name,
          fileSizeBytes: file.size,
          progress: 0,
          status: "queued",
          error: null,
        },
      ]);

      try {
        updateUploadItem(uploadId, { status: "uploading", progress: 0, error: null });
        const uploaded = await uploadAtendimentoFileWithProgress({
          supabase,
          conversationId: conversation.id,
          senderRole: "attendant",
          file,
          onProgress: (progress) => updateUploadItem(uploadId, { progress }),
        });
        updateUploadItem(uploadId, { status: "sending", progress: 100 });
        await onSendMessage({
          content_text: "",
          media_type: uploaded.media_type,
          media_url: uploaded.media_url,
          mime_type: uploaded.mime_type,
          file_name: uploaded.file_name,
          file_size_bytes: uploaded.file_size_bytes,
        });
        updateUploadItem(uploadId, { status: "done", progress: 100 });
        window.setTimeout(() => removeUploadItem(uploadId), 1400);
      } catch (error) {
        updateUploadItem(uploadId, {
          status: "error",
          error: error instanceof Error ? error.message : "Falha no upload.",
        });
      }
    }

    if (documentInputRef.current) documentInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function handleFilePicker() {
    if (!conversation?.id || disabled) return;
    setAttachmentMenuOpen(true);
  }

  function handleAttachmentOption(kind: "image" | "video" | "file") {
    setAttachmentMenuOpen(false);
    window.requestAnimationFrame(() => {
      if (kind === "image") {
        imageInputRef.current?.click();
        return;
      }
      if (kind === "file") {
        documentInputRef.current?.click();
        return;
      }
      videoInputRef.current?.click();
    });
  }

  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFiles = event.target.files;
    if (!nextFiles?.length) return;
    await uploadSelectedFiles(nextFiles);
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
        desktopExpanded
          ? "fixed inset-0 z-[450] flex h-[100dvh] flex-col bg-[var(--app-bg)]"
          : compact
            ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]"
            : "flex min-h-[520px] flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:h-full lg:min-h-0"
      }
    >
      {!compact ? (
        <div
          className={[
            "flex items-start justify-start gap-3 border-b border-[var(--app-border)] px-4 py-4",
            desktopExpanded ? "bg-[var(--app-bg)]" : "",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => setDesktopExpanded((current) => !current)}
            className="hidden h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)] min-[1201px]:inline-flex"
            aria-label={desktopExpanded ? "Sair da tela cheia" : "Expandir conversa"}
          >
            {desktopExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      ) : null}

      <div
        ref={messagesViewportRef}
        onScroll={(event) => {
          shouldStickToBottomRef.current = isViewportNearBottom(event.currentTarget);
        }}
        className={desktopExpanded ? "flex-1 space-y-3 overflow-y-auto bg-[var(--app-bg)] px-4 py-4" : "flex-1 space-y-3 overflow-y-auto px-4 py-4"}
      >
        {messagesLoading ? (
          <div className="flex h-full min-h-56 items-center justify-center text-sm text-[var(--app-text-45)]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500/70" />
              Carregando...
            </div>
          </div>
        ) : orderedMessages.length ? (
          orderedMessages.map((message) => {
            const isLead = message.sender_role === "lead";
            const isBot = message.sender_role === "bot";
            const attachmentTitle = getAtendimentoAttachmentTitle({
              mediaType: message.media_type,
              fileName: message.file_name,
              contentText: message.content_text,
            });
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
                    {isLead ? "Enviado por aluno" : isBot ? "Bot" : "Enviado por você"}
                  </div>
                  {message.media_url && message.media_type === "image" ? (
                    <button
                      type="button"
                      onClick={() => setPreviewMessage(message)}
                      className="group mt-3 block w-full overflow-hidden rounded-2xl border border-[var(--app-border)] bg-black/20 text-left transition hover:border-[var(--app-text-35)]"
                      aria-label={`Visualizar ${attachmentTitle}`}
                    >
                      <img
                        src={message.media_url}
                        alt={attachmentTitle}
                        className="max-h-64 w-full rounded-2xl object-cover transition duration-200 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    </button>
                  ) : null}
                  {message.media_url && message.media_type === "video" ? (
                    <button
                      type="button"
                      onClick={() => setPreviewMessage(message)}
                      className="group relative mt-3 block w-full overflow-hidden rounded-2xl border border-[var(--app-border)] bg-black/20 text-left transition hover:border-[var(--app-text-35)]"
                      aria-label={`Reproduzir ${attachmentTitle}`}
                    >
                      <video
                        src={message.media_url}
                        preload="metadata"
                        className="max-h-72 w-full rounded-2xl bg-black object-cover"
                        muted
                        playsInline
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg">
                          <Play className="h-5 w-5 fill-current" />
                        </span>
                      </div>
                    </button>
                  ) : null}
                  {message.content_text ? (
                    <div className="mt-2 whitespace-pre-wrap text-sm text-[var(--app-text-85)]">
                      {message.content_text}
                    </div>
                  ) : null}
                  {message.media_url ? (
                    <>
                      <div className="mt-2 text-xs font-semibold text-[var(--app-text-85)]">{attachmentTitle}</div>
                      <div className="mt-1 text-[11px] text-[var(--app-text-45)]">
                        {formatAtendimentoFileSize(message.file_size_bytes)}
                      </div>
                      <a
                        href={getAtendimentoDownloadHref(message.media_url, message.file_name)}
                        download={message.file_name ?? true}
                        className="mt-3 inline-flex text-xs font-semibold text-[var(--app-text-85)] underline"
                      >
                        {getAtendimentoDownloadLabel(message.media_type)}
                      </a>
                    </>
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
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <form
        onSubmit={handleSubmit}
        className={desktopExpanded ? "border-t border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-4" : "border-t border-[var(--app-border)] px-4 py-4"}
      >
        <input
          ref={documentInputRef}
          type="file"
          multiple
          accept={ATENDIMENTO_DOCUMENT_MIME_ACCEPT}
          className="hidden"
          onChange={handleFileInputChange}
        />
        <input
          ref={imageInputRef}
          type="file"
          multiple
          accept={ATENDIMENTO_IMAGE_MIME_ACCEPT}
          className="hidden"
          onChange={handleFileInputChange}
        />
        <input
          ref={videoInputRef}
          type="file"
          multiple
          accept={ATENDIMENTO_VIDEO_MIME_ACCEPT}
          className="hidden"
          onChange={handleFileInputChange}
        />

        {uploadItems.length ? (
          <div className="mb-3 space-y-2">
            {uploadItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-text-55)]">
                  <div className="min-w-0 truncate font-semibold text-[var(--app-text-85)]">{item.fileName}</div>
                  <div>{formatAtendimentoFileSize(item.fileSizeBytes)}</div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--app-hover)]">
                  <div
                    className={[
                      "h-full rounded-full transition-all",
                      item.status === "error" ? "bg-red-500" : "bg-emerald-500",
                    ].join(" ")}
                    style={{ width: `${Math.max(6, item.progress)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-[var(--app-text-45)]">
                  {item.status === "uploading"
                    ? `Enviando ${item.progress}%`
                    : item.status === "sending"
                      ? "Salvando no chat..."
                      : item.status === "done"
                        ? "Concluido"
                        : item.status === "error"
                          ? item.error || "Falha no envio."
                          : "Na fila"}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={handleFilePicker}
            disabled={!conversation?.id || disabled}
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Enviar arquivos"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={conversation?.id ? "Mensagem..." : "Selecione um atendimento"}
            disabled={!conversation?.id || disabled}
            rows={1}
            className="h-14 w-full flex-1 resize-none rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-4 text-sm leading-6 text-[var(--app-text-85)] outline-none transition placeholder:text-[var(--app-text-35)] focus:border-emerald-500/40 focus:bg-[var(--app-hover)]"
          />
          <button
            type="submit"
            disabled={!conversation?.id || disabled || !draft.trim()}
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/70 bg-emerald-600 text-[rgb(255,255,255)] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-emerald-500/50 disabled:bg-emerald-600/60 disabled:text-[rgb(255,255,255)] disabled:opacity-100"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>

      <AppModal
        open={attachmentMenuOpen}
        onClose={() => setAttachmentMenuOpen(false)}
        size="lg"
        zIndexClass="z-[520]"
        closeOnBackdrop={false}
        closeOnEscape={false}
        fullScreenOnMobile
        panelClassName="border-white/10 bg-[#0E1723]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Anexos</div>
            <div className="mt-2 text-base font-semibold text-white">Escolha o tipo de anexo</div>
            <div className="mt-1 text-sm text-white/55">Selecione como deseja enviar seu conteudo nesta conversa.</div>
          </div>
          <button
            type="button"
            onClick={() => setAttachmentMenuOpen(false)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => handleAttachmentOption("image")}
            className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4 text-left"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/12 text-emerald-700">
              <ImageIcon className="h-4 w-4" />
            </div>
            <div className="mt-4 text-sm font-semibold text-white">Foto</div>
            <div className="mt-1 text-xs leading-5 text-white/50">Imagens e capturas para compartilhar no atendimento.</div>
          </button>
          <button
            type="button"
            onClick={() => handleAttachmentOption("video")}
            className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4 text-left"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/12 text-sky-700">
              <Clapperboard className="h-4 w-4" />
            </div>
            <div className="mt-4 text-sm font-semibold text-white">Vídeo</div>
            <div className="mt-1 text-xs leading-5 text-white/50">Gravacoes curtas ou vídeos para complementar a conversa.</div>
          </button>
          <button
            type="button"
            onClick={() => handleAttachmentOption("file")}
            className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4 text-left"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/12 text-violet-700">
              <FileText className="h-4 w-4" />
            </div>
            <div className="mt-4 text-sm font-semibold text-white">Arquivo</div>
            <div className="mt-1 text-xs leading-5 text-white/50">PDF, DOC, XLS, ZIP e outros documentos compativeis.</div>
          </button>
        </div>
      </AppModal>

      <AppModal open={Boolean(previewMessage)} onClose={() => setPreviewMessage(null)} size="xl" zIndexClass="z-[530]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-[var(--app-text-85)]">{previewAttachmentTitle}</div>
            {previewMessage ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--app-text-45)]">
                <span>{formatAtendimentoDateTime(previewMessage.created_at)}</span>
                <span>{formatAtendimentoFileSize(previewMessage.file_size_bytes)}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPreviewMessage(null)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)]"
            aria-label="Fechar visualizacao"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {previewMessage?.media_url ? (
          <div className="mt-4 flex flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black">
            {previewMessage.media_type === "image" ? (
              <img
                src={previewMessage.media_url}
                alt={previewAttachmentTitle}
                className="max-h-[calc(100dvh-10rem)] w-full object-contain lg:max-h-[75vh]"
                loading="eager"
              />
            ) : (
              <video
                src={previewMessage.media_url}
                controls
                autoPlay
                playsInline
                className="max-h-[calc(100dvh-10rem)] w-full bg-black object-contain lg:max-h-[75vh]"
                preload="metadata"
              />
            )}
          </div>
        ) : null}
      </AppModal>
    </div>
  );
}
