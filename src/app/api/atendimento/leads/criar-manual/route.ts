import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { ensureAtendimentoPublicLink, findLeadByPhone } from "@/lib/atendimento/server";
import { makeConversationSessionSlug } from "@/lib/atendimento/utils";
import { ATENDIMENTO_EMAIL } from "@/lib/atendimento/constants";

function normalizePhoneDigitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function isValidWhatsAppUserPhone(digitsOnly: string): boolean {
  const d = String(digitsOnly ?? "").replace(/\D/g, "");
  if (!d) return false;
  if (!/^\d+$/.test(d)) return false;
  if (d.length < 10) return false;
  if (d.length > 15) return false;
  if (/^0+$/.test(d)) return false;
  return true;
}

export async function POST(req: Request) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const phoneRaw = String(body?.phone ?? "").trim();
  const normalizedPhone = normalizePhoneDigitsOnly(phoneRaw);

  if (!isValidWhatsAppUserPhone(normalizedPhone)) {
    return Response.json(
      { ok: false, error: "Telefone inválido. Informe um número com DDD (ex: 556599851142)." },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  const existingLead = await findLeadByPhone({
    phone: normalizedPhone,
    userId: auth.user?.id ?? null,
  });

  if (existingLead?.id) {
    return Response.json(
      { ok: false, error: "Já existe um interessado cadastrado com este número." },
      { status: 409 },
    );
  }

  const publicLink = await ensureAtendimentoPublicLink();

  const { data: createdLead, error: leadError } = await admin
    .from("atendimento_leads")
    .insert({
      phone: normalizedPhone,
      origin: "painel_manual",
      status: "aguardando_nome",
      funnel_stage: "aula_experimental_antecipada",
      assigned_user_email: ATENDIMENTO_EMAIL,
      unread_count: 0,
      is_new_for_attendant: true,
    })
    .select("*")
    .maybeSingle();

  if (leadError || !createdLead?.id) {
    return Response.json(
      { ok: false, error: leadError?.message ?? "Não foi possível cadastrar o número." },
      { status: 500 },
    );
  }

  await admin
    .from("atendimento_conversations")
    .insert({
      lead_id: String(createdLead.id),
      public_link_id: String(publicLink?.id ?? ""),
      channel: "whatsapp",
      public_slug: makeConversationSessionSlug(),
      bot_enabled: true,
    })
    .select("*")
    .maybeSingle();

  return Response.json({ ok: true, lead: createdLead });
}
