import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATENDIMENTO_FILES_BUCKET,
  buildAtendimentoStoragePath,
  getAtendimentoMediaTypeFromMimeType,
  isAtendimentoDocumentExtensionAllowed,
} from "@/lib/atendimento/files";

export type AtendimentoUploadedFilePayload = {
  media_url: string;
  media_type: "image" | "video" | "file";
  mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number;
};

export async function uploadAtendimentoFileWithProgress(params: {
  supabase: SupabaseClient;
  conversationId: string;
  senderRole: "lead" | "attendant";
  file: File;
  onProgress?: (progress: number) => void;
}) {
  const mediaType =
    getAtendimentoMediaTypeFromMimeType(params.file.type) ??
    (isAtendimentoDocumentExtensionAllowed(params.file.name) ? "file" : null);
  if (!mediaType) {
    throw new Error("unsupported_file_type");
  }

  const {
    data: { session },
  } = await params.supabase.auth.getSession();

  const accessToken = String(session?.access_token ?? "").trim();
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!accessToken || !supabaseUrl) {
    throw new Error("upload_auth_missing");
  }

  const storagePath = buildAtendimentoStoragePath({
    conversationId: params.conversationId,
    senderRole: params.senderRole,
    originalFileName: params.file.name,
  });

  return await new Promise<AtendimentoUploadedFilePayload>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${supabaseUrl}/storage/v1/object/${ATENDIMENTO_FILES_BUCKET}/${encodeURI(storagePath).replace(/%5C/g, "/")}`,
      true,
    );
    xhr.responseType = "json";
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""));
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", params.file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !params.onProgress) return;
      const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      params.onProgress(progress);
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.onload = () => {
      const response = xhr.response ?? JSON.parse(xhr.responseText || "null");
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(String(response?.message ?? response?.error ?? "upload_failed")));
        return;
      }
      params.onProgress?.(100);
      const { data } = params.supabase.storage.from(ATENDIMENTO_FILES_BUCKET).getPublicUrl(storagePath);
      resolve({
        media_url: String(data.publicUrl ?? "").trim(),
        media_type: mediaType,
        mime_type: String(params.file.type ?? "").trim() || null,
        file_name: String(params.file.name ?? "").trim() || null,
        file_size_bytes: Number(params.file.size ?? 0) || 0,
      });
    };
    xhr.send(params.file);
  });
}
