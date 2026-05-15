import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

type LeadData = {
  nome?: string;
  telefone?: string;
  objetivo?: string;
  flexibilidade?: string;
};

type IncomingMessage = {
  sender: "bot" | "user";
  text: string;
};

type Payload = {
  messages: IncomingMessage[];
  leadData?: LeadData;
};

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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "OPENAI_API_KEY não configurada" }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body?.messages || !Array.isArray(body.messages)) {
      return Response.json({ error: "Mensagens não encontradas" }, { status: 400 });
    }

    const leadData = body.leadData ?? {};

    const systemPrompt = `Você é o AutoBot, um assistente virtual amigável e persuasivo especializado em captar e qualificar leads interessados em aulas de música.

Siga estritamente estas regras:
1. Você deve sempre retornar um JSON válido (sem texto fora do JSON)
2. Use as mensagens anteriores para manter o contexto
3. Faça perguntas curtas e diretas, uma por vez
4. Colete nesta ordem:
   - nome (pergunte se ainda não tiver)
   - telefone WhatsApp (pergunte se ainda não tiver)
   - objetivo na música (ex: aprender do zero, tocar na igreja, tocar com banda, hobby etc)
   - flexibilidade de horário (se pode fazer aulas híbridas/flexíveis ou prefere horário fixo)
5. Quando tiver coletado todos os dados, finalize com uma mensagem de agradecimento e diga que em breve alguém entrará em contato.

O JSON deve ter este formato:
{
  "reply": "texto da resposta do bot",
  "extractedData": {
    "nome": "string ou vazio",
    "telefone": "string ou vazio",
    "objetivo": "string ou vazio",
    "flexibilidade": "string ou vazio"
  },
  "isFinished": boolean
}

Dados já coletados:
nome: ${leadData.nome || ""}
telefone: ${leadData.telefone || ""}
objetivo: ${leadData.objetivo || ""}
flexibilidade: ${leadData.flexibilidade || ""}
`;

    const openai = new OpenAI({ apiKey });
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...body.messages.map(
        (m): ChatCompletionMessageParam => ({
          role: m.sender === "bot" ? "assistant" : "user",
          content: m.text,
        }),
      ),
    ];
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    const content = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);

    return new Response(JSON.stringify(parsed), {
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

