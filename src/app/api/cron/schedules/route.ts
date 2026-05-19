import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function normalizePhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length === 11) return `55${d}`;
  return d;
}

function applyTemplate(text: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), text);
}

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return q === secret || bearer === secret;
}

async function sendZapiText(params: {
  instance_id: string;
  token: string;
  phone: string;
  message: string;
}) {
  const url = `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}/token/${encodeURIComponent(params.token)}/send-text`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: normalizePhone(params.phone), message: params.message }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Falha ao enviar: ${response.status} ${JSON.stringify(data) ?? ""}`.trim(),
    );
  }
  return data;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: schedules, error } = await supabase
    .from("schedules")
    .select(
      "id, user_id, debtor_id, template_id, data_envio, status, debtors(nome, telefone, pix_key), message_templates(conteudo)",
    )
    .eq("status", "agendado")
    .lte("data_envio", nowIso)
    .order("data_envio", { ascending: true })
    .limit(100);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const s of schedules ?? []) {
    const scheduleId = String((s as any).id);
    const userId = String((s as any).user_id);

    try {
      const debtor = (s as any).debtors ?? null;
      const template = (s as any).message_templates ?? null;

      const debtorPhone = String(debtor?.telefone ?? "");
      const templateText = String(template?.conteudo ?? "");

      if (!debtorPhone) throw new Error("Cliente sem telefone");
      if (!templateText) throw new Error("Template sem conteúdo");

      const { data: locked, error: lockErr } = await supabase
        .from("schedules")
        .update({ status: "executando" })
        .eq("id", scheduleId)
        .eq("status", "agendado")
        .select("id")
        .maybeSingle();

      if (lockErr) throw new Error(lockErr.message);
      if (!locked?.id) {
        results.push({ id: scheduleId, ok: true });
        continue;
      }

      const { data: wa, error: waErr } = await supabase
        .from("whatsapp_instances")
        .select("instance_id, token, status")
        .eq("user_id", userId)
        .maybeSingle();

      if (waErr) throw new Error(waErr.message);
      if (!wa?.instance_id || !wa?.token) throw new Error("WhatsApp não configurado");
      if ((wa.status ?? "").toLowerCase() !== "configured" && (wa.status ?? "").toLowerCase() !== "connected") {
        throw new Error("WhatsApp desconectado");
      }

      const message = applyTemplate(templateText, {
        nome: String(debtor?.nome ?? ""),
        pix: String(debtor?.pix_key ?? ""),
      });

      await sendZapiText({
        instance_id: wa.instance_id,
        token: wa.token,
        phone: debtorPhone,
        message,
      });

      await supabase.from("logs").insert({
        user_id: userId,
        tipo: "agenda_executada",
        descricao: `Agendamento executado: ${scheduleId}`,
      });

      await supabase.from("schedules").update({ status: "executado" }).eq("id", scheduleId);

      results.push({ id: scheduleId, ok: true });
    } catch (e: any) {
      const msg = String(e?.message ?? "Erro desconhecido");
      await supabase.from("logs").insert({
        user_id: userId,
        tipo: "agenda_falha",
        descricao: `Falha ao executar agendamento ${scheduleId}: ${msg}`,
      });
      await supabase.from("schedules").update({ status: "pausado" }).eq("id", scheduleId);
      results.push({ id: scheduleId, ok: false, error: msg });
    }
  }

  return Response.json({ ok: true, now: nowIso, found: schedules?.length ?? 0, results });
}

export async function POST(req: Request) {
  return GET(req);
}

