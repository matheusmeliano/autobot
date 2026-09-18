import {
  createAuthenticatedLeadSession,
  getAtendimentoLeadFiles,
  requireAuthenticatedAtendimentoParticipant,
} from "@/lib/atendimento/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = String(searchParams.get("slug") ?? "").trim() || null;
  const auth = await requireAuthenticatedAtendimentoParticipant();
  if (!auth.ok || !auth.user?.id) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const session = await createAuthenticatedLeadSession({
    userId: auth.user.id,
    email: auth.profile?.email ?? auth.user.email ?? null,
    name: auth.profile?.nome ?? null,
    slug,
  });
  const files = await getAtendimentoLeadFiles(String(session.lead.id));
  return Response.json({ ok: true, files });
}
