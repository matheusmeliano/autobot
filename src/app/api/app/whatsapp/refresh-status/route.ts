import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refreshOneWhatsAppInstanceStatusLive } from "@/lib/atendimento/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return Response.json({ ok: false, error: "Sem sessão." }, { status: 401 });
  }
  const userId = user.id;

  const baseCols = ["instance_id", "token", "client_token", "status", "user_id"] as const;
  const try1 = await supabase
    .from("whatsapp_instances")
    .select(baseCols.join(", "))
    .eq("user_id", userId)
    .maybeSingle();

  let row: any = try1.data;
  let errObj: any = try1.error;
  if (errObj) {
    const msg = String(errObj.message ?? "");
    if (/column/i.test(msg) && /client_token/i.test(msg)) {
      const try2 = await supabase
        .from("whatsapp_instances")
        .select(["instance_id", "token", "status", "user_id"].join(", "))
        .eq("user_id", userId)
        .maybeSingle();
      row = { client_token: null, ...(try2.data ?? {}) };
      errObj = try2.error;
    }
    if (errObj) {
      return Response.json({ ok: false, error: errObj.message }, { status: 500 });
    }
  }

  if (!row) {
    return Response.json({
      ok: true,
      status: "disconnected",
      reason: "no_instance_configured",
    });
  }

  const nextStatus = await refreshOneWhatsAppInstanceStatusLive({
    supabase,
    row: {
      user_id: userId,
      instance_id: String(row.instance_id ?? "").trim() || null,
      token: String(row.token ?? "").trim() || null,
      client_token: String(row.client_token ?? "").trim() || null,
      status: String(row.status ?? "").trim() || null,
    },
    filterMode: "by_user_id",
  });

  return Response.json({
    ok: true,
    status: nextStatus ?? "disconnected",
  });
}
