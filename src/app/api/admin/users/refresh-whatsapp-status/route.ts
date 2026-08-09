import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { refreshOneWhatsAppInstanceStatusLive } from "@/lib/atendimento/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await createSupabaseServerClient({ canSetCookies: true });
  const { data: { user }, error: userErr } = await auth.auth.getUser();
  if (userErr || !user || !isGlobalAdminEmail(user.email)) {
    return Response.json({ ok: false, error: "Acesso negado." }, { status: 403 });
  }
  const supabase = tryCreateSupabaseAdminClient();
  if (!supabase) {
    return Response.json({ ok: false, error: "Configuração admin incompleta." }, { status: 500 });
  }
  const db = supabase as NonNullable<typeof supabase>;

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {}
  const userIdParam = String(body?.user_id ?? "").trim();
  const all = Boolean(body?.all) === true;

  const baseCols = ["user_id", "instance_id", "token", "client_token", "status"] as const;

  async function refreshSingle(uid: string) {
    if (!uid) return { user_id: uid, status: null, ok: false, error: "missing user_id" };
    const row = await db
      .from("whatsapp_instances")
      .select(baseCols.join(", "))
      .eq("user_id", uid)
      .maybeSingle();
    const missClient =
      row.error &&
      /column/i.test(String(row.error.message ?? "")) &&
      /client_token/i.test(String(row.error.message ?? ""));
    let r: any = row.data;
    if (missClient) {
      const r2 = await db
        .from("whatsapp_instances")
        .select(["user_id", "instance_id", "token", "status"].join(", "))
        .eq("user_id", uid)
        .maybeSingle();
      r = { client_token: null, ...((r2.data ?? {}) as Record<string, unknown>) };
      if (r2.error) {
        return { user_id: uid, status: null, ok: false, error: r2.error.message };
      }
    } else if (row.error) {
      return { user_id: uid, status: null, ok: false, error: row.error.message };
    }
    if (!r) return { user_id: uid, status: "disconnected", ok: true, reason: "no_instance" };
    const st = await refreshOneWhatsAppInstanceStatusLive({
      supabase: db,
      row: {
        user_id: uid,
        instance_id: String(r.instance_id ?? "").trim() || null,
        token: String(r.token ?? "").trim() || null,
        client_token: String(r.client_token ?? "").trim() || null,
        status: String(r.status ?? "").trim() || null,
      },
      filterMode: "by_user_id",
      stickyConnected: true,
    });
    return { user_id: uid, status: st ?? "disconnected", ok: true };
  }

  if (userIdParam) {
    const r = await refreshSingle(userIdParam);
    return Response.json({ ok: true, result: r });
  }

  if (all) {
    const list = await db
      .from("whatsapp_instances")
      .select(baseCols.join(", "));
    const missClient =
      list.error &&
      /column/i.test(String(list.error.message ?? "")) &&
      /client_token/i.test(String(list.error.message ?? ""));
    let rows: any[] = [];
    if (missClient) {
      const r2 = await db
        .from("whatsapp_instances")
        .select(["user_id", "instance_id", "token", "status"].join(", "));
      rows = (r2.data ?? [] as any[]).map((r: any) => ({
        client_token: null,
        ...(r as Record<string, unknown>),
      }));
      if (r2.error) {
        return Response.json({ ok: false, error: r2.error.message }, { status: 500 });
      }
    } else if (list.error) {
      return Response.json({ ok: false, error: list.error.message }, { status: 500 });
    } else {
      rows = list.data ?? [];
    }

    const results = await Promise.all(
      rows.map((r) =>
        refreshOneWhatsAppInstanceStatusLive({
          supabase: db,
          row: {
            user_id: String(r.user_id ?? ""),
            instance_id: String(r.instance_id ?? "").trim() || null,
            token: String(r.token ?? "").trim() || null,
            client_token: String(r.client_token ?? "").trim() || null,
            status: String(r.status ?? "").trim() || null,
          },
          filterMode: "by_user_id",
          stickyConnected: true,
        }).then((status) => ({
          user_id: String(r.user_id ?? ""),
          status: status ?? "disconnected",
          ok: true,
        })),
      ),
    );
    return Response.json({ ok: true, results });
  }

  return Response.json(
    { ok: false, error: "Informe user_id (no body JSON user_id) ou all: true" },
    { status: 400 },
  );
}
