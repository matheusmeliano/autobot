import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATENDIMENTO_EMAIL, ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";
import { initialBotMessages } from "@/lib/atendimento/bot";
import { buildAtendimentoPublicUrl, isAtendimentoEmail, makeConversationSessionSlug, summarizePreview } from "@/lib/atendimento/utils";
import { normalizeAccessScope } from "@/lib/auth/access";

export async function requireAtendimentoUser() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !isAtendimentoEmail(user.email)) {
    return { ok: false as const, supabase, user: null };
  }
  return { ok: true as const, supabase, user };
}

export async function requireAuthenticatedAtendimentoParticipant() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return { ok: false as const, supabase, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, email, created_at, access_scope")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    ok: true as const,
    supabase,
    user,
    profile: {
      nome: String((profile as any)?.nome ?? "").trim() || null,
      email: String((profile as any)?.email ?? user.email ?? "").trim().toLowerCase() || null,
      created_at: String((profile as any)?.created_at ?? "").trim() || null,
      access_scope: normalizeAccessScope((profile as any)?.access_scope),
    },
  };
}

export async function ensureAtendimentoPublicLink(origin?: string) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("atendimento_public_links")
    .select("id, slug, label, active, assigned_user_email")
    .eq("slug", ATENDIMENTO_PUBLIC_LINK_SLUG)
    .maybeSingle();

  if (existing?.id) {
    return {
      ...(existing as any),
      public_url: origin ? buildAtendimentoPublicUrl(origin) : null,
    };
  }

  const { data } = await admin
    .from("atendimento_public_links")
    .insert({
      slug: ATENDIMENTO_PUBLIC_LINK_SLUG,
      label: "Link principal de atendimento",
      active: true,
      assigned_user_email: ATENDIMENTO_EMAIL,
    })
    .select("id, slug, label, active, assigned_user_email")
    .maybeSingle();

  return {
    ...(data as any),
    public_url: origin ? buildAtendimentoPublicUrl(origin) : null,
  };
}

export async function createPublicLeadSession(params: { origin?: string | null; slug?: string | null }) {
  const admin = createSupabaseAdminClient();
  const publicLink = await ensureAtendimentoPublicLink(params.origin || undefined);
  const publicSlug = String(params.slug ?? "").trim() || String(publicLink.slug ?? "");
  if (!publicSlug || publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
    throw new Error("Link de atendimento inválido.");
  }

  const { data: lead } = await admin
    .from("atendimento_leads")
    .insert({
      origin: "link_publico_atendimento",
      status: "novo_lead",
      funnel_stage: "novo_lead",
      assigned_user_email: ATENDIMENTO_EMAIL,
      unread_count: 0,
    })
    .select("*")
    .maybeSingle();

  if (!lead?.id) {
    throw new Error("Não foi possível criar o lead.");
  }

  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .insert({
      lead_id: String(lead.id),
      public_link_id: String(publicLink.id ?? ""),
      channel: "web",
      public_slug: makeConversationSessionSlug(),
      bot_enabled: true,
    })
    .select("*")
    .maybeSingle();

  if (!conversation?.id) {
    throw new Error("Não foi possível criar a conversa.");
  }

  return {
    lead,
    conversation,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

async function findExistingLeadForAuthenticatedUser(params: {
  userId: string;
  email: string | null;
}) {
  const admin = createSupabaseAdminClient();

  const { data: byUser } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("auth_user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUser?.id) return byUser;

  if (!params.email) return null;

  const { data: byEmail } = await admin
    .from("atendimento_leads")
    .select("*")
    .ilike("email", params.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!byEmail?.id) return null;

  await admin
    .from("atendimento_leads")
    .update({
      auth_user_id: params.userId,
      email: params.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(byEmail.id));

  return {
    ...byEmail,
    auth_user_id: params.userId,
    email: params.email,
  };
}

export async function ensureAtendimentoLeadForAuthenticatedUser(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = String(params.email ?? "").trim().toLowerCase() || null;
  const normalizedName = String(params.name ?? "").trim() || null;
  let lead = await findExistingLeadForAuthenticatedUser({
    userId: params.userId,
    email: normalizedEmail,
  });

  if (!lead?.id) {
    const { data: createdLead } = await admin
      .from("atendimento_leads")
      .insert({
        auth_user_id: params.userId,
        full_name: normalizedName,
        email: normalizedEmail,
        origin: "link_publico_atendimento",
        status: "novo_lead",
        funnel_stage: "novo_lead",
        assigned_user_email: ATENDIMENTO_EMAIL,
        unread_count: 0,
      })
      .select("*")
      .maybeSingle();

    lead = createdLead;
  } else {
    const nextLeadPatch: Record<string, unknown> = {
      auth_user_id: params.userId,
      updated_at: new Date().toISOString(),
    };
    if (normalizedEmail && !String((lead as any)?.email ?? "").trim()) nextLeadPatch.email = normalizedEmail;
    if (normalizedName && !String((lead as any)?.full_name ?? "").trim()) nextLeadPatch.full_name = normalizedName;

    const shouldUpdateLead = Object.keys(nextLeadPatch).some((key) => key !== "updated_at");
    if (shouldUpdateLead) {
      const { data: refreshedLead } = await admin
        .from("atendimento_leads")
        .update(nextLeadPatch)
        .eq("id", String((lead as any).id))
        .select("*")
        .maybeSingle();
      if (refreshedLead?.id) lead = refreshedLead;
    }
  }

  if (!lead?.id) {
    throw new Error("Não foi possível preparar o seu atendimento.");
  }

  return lead;
}

export async function createAuthenticatedLeadSession(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
  origin?: string | null;
  slug?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const publicLink = await ensureAtendimentoPublicLink(params.origin || undefined);
  const publicSlug = String(params.slug ?? "").trim() || String(publicLink.slug ?? "");
  if (!publicSlug || publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
    throw new Error("Link de atendimento inválido.");
  }

  const lead = await ensureAtendimentoLeadForAuthenticatedUser({
    userId: params.userId,
    email: params.email,
    name: params.name,
  });

  const { data: existingConversation } = await admin
    .from("atendimento_conversations")
    .select("*")
    .eq("lead_id", String(lead.id))
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let conversation = existingConversation;
  if (!conversation?.id) {
    const { data: createdConversation } = await admin
      .from("atendimento_conversations")
      .insert({
        lead_id: String(lead.id),
        public_link_id: String(publicLink.id ?? ""),
        channel: "web",
        public_slug: makeConversationSessionSlug(),
        bot_enabled: true,
      })
      .select("*")
      .maybeSingle();
    conversation = createdConversation;
  }

  if (!conversation?.id) {
    throw new Error("Não foi possível preparar a sua conversa.");
  }

  return {
    lead,
    conversation,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

export async function ensureInitialBotConversationFlow(params: {
  leadId: string;
  conversationId: string;
}) {
  const admin = createSupabaseAdminClient();
  const { count: leadCount, error: leadCountError } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "lead");

  if (leadCountError) {
    throw new Error(leadCountError.message || "Falha ao verificar mensagens do lead.");
  }
  if (Number(leadCount ?? 0) > 0) {
    return false;
  }

  const { count: botCount, error: botCountError } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot");

  if (botCountError) {
    throw new Error(botCountError.message || "Falha ao verificar mensagens iniciais.");
  }

  const initialMessages = initialBotMessages();
  const botCountNum = Number(botCount ?? 0);
  if (botCountNum >= initialMessages.length) {
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.floor(Math.random() * 501)));
  const nowIso = new Date().toISOString();
  const nextContent = String(initialMessages[botCountNum] ?? "").trim();
  if (!nextContent) return false;

  const { data: inserted, error: insertError } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: params.conversationId,
      sender_role: "bot",
      content_text: nextContent,
      media_type: "text",
      status: "lida",
      sent_at: nowIso,
      delivered_at: nowIso,
      read_at: nowIso,
    })
    .select("content_text")
    .maybeSingle();

  if (insertError) {
    throw new Error(insertError.message || "Falha ao iniciar fluxo do bot.");
  }

  if (botCountNum + 1 >= initialMessages.length) {
    await admin
      .from("atendimento_leads")
      .update({
        status: "em_atendimento",
        funnel_stage: "aula_experimental_convidada",
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", params.leadId);

    await appendHistoryEvent({
      leadId: params.leadId,
      conversationId: params.conversationId,
      eventType: "stage_changed",
      title: "Fluxo inicial do bot iniciado",
      details: { funnel_stage: "aula_experimental_convidada" },
      actorType: "bot",
    });
  }

  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: String(inserted?.content_text ?? nextContent),
    createdAt: nowIso,
  });

  return true;
}

export async function syncConversationPreview(params: {
  conversationId: string;
  contentText?: string | null;
  createdAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("atendimento_conversations")
    .update({
      last_message_preview: summarizePreview(params.contentText ?? ""),
      last_message_at: params.createdAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId);
}

export async function appendHistoryEvent(params: {
  leadId: string;
  conversationId?: string | null;
  eventType: string;
  title: string;
  details?: Record<string, unknown> | null;
  actorType: "bot" | "lead" | "attendant" | "system";
  actorEmail?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin.from("atendimento_history_events").insert({
    lead_id: params.leadId,
    conversation_id: params.conversationId ?? null,
    event_type: params.eventType,
    title: params.title,
    details: params.details ?? null,
    actor_type: params.actorType,
    actor_email: params.actorEmail ?? null,
  });
}
