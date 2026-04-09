import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Boom } from 'pino';
import { supabase } from './supabase.js';

let client: ReturnType<typeof makeWASocket> | null = null;
let currentQrCode: string | null = null;
let isConnected = false;

const updateConnectionStatus = async (status: boolean) => {
  isConnected = status;
  try {
    await supabase
      .from('configuracoes')
      .update({ valor: status.toString() })
      .eq('chave', 'whatsapp_conectado');
  } catch (error) {
    console.error('Failed to update connection status in Supabase:', error);
  }
};

export const initWhatsAppClient = async () => {
  if (client) {
    // If it exists, let's not re-initialize randomly
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

  client = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: Boom.child({ level: 'silent' }), // Suppress excessive logs
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false
  });

  client.ev.on('creds.update', saveCreds);

  client.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Convert the raw QR string into a Base64 image so the frontend can display it easily
      try {
        currentQrCode = await QRCode.toDataURL(qr);
        console.log('QR Code generated. Ready to scan.');
      } catch (err) {
        console.error('Error generating QR Data URL', err);
      }
    }

    if (connection === 'close') {
      currentQrCode = null;
      await updateConnectionStatus(false);
      
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('WhatsApp connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
      
      client = null;
      
      // Reconnect if not logged out
      if (shouldReconnect) {
        initWhatsAppClient();
      }
    } else if (connection === 'open') {
      console.log('WhatsApp Client is ready!');
      currentQrCode = null;
      await updateConnectionStatus(true);
    }
  });
};

export const getStatus = () => {
  return {
    connected: isConnected,
    qrCode: currentQrCode
  };
};

export const sendLeadMessage = async (lead: any, configuredNumber: string) => {
  if (!client || !isConnected) {
    throw new Error('WhatsApp client is not connected');
  }

  // Baileys expects jid format: number@s.whatsapp.net
  const formattedNumber = `55${configuredNumber.replace(/\D/g, '')}@s.whatsapp.net`;

  const message = `🚨 *Novo lead qualificado no WeBooter!*\n\nAcesse agora (https://traewebooter6uef.vercel.app/admin) e faça o atendimento enquanto ele ainda está engajado.`;

  try {
    await client.sendMessage(formattedNumber, { text: message });
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};
