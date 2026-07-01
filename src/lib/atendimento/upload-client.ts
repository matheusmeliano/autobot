export type AtendimentoUploadedFilePayload = {
  media_url: string;
  media_type: "image" | "video";
  mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number;
};

export async function uploadAtendimentoFileWithProgress(params: {
  endpoint: string;
  file: File;
  extraFields?: Record<string, string>;
  onProgress?: (progress: number) => void;
}) {
  return await new Promise<AtendimentoUploadedFilePayload>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", params.endpoint, true);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !params.onProgress) return;
      const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      params.onProgress(progress);
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.onload = () => {
      const response = xhr.response ?? JSON.parse(xhr.responseText || "null");
      if (xhr.status < 200 || xhr.status >= 300 || !response?.ok || !response?.file?.media_url) {
        reject(new Error(String(response?.error ?? "upload_failed")));
        return;
      }
      params.onProgress?.(100);
      resolve(response.file as AtendimentoUploadedFilePayload);
    };

    const formData = new FormData();
    formData.append("file", params.file);
    Object.entries(params.extraFields ?? {}).forEach(([key, value]) => {
      formData.append(key, value);
    });
    xhr.send(formData);
  });
}
