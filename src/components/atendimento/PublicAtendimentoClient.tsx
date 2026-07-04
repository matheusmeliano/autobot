"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clapperboard, FileText, ImageIcon, Paperclip, Play, Send, X } from "lucide-react";
import { logoutAction } from "@/app/app/actions";
import { AppModal } from "@/components/app/AppModal";
import { getAtendimentoAccountPath, getAtendimentoFilesPath, getAtendimentoPortalPath } from "@/lib/auth/access";
import { AtendimentoFileGallery } from "@/components/atendimento/AtendimentoFileGallery";
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
import type { AtendimentoFileRecord, AtendimentoMessage } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PortalPage = "bot" | "conta" | "arquivos";

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
  const isFilesPage = page === "arquivos";
  const isProfilePage = isAccountPage || isFilesPage;
  const [publicSlug, setPublicSlug] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [messages, setMessages] = useState<AtendimentoMessage[]>([]);
  const [files, setFiles] = useState<AtendimentoFileRecord[]>([]);
  const [filesLoading, setFilesLoading] = useState(isFilesPage);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(!isProfilePage);
  const [sending, setSending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [composerError, setComposerError] = useState("");
  const [initialTotal, setInitialTotal] = useState(4);
  const [awaitingBotSince, setAwaitingBotSince] = useState<number | null>(null);
  const [uploadItems, setUploadItems] = useState<AtendimentoUploadItem[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<AtendimentoMessage | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesRequestIdRef = useRef(0);
  const sessionRequestIdRef = useRef(0);
  const sessionRefreshTimeoutRef = useRef<number | null>(null);
  const typingIndicatorDelayTimeoutRef = useRef<number | null>(null);
  const awaitingBotSinceRef = useRef<number | null>(null);
  const optimisticLeadMessageIdRef = useRef<string | null>(null);
  const optimisticLeadMessageRef = useRef<AtendimentoMessage | null>(null);
  const messagesRef = useRef<AtendimentoMessage[]>([]);
  const pendingBotMessagesRef = useRef<AtendimentoMessage[]>([]);
  const botReplyVisibleAtRef = useRef<number | null>(null);
  const pendingBotFlushTimeoutRef = useRef<number | null>(null);
  const wasComposerDisabledRef = useRef(true);

  const botCount = useMemo(
    () => messages.reduce((acc, msg) => acc + (msg.sender_role === "bot" ? 1 : 0), 0),
    [messages],
  );
  const hasLeadMessage = useMemo(() => messages.some((msg) => msg.sender_role === "lead"), [messages]);
  const isInitialFlow = !hasLeadMessage && initialTotal > 0 && botCount < initialTotal;
  const typing = !loading && !authError && !isProfilePage && (isInitialFlow || awaitingBotSince != null);
  const composerDisabled = loading || Boolean(authError) || isProfilePage;
  const submitLocked = loading || sending || Boolean(authError) || isProfilePage || typing;
  const displayName = profile.nome || currentUser.email.split("@")[0] || "Usuario";
  const firstName = getFirstName(displayName);
  const initialLetter = getInitialLetter(displayName);
  const accountHref = getAtendimentoAccountPath(linkSlug);
  const filesHref = getAtendimentoFilesPath(linkSlug);
  const botHref = getAtendimentoPortalPath(linkSlug);
  const previewAttachmentTitle = previewMessage
    ? getAtendimentoAttachmentTitle({
        mediaType: previewMessage.media_type,
        fileName: previewMessage.file_name,
        contentText: previewMessage.content_text,
      })
    : "";

  async function redirectToLoginAfterSessionLoss() {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {}
    window.location.replace("/login");
  }

  useLayoutEffect(() => {
    if (isProfilePage) return;
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = "56px";
    element.style.overflowY = "hidden";

    const nextHeight = Math.min(element.scrollHeight, 144);
    element.style.height = `${Math.max(56, nextHeight)}px`;
    if (element.scrollHeight > 144) {
      element.style.overflowY = "auto";
    }
  }, [draft, isProfilePage]);

  useLayoutEffect(() => {
    if (isProfilePage) return;
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
  }, [isProfilePage, publicSlug, messages, typing]);

  useEffect(() => {
    awaitingBotSinceRef.current = awaitingBotSince;
  }, [awaitingBotSince]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (isProfilePage) return;
    const wasDisabled = wasComposerDisabledRef.current;
    wasComposerDisabledRef.current = composerDisabled;
    if (composerDisabled || !wasDisabled) return;
    restoreTextareaFocus();
  }, [composerDisabled, isProfilePage]);

  function restoreTextareaFocus() {
    if (isProfilePage) return;
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

  function clearTypingIndicatorDelayTimeout() {
    if (typingIndicatorDelayTimeoutRef.current != null) {
      window.clearTimeout(typingIndicatorDelayTimeoutRef.current);
      typingIndicatorDelayTimeoutRef.current = null;
    }
  }

  function clearPendingBotFlushTimeout() {
    if (pendingBotFlushTimeoutRef.current != null) {
      window.clearTimeout(pendingBotFlushTimeoutRef.current);
      pendingBotFlushTimeoutRef.current = null;
    }
  }

  function updateUploadItem(id: string, patch: Partial<AtendimentoUploadItem>) {
    setUploadItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeUploadItem(id: string) {
    setUploadItems((currentItems) => currentItems.filter((item) => item.id !== id));
  }

  function startAwaitingBotSequence() {
    pendingBotMessagesRef.current = [];
    clearPendingBotFlushTimeout();
    botReplyVisibleAtRef.current = Date.now() + 2500;
    clearTypingIndicatorDelayTimeout();
    typingIndicatorDelayTimeoutRef.current = window.setTimeout(() => {
      const now = Date.now();
      awaitingBotSinceRef.current = now;
      setAwaitingBotSince(now);
      typingIndicatorDelayTimeoutRef.current = null;
    }, 1000);
  }

  function resetAwaitingBotSequence() {
    clearTypingIndicatorDelayTimeout();
    clearPendingBotFlushTimeout();
    pendingBotMessagesRef.current = [];
    botReplyVisibleAtRef.current = null;
    awaitingBotSinceRef.current = null;
    setAwaitingBotSince(null);
  }

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    const res = await fetch(`/api/atendimento/public/files?slug=${encodeURIComponent(linkSlug)}`, {
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      setAuthError("Sua sessão de atendimento expirou. Entre novamente para continuar.");
      setFilesLoading(false);
      void redirectToLoginAfterSessionLoss();
      return;
    }
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      setFiles((json.files ?? []) as AtendimentoFileRecord[]);
    }
    setFilesLoading(false);
  }, [linkSlug]);

  const applyMessages = useCallback(
    (incomingMessages: AtendimentoMessage[], mode: "replace" | "merge" = "replace") => {
      let normalizedMessages = sortAndDedupeMessages(incomingMessages);
      const optimisticLeadMessage = optimisticLeadMessageRef.current;

      if (mode === "replace" && optimisticLeadMessage) {
        const hasConfirmedLeadMessage = normalizedMessages.some((message) => {
          if (message.sender_role !== "lead") return false;
          if (String(message.content_text ?? "").trim() !== String(optimisticLeadMessage.content_text ?? "").trim()) {
            return false;
          }
          const optimisticTime = new Date(optimisticLeadMessage.created_at).getTime();
          const messageTime = new Date(message.created_at).getTime();
          if (!Number.isFinite(optimisticTime) || !Number.isFinite(messageTime)) {
            return true;
          }
          return Math.abs(messageTime - optimisticTime) <= 10000;
        });

        if (!hasConfirmedLeadMessage) {
          normalizedMessages = sortAndDedupeMessages([...normalizedMessages, optimisticLeadMessage]);
        } else {
          optimisticLeadMessageRef.current = null;
          optimisticLeadMessageIdRef.current = null;
        }
      }

      setMessages((currentMessages) => {
        const nextMessages =
          mode === "merge"
            ? sortAndDedupeMessages([...currentMessages, ...normalizedMessages])
            : normalizedMessages;
        return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
      });

      if (awaitingBotSinceRef.current != null) {
        const since = awaitingBotSinceRef.current;
        const hasBotAfter = normalizedMessages.some((message) => {
          if (message.sender_role === "lead") return false;
          const createdAt = new Date(message.created_at).getTime();
          return Number.isFinite(createdAt) && createdAt >= since;
        });
        if (hasBotAfter) {
          awaitingBotSinceRef.current = null;
          setAwaitingBotSince(null);
        }
      }
    },
    [],
  );

  const removeMessage = useCallback((messageId: string) => {
    setMessages((currentMessages) => {
      const nextMessages = currentMessages.filter((message) => String(message.id) !== messageId);
      return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
    });
  }, []);

  const replaceOptimisticLeadMessage = useCallback((confirmedMessage: AtendimentoMessage) => {
    const optimisticId = optimisticLeadMessageIdRef.current;
    const optimisticMessage = optimisticLeadMessageRef.current;

    setMessages((currentMessages) => {
      const withoutOptimisticMessage = optimisticId
        ? currentMessages.filter((message) => String(message.id) !== optimisticId)
        : currentMessages;
      const nextMessages = sortAndDedupeMessages([...withoutOptimisticMessage, confirmedMessage]);
      return sameMessages(currentMessages, nextMessages) ? currentMessages : nextMessages;
    });

    if (
      optimisticMessage &&
      String(confirmedMessage.content_text ?? "").trim() === String(optimisticMessage.content_text ?? "").trim()
    ) {
      optimisticLeadMessageIdRef.current = null;
      optimisticLeadMessageRef.current = null;
    }
  }, []);

  const flushPendingBotMessages = useCallback(() => {
    clearPendingBotFlushTimeout();
    const pendingMessages = pendingBotMessagesRef.current;
    pendingBotMessagesRef.current = [];
    botReplyVisibleAtRef.current = null;
    if (pendingMessages.length) {
      applyMessages(pendingMessages, "merge");
    }
  }, [applyMessages]);

  const applyMessagesWithBotTiming = useCallback(
    (incomingMessages: AtendimentoMessage[], mode: "replace" | "merge" = "replace") => {
      const visibleAt = botReplyVisibleAtRef.current;
      if (!visibleAt) {
        applyMessages(incomingMessages, mode);
        return;
      }

      const remainingMs = visibleAt - Date.now();
      if (remainingMs <= 0) {
        flushPendingBotMessages();
        applyMessages(incomingMessages, mode);
        return;
      }

      const existingVisibleIds = new Set(messagesRef.current.map((message) => String(message.id ?? "")));
      const pendingIds = new Set(pendingBotMessagesRef.current.map((message) => String(message.id ?? "")));
      const gatedBotMessages = incomingMessages.filter((message) => {
        if (message.sender_role !== "bot") return false;
        const messageId = String(message.id ?? "");
        return Boolean(messageId) && !existingVisibleIds.has(messageId) && !pendingIds.has(messageId);
      });

      if (!gatedBotMessages.length) {
        applyMessages(incomingMessages, mode);
        return;
      }

      const gatedIds = new Set(gatedBotMessages.map((message) => String(message.id ?? "")));
      const immediateMessages = incomingMessages.filter((message) => !gatedIds.has(String(message.id ?? "")));
      pendingBotMessagesRef.current = sortAndDedupeMessages([...pendingBotMessagesRef.current, ...gatedBotMessages]);
      clearPendingBotFlushTimeout();
      pendingBotFlushTimeoutRef.current = window.setTimeout(() => {
        flushPendingBotMessages();
      }, remainingMs);
      applyMessages(immediateMessages, mode);
    },
    [applyMessages, flushPendingBotMessages],
  );

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
        applyMessagesWithBotTiming(nextMessages, mode);
      }
      return nextMessages;
    },
    [applyMessagesWithBotTiming],
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

  async function sendLeadMessage(params: {
    content_text?: string;
    media_type?: AtendimentoMessage["media_type"];
    media_url?: string | null;
    mime_type?: string | null;
    file_name?: string | null;
    file_size_bytes?: number | null;
    optimisticMessage?: AtendimentoMessage | null;
  }) {
    if (!publicSlug) {
      return { ok: false as const, error: "Conversa indisponivel no momento." };
    }

    const optimisticMessage = params.optimisticMessage ?? null;
    if (optimisticMessage) {
      optimisticLeadMessageIdRef.current = optimisticMessage.id;
      optimisticLeadMessageRef.current = optimisticMessage;
      applyMessages([optimisticMessage], "merge");
    }

    startAwaitingBotSequence();

    try {
      const res = await fetch("/api/atendimento/public/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_slug: publicSlug,
          content_text: params.content_text ?? "",
          media_type: params.media_type ?? "text",
          media_url: params.media_url ?? null,
          mime_type: params.mime_type ?? null,
          file_name: params.file_name ?? null,
          file_size_bytes: params.file_size_bytes ?? null,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        if (optimisticMessage) {
          removeMessage(optimisticMessage.id);
          optimisticLeadMessageIdRef.current = null;
          optimisticLeadMessageRef.current = null;
        }
        resetAwaitingBotSequence();
        setAuthError("Sua sessão de atendimento expirou. Entre novamente para continuar.");
        void redirectToLoginAfterSessionLoss();
        return { ok: false as const, error: "Sua sessão expirou. Entre novamente para continuar." };
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        if (optimisticMessage) {
          removeMessage(optimisticMessage.id);
          optimisticLeadMessageIdRef.current = null;
          optimisticLeadMessageRef.current = null;
        }
        resetAwaitingBotSequence();
        return {
          ok: false as const,
          error: String(json?.error ?? "Falha ao enviar sua mensagem. Tente novamente."),
        };
      }

      if (json.inbound?.id) {
        if (optimisticMessage) {
          replaceOptimisticLeadMessage(json.inbound as AtendimentoMessage);
        } else {
          applyMessages([json.inbound as AtendimentoMessage], "merge");
        }
      } else if (optimisticMessage) {
        removeMessage(optimisticMessage.id);
        optimisticLeadMessageIdRef.current = null;
        optimisticLeadMessageRef.current = null;
      }

      if (json.outbound?.id) {
        window.setTimeout(() => {
          void loadMessages(publicSlug, "replace");
        }, 180);
      }
      setComposerError("");
      return { ok: true as const };
    } finally {
      restoreTextareaFocus();
    }
  }

  async function submitDraft() {
    const contentText = draft.trim();
    if (!contentText || !publicSlug || submitLocked) return;
    const optimisticMessageId = `optimistic:${Date.now()}`;
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: AtendimentoMessage = {
      id: optimisticMessageId,
      conversation_id: conversationId,
      sender_role: "lead",
      content_text: contentText,
      media_type: "text",
      media_url: null,
      mime_type: null,
      file_name: null,
      file_size_bytes: null,
      external_message_id: null,
      status: "recebida",
      sent_at: optimisticCreatedAt,
      delivered_at: optimisticCreatedAt,
      read_at: null,
      created_at: optimisticCreatedAt,
    };

    setSending(true);
    setDraft("");
    setComposerError("");
    try {
      const result = await sendLeadMessage({
        content_text: contentText,
        optimisticMessage,
      });
      if (!result.ok) {
        setDraft(contentText);
        setComposerError(result.error);
      }
    } finally {
      setSending(false);
    }
  }

  async function uploadSelectedFiles(fileList: FileList | File[]) {
    if (!publicSlug || submitLocked) return;
    const { files, errors } = validateAtendimentoFiles(fileList);
    if (errors.length) {
      setComposerError(errors.join(" "));
      alert(errors.join("\n"));
      return;
    }

    setSending(true);
    setComposerError("");
    try {
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
            conversationId,
            senderRole: "lead",
            file,
            onProgress: (progress) => updateUploadItem(uploadId, { progress }),
          });
          updateUploadItem(uploadId, { status: "sending", progress: 100 });
          const result = await sendLeadMessage({
            content_text: "",
            media_type: uploaded.media_type,
            media_url: uploaded.media_url,
            mime_type: uploaded.mime_type,
            file_name: uploaded.file_name,
            file_size_bytes: uploaded.file_size_bytes,
          });
          if (!result.ok) {
            updateUploadItem(uploadId, { status: "error", error: result.error });
            setComposerError(result.error);
            continue;
          }
          updateUploadItem(uploadId, { status: "done", progress: 100 });
          window.setTimeout(() => removeUploadItem(uploadId), 1400);
        } catch (error) {
          updateUploadItem(uploadId, {
            status: "error",
            error: error instanceof Error ? error.message : "Falha no upload.",
          });
        }
      }
    } finally {
      setSending(false);
      if (documentInputRef.current) documentInputRef.current.value = "";
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  function handleFilePicker() {
    if (submitLocked) return;
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

  useEffect(() => {
    if (isProfilePage) return;
    void loadSession();
  }, [isProfilePage, loadSession]);

  useEffect(() => {
    if (!isFilesPage) return;
    void loadFiles();
  }, [isFilesPage, loadFiles]);

  useEffect(() => {
    return () => {
      clearTypingIndicatorDelayTimeout();
      clearPendingBotFlushTimeout();
      pendingBotMessagesRef.current = [];
      botReplyVisibleAtRef.current = null;
      awaitingBotSinceRef.current = null;
    };
  }, [flushPendingBotMessages]);

  useEffect(() => {
    if (isProfilePage || !publicSlug || authError || loading || !isInitialFlow) return;
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
  }, [authError, isInitialFlow, isProfilePage, loadMessages, loading, publicSlug]);

  useEffect(() => {
    if (isProfilePage || !publicSlug || !conversationId || !leadId || authError) return;

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
          if (nextMessage.sender_role === "lead" && optimisticLeadMessageIdRef.current) {
            replaceOptimisticLeadMessage(nextMessage);
            return;
          }
          applyMessagesWithBotTiming([nextMessage], "merge");
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
    applyMessagesWithBotTiming,
    authError,
    conversationId,
    isProfilePage,
    leadId,
    loadMessages,
    publicSlug,
    replaceOptimisticLeadMessage,
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

  function handleLogoutSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (window.confirm("Tem certeza que deseja sair?")) return;
    event.preventDefault();
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

          {isProfilePage ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Link
                  href={botHref}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Bot
                </Link>
                <Link
                  href={accountHref}
                  className={[
                    "inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                    isAccountPage
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                      : "border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  Conta
                </Link>
                <Link
                  href={filesHref}
                  className={[
                    "inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                    isFilesPage
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                      : "border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  Arquivos
                </Link>
                <form action={logoutAction} onSubmit={handleLogoutSubmit}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07]"
                  >
                    Sair
                  </button>
                </form>
              </div>
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
        ) : isFilesPage ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
            {authError ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm text-amber-100">
                {authError}
              </div>
            ) : filesLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="h-3 w-20 animate-pulse rounded-full bg-white/10" />
                    <div className="mt-3 h-40 animate-pulse rounded-2xl bg-white/10" />
                    <div className="mt-4 h-4 w-3/4 animate-pulse rounded-full bg-white/10" />
                    <div className="mt-3 flex gap-2">
                      <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
                      <div className="h-3 w-16 animate-pulse rounded-full bg-white/10" />
                    </div>
                    <div className="mt-4 h-3 w-20 animate-pulse rounded-full bg-white/10" />
                  </div>
                ))}
              </div>
            ) : (
              <AtendimentoFileGallery
                files={files}
                emptyMessage="Nenhum arquivo foi trocado nesta conversa ainda."
                tone="portal"
              />
            )}
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
                    const senderLabel =
                      message.sender_role === "bot" ? "Bot" : isLead ? "Enviado por você" : "Enviado por atendimento";
                    const attachmentTitle = getAtendimentoAttachmentTitle({
                      mediaType: message.media_type,
                      fileName: message.file_name,
                      contentText: message.content_text,
                    });
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
                          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">{senderLabel}</div>
                          {message.media_url && message.media_type === "image" ? (
                            <button
                              type="button"
                              onClick={() => setPreviewMessage(message)}
                              className="group mb-3 block w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20 text-left transition hover:border-emerald-400/35"
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
                              className="group relative mb-3 block w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20 text-left transition hover:border-emerald-400/35"
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
                            <div className="whitespace-pre-wrap text-sm text-white/90">{message.content_text}</div>
                          ) : null}
                          {message.media_url ? (
                            <>
                              <div className="mt-2 text-xs font-semibold text-white/85">{attachmentTitle}</div>
                              <div className="mt-1 text-[11px] text-white/45">
                                {formatAtendimentoFileSize(message.file_size_bytes)}
                              </div>
                              <a
                                href={getAtendimentoDownloadHref(message.media_url, message.file_name)}
                                download={message.file_name ?? true}
                                className="mt-3 inline-flex text-xs font-semibold text-emerald-200 underline"
                              >
                                {getAtendimentoDownloadLabel(message.media_type)}
                              </a>
                            </>
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
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-white/75">
                        <div className="min-w-0 truncate font-semibold">{item.fileName}</div>
                        <div>{formatAtendimentoFileSize(item.fileSizeBytes)}</div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={[
                            "h-full rounded-full transition-all",
                            item.status === "error" ? "bg-red-400" : "bg-emerald-500",
                          ].join(" ")}
                          style={{ width: `${Math.max(6, item.progress)}%` }}
                        />
                      </div>
                      <div className="mt-2 text-[11px] text-white/55">
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

              {composerError ? (
                <div className="mb-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                  {composerError}
                </div>
              ) : null}

              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={handleFilePicker}
                  disabled={submitLocked}
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Enviar arquivos"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Mensagem..."
                  rows={1}
                  disabled={composerDisabled}
                  className="h-14 w-full flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-white outline-none transition placeholder:text-white/30 focus:border-emerald-500/40 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || submitLocked}
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/70 bg-emerald-600 text-[rgb(255,255,255)] transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-emerald-500/50 disabled:bg-emerald-600/60 disabled:text-[rgb(255,255,255)] disabled:opacity-100"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      <AppModal
        open={attachmentMenuOpen}
        onClose={() => setAttachmentMenuOpen(false)}
        size="lg"
        zIndexClass="z-[520]"
        closeOnBackdrop={false}
        closeOnEscape={false}
        fullScreenOnMobile
        panelClassName="border-white/10 bg-[#0E1723] shadow-[0_32px_120px_rgba(0,0,0,0.45)]"
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

      <AppModal open={Boolean(previewMessage)} onClose={() => setPreviewMessage(null)} size="xl" zIndexClass="z-[540]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-white">{previewAttachmentTitle}</div>
            {previewMessage ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/50">
                <span>{formatAtendimentoDateTime(previewMessage.created_at)}</span>
                <span>{formatAtendimentoFileSize(previewMessage.file_size_bytes)}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPreviewMessage(null)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08]"
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
