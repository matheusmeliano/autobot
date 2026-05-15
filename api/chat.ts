import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'A chave da API da OpenAI não está configurada no servidor.' });
  }

  try {
    const openai = new OpenAI({ apiKey });
    const { messages, leadData } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Formato de mensagens inválido.' });
    }

    const systemPrompt = `Você é o AutoBot, um assistente virtual super simpático, empático e humanizado da escola de música do Prof. Lucas Brum.
Sua missão é conduzir uma conversa natural para entender o perfil do aluno e coletar as seguintes informações de forma fluida:
1. Nome
2. Telefone WhatsApp (com DDD)
3. Objetivo principal na música
4. Preferência de estudo (flexível/próprio ritmo OU acompanhamento próximo) e disponibilidade de tempo/dias.

Dados já coletados até agora (use como contexto):
- Nome: ${leadData?.nome || 'Pendente'}
- Telefone: ${leadData?.telefone || 'Pendente'}
- Objetivo: ${leadData?.objetivo || 'Pendente'}
- Flexibilidade/Tempo: ${leadData?.flexibilidade || 'Pendente'}

DIRETRIZES DE CONVERSA:
- Adapte-se ao usuário. Se ele responder algo aleatório, sem sentido ou brincadeiras (ex: "wefwef", "batata", "nada"), seja inteligente: faça uma brincadeira leve, seja empático, mas guie-o de volta para a pergunta que você precisa que ele responda. Não siga um roteiro cego.
- Faça UMA pergunta por vez de forma leve. Não pareça um robô de formulário.
- Mantenha a conversa fluida, curta e direta.

QUANDO TODAS AS INFORMAÇÕES FOREM COLETADAS (Nome, Telefone, Objetivo e Flexibilidade/Tempo):
- Identifique e recomende o modelo de aula ideal com base na flexibilidade e rotina do usuário.
- Se o usuário precisa de flexibilidade de horários ou tem rotina corrida, recomende o MODELO HÍBRIDO exatamente assim:
  "Com base nas suas respostas, o MODELO HÍBRIDO é o ideal para você!
  ✅ Ideal para quem quer flexibilidade e tem rotina corrida.
  ✅ Inclui aula introdutória, 4 aulas gravadas (1 por semana) e 1 aula online ao vivo mensal.
  ✅ Formato escalável para estudar no seu próprio ritmo."
- Se o usuário quer acompanhamento próximo e evolução rápida, recomende o MODELO INDIVIDUAL exatamente assim:
  "Com base nas suas respostas, o MODELO INDIVIDUAL é o ideal para você!
  ✅ Ideal para quem quer acompanhamento próximo e evolução rápida.
  ✅ Inclui 1 aula online ao vivo por semana.
  ✅ Ensino totalmente personalizado e acompanhamento contínuo."
- No final da recomendação (na mesma mensagem), adicione algo como:
  "Agora é só aguardar 😊 O Prof. Lucas Brum entrará em contato com você em breve pelo WhatsApp para dar continuidade ao seu atendimento." (Pode adaptar essa última frase para ficar natural).
- Quando enviar essa mensagem final, você OBRIGATORIAMENTE deve definir "isFinished": true no JSON.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON):
Você DEVE responder APENAS com um objeto JSON válido (sem blocos de código markdown), com a exata seguinte estrutura:
{
  "reply": "Sua mensagem humanizada para o usuário",
  "extractedData": {
    "nome": "nome extraído da conversa ou string vazia",
    "telefone": "telefone extraído da conversa ou string vazia",
    "objetivo": "objetivo extraído da conversa ou string vazia",
    "flexibilidade": "resumo da flexibilidade/tempo ou string vazia"
  },
  "isFinished": true ou false // true APENAS na mensagem final de recomendação
}`;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.sender === 'bot' ? 'assistant' : 'user',
        content: m.text
      }))
    ];

    const completion = await openai.chat.completions.create({
      messages: apiMessages as any,
      model: 'gpt-3.5-turbo-1106', // Modelo que suporta JSON mode confiavelmente
      temperature: 0.5, // Mais baixo para seguir mais à risca as formatações finais
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0].message.content;
    const result = JSON.parse(content || '{}');
    
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Erro na API Chat:', error);
    return res.status(500).json({ error: error.message });
  }
}
