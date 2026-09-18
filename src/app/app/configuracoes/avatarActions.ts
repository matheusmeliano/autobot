"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient, tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";

const PROFILE_AVATARS_BUCKET = "profile-avatars";
const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_AVATAR_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const PROFILE_AVATAR_ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function getAvatarExtFromMime(mime: string): string | null {
  const clean = String(mime ?? "").trim().toLowerCase();
  if (clean === "image/jpeg" || clean === "image/jpg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  return null;
}

function getAvatarExtFromName(name: string): string | null {
  const clean = String(name ?? "").trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1);
  return PROFILE_AVATAR_ALLOWED_EXT.has(ext) ? ext : null;
}

function extractAvatarStoragePathFromPublicUrl(
  publicUrl: string,
): { bucket: string; path: string } | null {
  try {
    const raw = String(publicUrl ?? "").trim();
    if (!raw) return null;
    const marker = `/storage/v1/object/public/${PROFILE_AVATARS_BUCKET}/`;
    const idx = raw.indexOf(marker);
    if (idx >= 0) {
      return { bucket: PROFILE_AVATARS_BUCKET, path: raw.slice(idx + marker.length) };
    }
    const altMarker = `${PROFILE_AVATARS_BUCKET}/`;
    const idx2 = raw.indexOf(altMarker);
    if (idx2 >= 0) {
      return { bucket: PROFILE_AVATARS_BUCKET, path: raw.slice(idx2 + altMarker.length) };
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureProfileAvatarsBucketAdmin(): Promise<void> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return;
  try {
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (listErr) throw listErr;
    const exists = buckets?.some(
      (b) => String(b.id ?? b.name ?? "") === PROFILE_AVATARS_BUCKET,
    );
    if (exists) return;
    const { error: createErr } = await admin.storage.createBucket(PROFILE_AVATARS_BUCKET, {
      public: true,
      fileSizeLimit: PROFILE_AVATAR_MAX_BYTES,
      allowedMimeTypes: Array.from(PROFILE_AVATAR_ALLOWED_MIME),
    });
    if (createErr) {
      const msg = String(createErr.message ?? "").toLowerCase();
      if (msg.includes("already exists") || msg.includes("duplicate")) return;
      throw createErr;
    }
  } catch (_err) {
    const msg = String((_err as any)?.message ?? _err ?? "").toLowerCase();
    if (msg.includes("already exists") || msg.includes("duplicate")) return;
    throw _err;
  }
}

export async function uploadProfileAvatarAction(formData: FormData) {
  const file = formData.get("avatar") as File | null;
  if (!file || !(file instanceof File)) {
    return { ok: false as const, error: "Nenhum arquivo selecionado." };
  }
  if (file.size <= 0) {
    return { ok: false as const, error: "Arquivo vazio. Escolha uma imagem válida." };
  }
  if (file.size > PROFILE_AVATAR_MAX_BYTES) {
    return {
      ok: false as const,
      error: "Arquivo muito grande. Tamanho máximo permitido: 5 MB.",
    };
  }
  const mime = String(file.type ?? "").trim().toLowerCase();
  if (!mime.startsWith("image/")) {
    return {
      ok: false as const,
      error: "Tipo de arquivo não permitido. Use uma imagem (JPG, PNG, WEBP ou GIF).",
    };
  }
  const mimeExt = getAvatarExtFromMime(mime);
  const nameExt = getAvatarExtFromName(file.name);
  const ext = mimeExt ?? nameExt;
  if (!ext) {
    return {
      ok: false as const,
      error:
        "Extensão de arquivo não permitida. Use uma imagem com extensão .jpg, .jpeg, .png, .webp ou .gif.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false as const, error: "Sem sessão." };

  await ensureProfileAvatarsBucketAdmin().catch((e) => {
    console.warn("[avatar] ensure bucket warning:", e);
  });

  const admin = createSupabaseAdminClient();
  const { data: oldProfile } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  const oldUrl = String(oldProfile?.avatar_url ?? "").trim() || null;

  const randomHex = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  const storagePath = `${userId}/avatar-${Date.now()}-${randomHex}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(arrayBuffer);
  const { error: uploadErr } = await admin.storage
    .from(PROFILE_AVATARS_BUCKET)
    .upload(storagePath, fileBytes, {
      contentType: mime || "application/octet-stream",
      cacheControl: "max-age=60, public",
      upsert: false,
    });
  if (uploadErr) {
    return { ok: false as const, error: uploadErr.message ?? "Falha ao enviar arquivo." };
  }

  const { data: urlData } = admin.storage.from(PROFILE_AVATARS_BUCKET).getPublicUrl(storagePath);
  const newPublicUrl = String(urlData?.publicUrl ?? "").trim();
  if (!newPublicUrl) {
    await admin.storage.from(PROFILE_AVATARS_BUCKET).remove([storagePath]).catch(() => {});
    return { ok: false as const, error: "Falha ao obter URL da imagem." };
  }

  const { error: updateErr } = await admin
    .from("profiles")
    .upsert({ user_id: userId, avatar_url: newPublicUrl }, { onConflict: "user_id" });
  if (updateErr) {
    await admin.storage.from(PROFILE_AVATARS_BUCKET).remove([storagePath]).catch(() => {});
    return { ok: false as const, error: updateErr.message ?? "Falha ao salvar perfil." };
  }

  if (oldUrl) {
    const parsedOld = extractAvatarStoragePathFromPublicUrl(oldUrl);
    if (parsedOld && parsedOld.bucket === PROFILE_AVATARS_BUCKET && parsedOld.path) {
      try {
        await admin.storage.from(PROFILE_AVATARS_BUCKET).remove([parsedOld.path]);
      } catch {
        /* ignore */
      }
    }
  }

  return { ok: true as const, newUrl: newPublicUrl };
}

export async function deleteProfileAvatarAction() {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false as const, error: "Sem sessão." };

  const admin = createSupabaseAdminClient();
  const { data: currentProfile } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  const oldUrl = String(currentProfile?.avatar_url ?? "").trim() || null;

  if (oldUrl) {
    const parsedOld = extractAvatarStoragePathFromPublicUrl(oldUrl);
    if (parsedOld && parsedOld.bucket === PROFILE_AVATARS_BUCKET && parsedOld.path) {
      try {
        await admin.storage.from(PROFILE_AVATARS_BUCKET).remove([parsedOld.path]);
      } catch {
        /* ignore */
      }
    }
  }

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ avatar_url: null })
    .eq("user_id", userId);
  if (updateErr) {
    return { ok: false as const, error: updateErr.message ?? "Falha ao remover foto." };
  }

  return { ok: true as const };
}
