import { headers } from "next/headers";
import { ensureAtendimentoPublicLink, requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET() {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const link = await ensureAtendimentoPublicLink(`${proto}://${host}`);

  return Response.json({
    ok: true,
    link: {
      slug: String((link as any)?.slug ?? ""),
      label: String((link as any)?.label ?? "Link principal de atendimento"),
      public_url: String((link as any)?.public_url ?? ""),
    },
  });
}
