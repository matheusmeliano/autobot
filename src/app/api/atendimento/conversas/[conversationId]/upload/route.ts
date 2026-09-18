import {
  getAtendimentoConversationAccessForAttendant,
  uploadAtendimentoFileToStorage,
} from "@/lib/atendimento/server";
import { getAtendimentoMaxFileSizeBytes, getAtendimentoMediaTypeFromMimeType } from "@/lib/atendimento/files";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, context: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await context.params;
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");

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

  const access = await getAtendimentoConversationAccessForAttendant(conversationId);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }

  try {
    const uploaded = await uploadAtendimentoFileToStorage({
      conversationId,
      senderRole: "attendant",
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
