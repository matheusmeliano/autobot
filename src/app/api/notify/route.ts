import fs from "node:fs";

// #region debug-point extra-send-notify-bootstrap
const __dbgEnvPath = ".dbg/extra-scheduled-send.env";
const __dbgEnvRaw = fs.existsSync(__dbgEnvPath) ? fs.readFileSync(__dbgEnvPath, "utf8") : "";
const __dbgMap = Object.fromEntries(
  __dbgEnvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, ""];
    }),
);
const __dbgUrl = __dbgMap.DEBUG_SERVER_URL;
const __dbgSession = __dbgMap.DEBUG_SESSION_ID;
const __dbg = (traceId: string, hypothesisId: string, msg: string, data: Record<string, unknown>) => {
  if (!__dbgUrl || !__dbgSession) return;
  fetch(__dbgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: __dbgSession,
      runId: "pre",
      hypothesisId,
      traceId,
      location: "api/notify",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(req: Request) {
  const __dbgTraceId = `notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const body = await req.json().catch(() => null);
    const url = body?.url as string | undefined;
    const phone = body?.phone as string | undefined;
    const token = (body?.token as string | undefined) ?? "";
    const messageText = (body?.messageText as string | undefined) ?? "Novo Lead AutoBot";

    if (!url || !phone) {
      // #region debug-point extra-send-notify-invalid
      __dbg(__dbgTraceId, "A", "notify-invalid-payload", {
        hasUrl: Boolean(url),
        hasPhone: Boolean(phone),
      });
      // #endregion
      return Response.json({ error: "URL e telefone são obrigatórios" }, { status: 400 });
    }

    const fetchUrl = url.endsWith("/send-text") ? url : `${url.replace(/\/$/, "")}/send-text`;
    const cleanPhone = phone.replace(/\D/g, "");

    // #region debug-point extra-send-notify-before-send
    __dbg(__dbgTraceId, "A", "notify-before-send", {
      fetchUrl,
      phone: cleanPhone,
      messagePreview: messageText.slice(0, 120),
    });
    // #endregion

    const response = await fetch(fetchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Client-Token": token } : {}),
      },
      body: JSON.stringify({ phone: cleanPhone, message: messageText }),
    });

    const responseData = await response.json().catch(() => null);

    if (!response.ok) {
      // #region debug-point extra-send-notify-error
      __dbg(__dbgTraceId, "A", "notify-send-error", {
        fetchUrl,
        phone: cleanPhone,
        status: response.status,
        responseData,
      });
      // #endregion
      return Response.json({ error: "Falha ao enviar mensagem", details: responseData }, { status: response.status });
    }

    // #region debug-point extra-send-notify-success
    __dbg(__dbgTraceId, "A", "notify-send-success", {
      fetchUrl,
      phone: cleanPhone,
      status: response.status,
      responseData,
    });
    // #endregion

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    const message = err?.message ?? "Erro interno";
    // #region debug-point extra-send-notify-exception
    __dbg(__dbgTraceId, "A", "notify-exception", { error: message });
    // #endregion
    return Response.json({ error: message }, { status: 500 });
  }
}
