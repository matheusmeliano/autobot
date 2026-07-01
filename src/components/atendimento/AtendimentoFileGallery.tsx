"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import type { AtendimentoFileRecord } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";
import { formatAtendimentoFileSize, getAtendimentoAttachmentTitle } from "@/lib/atendimento/files";

function getAtendimentoDownloadLabel(mediaType: AtendimentoFileRecord["media_type"]) {
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

export function AtendimentoFileGallery({
  files,
  emptyMessage,
  tone = "app",
}: {
  files: AtendimentoFileRecord[];
  emptyMessage: string;
  tone?: "app" | "portal";
}) {
  const [previewFile, setPreviewFile] = useState<AtendimentoFileRecord | null>(null);

  if (!files.length) {
    return <div className={tone === "portal" ? "text-sm text-white/55" : "text-sm text-[var(--app-text-55)]"}>{emptyMessage}</div>;
  }

  const previewTitle = previewFile
    ? getAtendimentoAttachmentTitle({
        mediaType: previewFile.media_type,
        fileName: previewFile.file_name,
        contentText: previewFile.content_text,
      })
    : "";

  const previewMetaClassName =
    tone === "portal"
      ? "mt-2 flex flex-wrap gap-2 text-xs text-white/50"
      : "mt-2 flex flex-wrap gap-2 text-xs text-[var(--app-text-45)]";
  const previewButtonClassName =
    tone === "portal"
      ? "group relative mt-3 block w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20 text-left transition hover:border-emerald-400/35"
      : "group relative mt-3 block w-full overflow-hidden rounded-2xl border border-[var(--app-border)] bg-black/20 text-left transition hover:border-[var(--app-text-35)]";

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {files.map((file) => {
          const title = getAtendimentoAttachmentTitle({
            mediaType: file.media_type,
            fileName: file.file_name,
            contentText: file.content_text,
          });
          const cardClassName =
            tone === "portal"
              ? "rounded-2xl border border-white/10 bg-white/[0.04] p-4"
              : "rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4";
          const eyebrowClassName =
            tone === "portal"
              ? "text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45"
              : "text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-45)]";
          const titleClassName =
            tone === "portal"
              ? "mt-2 truncate text-sm font-semibold text-white"
              : "mt-2 truncate text-sm font-semibold text-[var(--app-text-85)]";
          const metaClassName =
            tone === "portal"
              ? "mt-3 flex flex-wrap gap-2 text-[11px] text-white/50"
              : "mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--app-text-45)]";
          const linkClassName =
            tone === "portal"
              ? "mt-3 inline-flex text-xs font-semibold text-emerald-200 underline"
              : "mt-3 inline-flex text-xs font-semibold text-[var(--app-text-85)] underline";
          const isPreviewable = (file.media_type === "image" || file.media_type === "video") && Boolean(file.media_url);
          const downloadLabel = getAtendimentoDownloadLabel(file.media_type);
          const downloadHref = getAtendimentoDownloadHref(file.media_url, file.file_name);
          const senderLabel =
            tone === "portal"
              ? file.sender_role === "lead"
                ? "Enviado por você"
                : "Enviado por atendimento"
              : file.sender_role === "lead"
                ? "Enviado por aluno"
                : "Enviado por você";

          return (
            <div key={file.id} className={cardClassName}>
              <div className={eyebrowClassName}>{senderLabel}</div>
              {isPreviewable ? (
                <button type="button" onClick={() => setPreviewFile(file)} className={previewButtonClassName} aria-label={`Visualizar ${title}`}>
                  {file.media_type === "image" ? (
                    <img src={file.media_url ?? ""} alt={title} className="h-48 w-full object-cover transition duration-200 group-hover:scale-[1.02]" loading="lazy" />
                  ) : (
                    <>
                      <video
                        src={file.media_url ?? ""}
                        className="h-48 w-full bg-black object-cover"
                        preload="metadata"
                        muted
                        playsInline
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg">
                          <Play className="h-5 w-5 fill-current" />
                        </span>
                      </div>
                    </>
                  )}
                </button>
              ) : null}
              <div className={titleClassName}>{title}</div>
              <div className={metaClassName}>
                <span>{formatAtendimentoDateTime(file.created_at)}</span>
                <span>{formatAtendimentoFileSize(file.file_size_bytes)}</span>
              </div>
              <a
                href={downloadHref}
                download={file.file_name ?? true}
                className={linkClassName}
              >
                {downloadLabel}
              </a>
            </div>
          );
        })}
      </div>

      <AppModal open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} size="xl" zIndexClass="z-[360]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={tone === "portal" ? "truncate text-base font-semibold text-white" : "truncate text-base font-semibold text-[var(--app-text-85)]"}>
              {previewTitle}
            </div>
            {previewFile ? (
              <div className={previewMetaClassName}>
                <span>{formatAtendimentoDateTime(previewFile.created_at)}</span>
                <span>{formatAtendimentoFileSize(previewFile.file_size_bytes)}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPreviewFile(null)}
            className={
              tone === "portal"
                ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08]"
                : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)] transition hover:bg-[var(--app-hover)]"
            }
            aria-label="Fechar visualizacao"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {previewFile?.media_url ? (
          <div className="mt-4 flex flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black">
            {previewFile.media_type === "image" ? (
              <img src={previewFile.media_url} alt={previewTitle} className="max-h-[calc(100dvh-10rem)] w-full object-contain lg:max-h-[75vh]" loading="eager" />
            ) : (
              <video
                src={previewFile.media_url}
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
    </>
  );
}
