import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { normalizePlan } from "@/lib/plans";

export async function GET() {
  const supabaseAuth = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!isGlobalAdminEmail(user?.email)) {
    return new Response("Acesso negado.", { status: 403 });
  }

  const supabase = tryCreateSupabaseAdminClient();
  if (!supabase) {
    return new Response("Configuração do servidor incompleta.", { status: 500 });
  }

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });
  if (error) {
    return new Response(error.message, { status: 500 });
  }

  const users = data.users ?? [];
  const ids = users.map((u) => u.id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, nome, email, plano, created_at")
    .in("user_id", ids);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, user_id, plano, status, vencimento, created_at")
    .in("user_id", ids);

  const profileById = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  const subById = new Map<string, any>();
  (subs ?? []).forEach((s: any) => {
    const prev = subById.get(s.user_id);
    if (!prev || new Date(s.created_at).getTime() > new Date(prev.created_at).getTime()) {
      subById.set(s.user_id, s);
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  const expiredSubs = Array.from(subById.values()).filter((s: any) => {
    const p = profileById.get(s.user_id);
    const planSub = normalizePlan(s?.plano ?? null);
    const planProfile = normalizePlan(p?.plano ?? null);
    const status = (s?.status ?? "").toLowerCase();
    return (
      planSub === "teste" &&
      planProfile === "teste" &&
      status === "ativo" &&
      typeof s?.vencimento === "string" &&
      s.vencimento < today
    );
  });

  if (expiredSubs.length) {
    await Promise.all(
      expiredSubs.map((s: any) =>
        supabase.from("subscriptions").update({ status: "cancelado" }).eq("id", s.id),
      ),
    );
    expiredSubs.forEach((s: any) => {
      const current = subById.get(s.user_id);
      if (current?.id === s.id) {
        subById.set(s.user_id, { ...current, status: "cancelado" });
      }
    });
  }

  const rows = users.map((u) => {
    const p = profileById.get(u.id);
    const s = subById.get(u.id);
    return {
      id: u.id,
      email: u.email ?? p?.email ?? "-",
      nome: p?.nome ?? (u.user_metadata as any)?.name ?? "-",
      email_confirmado: Boolean((u as any).email_confirmed_at),
      plano: normalizePlan(s?.plano ?? p?.plano ?? "teste"),
      assinatura_status: s?.status ?? "-",
      vencimento: s?.vencimento ?? null,
      criado_em: u.created_at ?? p?.created_at ?? null,
    };
  });

  return Response.json(rows);
}
