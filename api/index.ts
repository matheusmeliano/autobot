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

    console.log('Enviando para CallMeBot:', url);

    const response = await fetch(url);
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
