import { getAtendimentoLeadFiles, requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET(_req: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
  const files = await getAtendimentoLeadFiles(leadId);
  return Response.json({ ok: true, files });
}
