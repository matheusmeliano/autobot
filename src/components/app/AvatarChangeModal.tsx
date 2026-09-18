"use client";

import { useState, useRef, useTransition, useMemo } from "react";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import { Camera, Loader2, X } from "lucide-react";
import {
  uploadProfileAvatarAction,
  deleteProfileAvatarAction,
} from "@/app/app/configuracoes/avatarActions";


const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT_ATTR = "image/jpeg,image/jpg,image/png,image/webp,image/gif";

export function AvatarChangeModal({
  open,
  onClose,
  currentAvatarUrl,
  displayName,
  email,
  onAvatarChanged,
}: {
  open: boolean;
  onClose: () => void;
  currentAvatarUrl: string | null;
  displayName: string;
  email: string;
  onAvatarChanged: (newUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, startUpload] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const busy = isUploading || isDeleting;

  const initials = String(displayName ?? email ?? "U")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);

  const hasUserAvatar = Boolean(String(currentAvatarUrl ?? "").trim());

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    if (!String(file.type ?? "").startsWith("image/")) {
      modalToast.error("Tipo de arquivo não permitido. Escolha uma imagem.");
      return;
    }
    if (file.size > MAX_BYTES) {
      modalToast.error("Arquivo muito grande. Tamanho máximo permitido: 5 MB.");
      return;
    }

    const fd = new FormData();
    fd.append("avatar", file);
    startUpload(async () => {
      const res = await uploadProfileAvatarAction(fd);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao enviar imagem.");
        return;
      }
      onAvatarChanged(res.newUrl);
      const id = modalToast.success("Foto de perfil atualizada!");
      await modalToast.wait(id);
      onClose();
    });
  };

  const handleRemove = () => {
    startDelete(async () => {
      const res = await deleteProfileAvatarAction();
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao remover foto.");
        return;
      }
      onAvatarChanged(null);
      const id = modalToast.success("Foto de perfil removida.");
      await modalToast.wait(id);
      onClose();
    });
  };

  return (
    <AppModal open={open} onClose={onClose} size="md" zIndexClass="z-[360]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-bold tracking-tight text-[var(--app-text-85)]">
            Foto de perfil
          </div>
          <div className="mt-1 text-[13px] text-[var(--app-text-55)]">
            Formatos aceitos: JPG, JPEG, PNG, WEBP ou GIF. Tamanho máximo: 5 MB.
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-text-65)] hover:bg-[var(--app-hover)] disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 flex flex-col items-center">
        {hasUserAvatar ? (
          <div className="relative inline-flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full bg-transparent p-0">
            <img
              src={currentAvatarUrl!}
              alt="Foto de perfil"
              className="h-full w-full shrink-0 object-cover"
            />
          </div>
        ) : (
          <div className="relative inline-flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color:var(--app-active)] bg-[color:var(--app-active)]">
            <span className="text-3xl font-bold tracking-tight text-[#9a3412]">
              {initials || "U"}
            </span>
          </div>
        )}

        <div className="mt-6 w-full flex flex-col items-center gap-3">
          <input
            ref={inputRef}
            id="profile-avatar-input"
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={handleFileSelected}
            disabled={busy}
          />
          <label
            htmlFor="profile-avatar-input"
            className={[
              "inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold",
              "bg-[#ea580c] !text-white",
              busy ? "pointer-events-none opacity-60" : "",
            ].join(" ")}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin !text-white" />
                <span className="!text-white">Enviando imagem…</span>
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 !text-white" />
                <span className="!text-white">Escolher imagem</span>
              </>
            )}
          </label>

          {hasUserAvatar ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-5 text-[15px] font-semibold text-[var(--app-text-75)] hover:bg-[var(--app-hover)] disabled:opacity-50"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Removendo foto…
                </>
              ) : (
                "Remover foto atual"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </AppModal>
  );
}
