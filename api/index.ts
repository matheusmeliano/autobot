import { VercelRequest, VercelResponse } from '@vercel/node';

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

  try {
    const { url } = req.body;
    
    if (!url || !url.includes('api.callmebot.com')) {
      return res.status(400).json({ error: 'Invalid CallMeBot URL' });
    }

    // A URL original do banco de dados vem com o &text=This+is+a+Test.
    // O Chat.tsx adiciona um novo parâmetro 'text', mas como já existe um na string original,
    // pode estar gerando duplicação e o CallMeBot está pegando o primeiro (This is a Test).
    // Precisamos limpar a URL original ou garantir que usamos os dados corretos
    const parsedOriginalUrl = new URL(url);
    const { messageText } = req.body; // Recebemos o texto explicitamente agora

    if (messageText) {
      parsedOriginalUrl.searchParams.set('text', messageText);
    }

    const finalUrlToFetch = parsedOriginalUrl.toString();
    console.log('Enviando para CallMeBot:', finalUrlToFetch);

    const response = await fetch(finalUrlToFetch);
    const text = await response.text();

    console.log('Resposta CallMeBot:', text);

    if (!response.ok) {
      throw new Error(`CallMeBot erro: ${text}`);
    }

    return res.status(200).json({ success: true, text });
  } catch (error: any) {
    console.error('Erro na API:', error);
    return res.status(500).json({ error: error.message });
  }
}
