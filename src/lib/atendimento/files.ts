export const ATENDIMENTO_FILES_BUCKET = "atendimento-files";
export const MAX_UPLOAD_FILES_PER_BATCH = 10;
export const MAX_IMAGE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_FILE_SIZE_BYTES = 250 * 1024 * 1024;

export type AtendimentoUploadStatus = "queued" | "uploading" | "sending" | "done" | "error";

export type AtendimentoUploadItem = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  progress: number;
  status: AtendimentoUploadStatus;
  error?: string | null;
};

export function getAtendimentoAcceptedMimeTypes() {
  return "image/*,video/*";
}

export function getAtendimentoMediaTypeFromMimeType(mimeType: unknown) {
  const normalizedMimeType = String(mimeType ?? "").trim().toLowerCase();
  if (normalizedMimeType.startsWith("image/")) return "image" as const;
  if (normalizedMimeType.startsWith("video/")) return "video" as const;
  return null;
}

export function getAtendimentoMaxFileSizeBytes(mimeType: unknown) {
  const mediaType = getAtendimentoMediaTypeFromMimeType(mimeType);
  if (mediaType === "image") return MAX_IMAGE_FILE_SIZE_BYTES;
  if (mediaType === "video") return MAX_VIDEO_FILE_SIZE_BYTES;
  return 0;
}

export function formatAtendimentoFileSize(bytes: unknown) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function buildAtendimentoStoragePath(params: {
  conversationId: string;
  senderRole: string;
  originalFileName: string;
}) {
  const normalizedName = String(params.originalFileName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  const safeName = normalizedName || "arquivo";
  return `conversations/${params.conversationId}/${params.senderRole}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}-${safeName}`;
}

export function getAtendimentoAttachmentTitle(params: {
  mediaType: unknown;
  fileName?: unknown;
  contentText?: unknown;
}) {
  const fileName = String(params.fileName ?? "").trim();
  if (fileName) return fileName;
  const contentText = String(params.contentText ?? "").trim();
  if (contentText) return contentText;
  const mediaType = String(params.mediaType ?? "").trim().toLowerCase();
  if (mediaType === "image") return "Imagem";
  if (mediaType === "video") return "Video";
  return "Arquivo";
}

export function getAtendimentoConversationPreviewText(params: {
  contentText?: unknown;
  mediaType?: unknown;
  fileName?: unknown;
}) {
  const contentText = String(params.contentText ?? "").trim();
  if (contentText) return contentText;
  const fileName = String(params.fileName ?? "").trim();
  if (fileName) return fileName;
  const mediaType = String(params.mediaType ?? "").trim().toLowerCase();
  if (mediaType === "image") return "[Imagem]";
  if (mediaType === "video") return "[Video]";
  if (mediaType) return `[${mediaType}]`;
  return "[Arquivo]";
}

export function validateAtendimentoFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList ?? []);
  const errors: string[] = [];
  if (!files.length) {
    errors.push("Selecione ao menos um arquivo.");
    return { files, errors };
  }
  if (files.length > MAX_UPLOAD_FILES_PER_BATCH) {
    errors.push(`Voce pode enviar no maximo ${MAX_UPLOAD_FILES_PER_BATCH} arquivos por vez.`);
  }
  files.forEach((file) => {
    const mediaType = getAtendimentoMediaTypeFromMimeType(file.type);
    if (!mediaType) {
      errors.push(`${file.name}: apenas fotos e videos sao permitidos.`);
      return;
    }
    const maxSize = getAtendimentoMaxFileSizeBytes(file.type);
    if (file.size > maxSize) {
      const limitLabel = mediaType === "image" ? "25 MB" : "250 MB";
      errors.push(`${file.name}: limite de ${limitLabel} por arquivo.`);
    }
  });
  return { files: files.slice(0, MAX_UPLOAD_FILES_PER_BATCH), errors };
}
