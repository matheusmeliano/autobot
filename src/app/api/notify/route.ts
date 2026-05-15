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
  try {
    const body = await req.json().catch(() => null);
    const url = body?.url as string | undefined;
    const phone = body?.phone as string | undefined;
    const token = (body?.token as string | undefined) ?? "";
    const messageText = (body?.messageText as string | undefined) ?? "Novo Lead AutoBot";

    if (!url || !phone) {
      return Response.json({ error: "URL e telefone são obrigatórios" }, { status: 400 });
    }

    const fetchUrl = url.endsWith("/send-text") ? url : `${url.replace(/\/$/, "")}/send-text`;
    const cleanPhone = phone.replace(/\D/g, "");

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
      return Response.json({ error: "Falha ao enviar mensagem", details: responseData }, { status: response.status });
    }

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    return Response.json({ error: message }, { status: 500 });
  }
}

