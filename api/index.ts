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
    const { url, token, phone, messageText } = req.body;
    
    if (!url || !phone) {
      return res.status(400).json({ error: 'Parâmetros da Z-API incompletos (Falta URL ou Telefone).' });
    }

    // A Z-API requer que o endpoint de envio de texto seja chamado
    let fetchUrl = url;
    if (!fetchUrl.endsWith('/send-text')) {
      fetchUrl = fetchUrl.replace(/\/$/, '') + '/send-text';
    }

    console.log('Enviando para Z-API:', fetchUrl);

    const headers: any = {
      'Content-Type': 'application/json'
    };

    // Só envia o Client-Token se o usuário tiver preenchido (é opcional na maioria das contas)
    if (token && token.trim() !== '') {
      headers['Client-Token'] = token.trim();
    }

    // Limpa o número para garantir que só tem dígitos
    const cleanPhone = phone.replace(/\D/g, '');

    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phone: cleanPhone, // número de destino limpo
        message: messageText || 'Novo Lead WeBooter'
      })
    });

    const responseData = await response.json().catch(() => null);

    console.log('Resposta Z-API:', responseData);

    if (!response.ok) {
      throw new Error(`Z-API erro: ${JSON.stringify(responseData) || response.statusText}`);
    }

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    console.error('Erro na API:', error);
    return res.status(500).json({ error: error.message });
  }
}
