import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createMercadoPagoPixPayment } from "@/lib/mercadopago";

export const runtime = "nodejs";

const schema = z.object({
  plan: z.enum(["basico", "pro"]),
});

const planAmount: Record<"basico" | "pro", number> = {
  basico: 49,
  pro: 99,
};

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Sem sessão." }, { status: 401 });
  }

  const reqUrl = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? reqUrl.origin;
  const notificationUrl = `${origin}/api/webhooks/mercadopago`;

  const amount = planAmount[parsed.data.plan];
  const payment = await createMercadoPagoPixPayment({
    amount,
    payerEmail: user.email,
    description:
      parsed.data.plan === "basico" ? "Plano Básico - AutoBot (PIX)" : "Plano Pro - AutoBot (PIX)",
    notificationUrl,
    externalReference: `${user.id}:${parsed.data.plan}`,
    metadata: {
      user_id: user.id,
      plan_slug: parsed.data.plan,
    },
  });

  const tx = payment.point_of_interaction?.transaction_data ?? null;
  return NextResponse.json({
    ok: true,
    id: String(payment.id),
    status: payment.status ?? null,
    qr_code: tx?.qr_code ?? null,
    qr_code_base64: tx?.qr_code_base64 ?? null,
    ticket_url: tx?.ticket_url ?? null,
  });
}

