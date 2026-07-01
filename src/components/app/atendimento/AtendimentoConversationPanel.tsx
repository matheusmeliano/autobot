"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Paperclip, Send } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import {
  ATENDIMENTO_IMAGE_MIME_ACCEPT,
  ATENDIMENTO_VIDEO_MIME_ACCEPT,
  formatAtendimentoFileSize,
  getAtendimentoAttachmentTitle,
  getAtendimentoMediaTypeFromMimeType,
  type AtendimentoUploadItem,
  validateAtendimentoFiles,
} from "@/lib/atendimento/files";
import { uploadAtendimentoFileWithProgress } from "@/lib/atendimento/upload-client";
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
  const [draft, setDraft] = useState("");
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const [uploadItems, setUploadItems] = useState<AtendimentoUploadItem[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const orderedMessages = useMemo(() => messages.slice(), [messages]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

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

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [conversation?.id, orderedMessages.length]);

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
      const mediaType = getAtendimentoMediaTypeFromMimeType(file.type);
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
          endpoint: `/api/atendimento/conversas/${conversation.id}/upload`,
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

    if (imageInputRef.current) imageInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function handleFilePicker() {
    if (!conversation?.id || disabled) return;
    setAttachmentMenuOpen(true);
  }

  function handleAttachmentOption(kind: "image" | "video") {
    setAttachmentMenuOpen(false);
    window.requestAnimationFrame(() => {
      if (kind === "image") {
        imageInputRef.current?.click();
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
      <div
        className={[
          "flex items-start justify-between gap-3 border-b border-[var(--app-border)] px-4 py-4",
          desktopExpanded ? "bg-[var(--app-bg)]" : "",
        ].join(" ")}
      >
        <div className="text-sm font-semibold text-[var(--app-text-85)]">Conversa</div>
        {!compact ? (
          <button
            type="button"
            onClick={() => setDesktopExpanded((current) => !current)}
            className="hidden h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)] lg:inline-flex"
            aria-label={desktopExpanded ? "Sair da tela cheia" : "Expandir conversa"}
          >
            {desktopExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      <div
        ref={messagesViewportRef}
        className={desktopExpanded ? "flex-1 space-y-3 overflow-y-auto bg-[var(--app-bg)] px-4 py-4" : "flex-1 space-y-3 overflow-y-auto px-4 py-4"}
      >
        {orderedMessages.length ? (
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
                    {isLead ? "Lead" : isBot ? "Bot" : "Atendente"}
                  </div>
                  {message.media_url && message.media_type === "image" ? (
                    <img
                      src={message.media_url}
                      alt={attachmentTitle}
                      className="mt-3 max-h-64 w-full rounded-2xl object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  {message.media_url && message.media_type === "video" ? (
                    <video
                      src={message.media_url}
                      controls
                      preload="metadata"
                      className="mt-3 max-h-72 w-full rounded-2xl bg-black"
                    />
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
                        href={message.media_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex text-xs font-semibold text-[var(--app-text-85)] underline"
                      >
                        Abrir anexo
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
      </div>

      <form
        onSubmit={handleSubmit}
        className={desktopExpanded ? "border-t border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-4" : "border-t border-[var(--app-border)] px-4 py-4"}
      >
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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <button
            type="button"
            onClick={handleFilePicker}
            disabled={!conversation?.id || disabled}
            className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-auto sm:min-h-14 sm:w-14"
            aria-label="Enviar arquivos"
          >
            <Paperclip className="h-4 w-4" />
          </button>
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

      <AppModal open={attachmentMenuOpen} onClose={() => setAttachmentMenuOpen(false)} size="md" zIndexClass="z-[520]">
        <div className="text-sm font-semibold text-[var(--app-text-85)]">Escolha o tipo de anexo</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleAttachmentOption("image")}
            className="inline-flex items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
          >
            Foto
          </button>
          <button
            type="button"
            onClick={() => handleAttachmentOption("video")}
            className="inline-flex items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
          >
            Video
          </button>
        </div>
      </AppModal>
    </div>
  );
}
