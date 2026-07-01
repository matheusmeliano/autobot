"use client";

import type { AtendimentoFileRecord } from "@/lib/atendimento/types";
import { formatAtendimentoDateTime } from "@/lib/atendimento/utils";
import { formatAtendimentoFileSize, getAtendimentoAttachmentTitle } from "@/lib/atendimento/files";

export function AtendimentoFileGallery({
  files,
  emptyMessage,
  tone = "app",
}: {
  files: AtendimentoFileRecord[];
  emptyMessage: string;
  tone?: "app" | "portal";
}) {
  if (!files.length) {
    return <div className={tone === "portal" ? "text-sm text-white/55" : "text-sm text-[var(--app-text-55)]"}>{emptyMessage}</div>;
  }

  return (
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

        return (
          <div key={file.id} className={cardClassName}>
            <div className={eyebrowClassName}>{file.sender_role === "lead" ? "Cliente" : "Atendimento"}</div>
            {(file.media_type === "image" || file.media_type === "video") && file.media_url ? (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                {file.media_type === "image" ? (
                  <img src={file.media_url} alt={title} className="h-48 w-full object-cover" loading="lazy" />
                ) : (
                  <video src={file.media_url} controls className="h-48 w-full bg-black object-cover" preload="metadata" />
                )}
              </div>
            ) : null}
            <div className={titleClassName}>{title}</div>
            <div className={metaClassName}>
              <span>{formatAtendimentoDateTime(file.created_at)}</span>
              <span>{formatAtendimentoFileSize(file.file_size_bytes)}</span>
            </div>
            <a href={file.media_url} target="_blank" rel="noreferrer" className={linkClassName}>
              Abrir arquivo
            </a>
          </div>
        );
      })}
    </div>
  );
}
