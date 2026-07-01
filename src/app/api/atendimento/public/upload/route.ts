import {
  getAuthenticatedAtendimentoConversationAccess,
  uploadAtendimentoFileToStorage,
} from "@/lib/atendimento/server";
import { getAtendimentoMaxFileSizeBytes, getAtendimentoMediaTypeFromMimeType } from "@/lib/atendimento/files";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const formData = await req.formData().catch(() => null);
  const publicSlug = String(formData?.get("public_slug") ?? "").trim();
  const file = formData?.get("file");

  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "missing_file" }, { status: 400 });
  }

  const mediaType = getAtendimentoMediaTypeFromMimeType(file.type);
  const maxSize = getAtendimentoMaxFileSizeBytes(file.type);
  if (!mediaType || !maxSize) {
    return Response.json({ ok: false, error: "unsupported_file_type" }, { status: 400 });
  }
  if (file.size > maxSize) {
    return Response.json({ ok: false, error: "file_too_large" }, { status: 400 });
  }

  const access = await getAuthenticatedAtendimentoConversationAccess(publicSlug);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }

  try {
    const uploaded = await uploadAtendimentoFileToStorage({
      conversationId: String(access.conversation.id),
      senderRole: "lead",
      file,
    });
    return Response.json({ ok: true, file: uploaded });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "upload_failed" },
      { status: 500 },
    );
  }
}
