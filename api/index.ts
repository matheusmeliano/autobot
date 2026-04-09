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

    // O CallMeBot pode falhar se passarmos caracteres que ele não espera ou URLs não encodadas corretamente.
    // Precisamos limpar a URL original ou garantir que usamos os dados corretos
    const parsedOriginalUrl = new URL(url);
    const { messageText } = req.body; // Recebemos o texto explicitamente agora

    if (messageText) {
      // Em vez de deixar o objeto URL encodar (o que pode bugar o formato pro CallMeBot),
      // forçamos o encodeURIComponent manualmente
      parsedOriginalUrl.searchParams.set('text', encodeURIComponent(messageText));
    }

    // Algumas implementações do `URL.toString()` encodam duplamente se já fizermos o `encodeURIComponent`.
    // O CallMeBot é muito chato com isso. A forma mais segura é extrair os componentes
    const phone = parsedOriginalUrl.searchParams.get('phone');
    const apikey = parsedOriginalUrl.searchParams.get('apikey');
    
    if (!phone || !apikey) {
      return res.status(400).json({ error: 'URL do CallMeBot incompleta (falta phone ou apikey)' });
    }

    // O CallMeBot espera os espaços como `+` ou `%20`.
    // Vamos encodar o texto inteiro com encodeURIComponent, que converte os espaços em %20.
    // Isso é o padrão universal para URLs.
    const encodedText = encodeURIComponent(messageText || 'Novo Lead WeBooter');
    
    // Montando a URL exata do jeito que o CallMeBot quer:
    // https://api.callmebot.com/whatsapp.php?phone=XXXXX&text=YYYYY&apikey=ZZZZZ
    const finalUrlToFetch = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedText}&apikey=${apikey}`;

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
