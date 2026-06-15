import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { nextMonthlyIso, shouldContinueMonthlyRecurrence } from "@/lib/recurrence";

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

function formatBRL(value: unknown) {
  if (value === null || value === undefined) return "";
  const n = typeof value === "number" ? value : Number(String(value));
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function formatDateBR(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
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
  client_token?: string | null;
  phone: string;
  message: string;
}) {
  const body = JSON.stringify({ phone: normalizePhone(params.phone), message: params.message });
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}`;
  const urlWithTokenInPath = `${baseUrl}/token/${encodeURIComponent(params.token)}/send-text`;
  const urlWithHeader = `${baseUrl}/send-text`;

  const trySend = async (url: string, includeHeaderToken: boolean) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(includeHeaderToken && params.client_token
          ? { "Client-Token": params.client_token }
          : {}),
      },
      body,
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  const first = await trySend(urlWithTokenInPath, Boolean(params.client_token));
  if (first.response.ok) return first.data;

  const errText = JSON.stringify(first.data ?? "");
  const mentionsClientToken = /client-token/i.test(errText);
  const isForbidden = first.response.status === 403;
  const isBadRequest = first.response.status === 400;

  if (mentionsClientToken && !params.client_token) {
    throw new Error("Client-Token não configurado no WhatsApp.");
  }

  if ((isBadRequest || isForbidden) && mentionsClientToken) {
    const second = await trySend(urlWithHeader, Boolean(params.client_token));
    if (second.response.ok) return second.data;
    throw new Error(
      `Falha ao enviar: ${second.response.status} ${JSON.stringify(second.data) ?? ""}`.trim(),
    );
  }

  throw new Error(
    `Falha ao enviar: ${first.response.status} ${JSON.stringify(first.data) ?? ""}`.trim(),
  );
}

export async function GET(req: Request) {
  const deployment = {
    env: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  };

  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized", deployment }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: schedules, error } = await supabase
    .from("schedules")
    .select(
      "id, user_id, debtor_id, template_id, data_envio, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until, debtors(nome, telefone, pix_key, valor, vencimento), message_templates(conteudo)",
    )
    .in("status", ["agendado", "pausado"])
    .lte("data_envio", nowIso)
    .order("data_envio", { ascending: true })
    .limit(100);

  if (error) {
    return Response.json({ ok: false, error: error.message, deployment }, { status: 500 });
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
        .in("status", ["agendado", "pausado"])
        .select("id")
        .maybeSingle();

      if (lockErr) throw new Error(lockErr.message);
      if (!locked?.id) {
        results.push({ id: scheduleId, ok: true });
        continue;
      }

      const { data: wa, error: waErr } = await supabase
        .from("whatsapp_instances")
        .select("instance_id, token, client_token, status")
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
        valor: formatBRL(debtor?.valor),
        vencimento: formatDateBR(debtor?.vencimento),
      });

      await sendZapiText({
        instance_id: wa.instance_id,
        token: wa.token,
        client_token: wa.client_token,
        phone: debtorPhone,
        message,
      });

      await supabase.from("logs").insert({
        user_id: userId,
        tipo: "agenda_executada",
        descricao: `Agendamento executado: ${scheduleId}`,
      });

      const recurrence = String((s as any).recurrence ?? "none");
      if (recurrence === "monthly") {
        const tz = String((s as any).schedule_timezone ?? "");
        const day = Number((s as any).recurrence_day ?? 1);
        const time = String((s as any).recurrence_time ?? "");
        const nextIso = nextMonthlyIso({
          fromUtcIso: String((s as any).data_envio),
          timeZone: tz || "America/Sao_Paulo",
          day,
          time: time || "00:00",
        });
        const shouldContinue = shouldContinueMonthlyRecurrence({
          nextUtcIso: nextIso,
          recurrenceUntil: String((s as any).recurrence_until ?? "") || null,
          timeZone: tz || "America/Sao_Paulo",
        });

        await supabase.from("schedule_runs").insert({
          user_id: userId,
          schedule_id: scheduleId,
          scheduled_for: String((s as any).data_envio),
          executed_at: nowIso,
          status: "executado",
        });

        await supabase
          .from("schedules")
          .update(shouldContinue ? { status: "agendado", data_envio: nextIso } : { status: "executado" })
          .eq("id", scheduleId);
      } else {
        await supabase.from("schedules").update({ status: "executado" }).eq("id", scheduleId);
      }

      results.push({ id: scheduleId, ok: true });
    } catch (e: any) {
      const msg = String(e?.message ?? "Erro desconhecido");
      const recurrence = String((s as any)?.recurrence ?? "none");
      if (recurrence === "monthly") {
        await supabase.from("schedule_runs").insert({
          user_id: userId,
          schedule_id: scheduleId,
          scheduled_for: String((s as any)?.data_envio ?? nowIso),
          executed_at: nowIso,
          status: "falha",
          error: msg,
        });
      }
      await supabase.from("logs").insert({
        user_id: userId,
        tipo: "agenda_falha",
        descricao: `Falha ao executar agendamento ${scheduleId}: ${msg}`,
      });
      const retryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      await supabase
        .from("schedules")
        .update({ status: "agendado", data_envio: retryAt })
        .eq("id", scheduleId);
      results.push({ id: scheduleId, ok: false, error: msg });
    }
  }

  return Response.json({
    ok: true,
    now: nowIso,
    found: schedules?.length ?? 0,
    results,
    deployment,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
