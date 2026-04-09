import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { supabase } from './supabase.js';

let client: Client | null = null;
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

export const initWhatsAppClient = () => {
  if (client) {
    client.destroy();
  }

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', (qr) => {
    currentQrCode = qr;
    console.log('QR Code generated. Please scan it.');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    console.log('WhatsApp Client is ready!');
    currentQrCode = null;
    await updateConnectionStatus(true);
  });

  client.on('disconnected', async (reason) => {
    console.log('WhatsApp Client was disconnected', reason);
    currentQrCode = null;
    await updateConnectionStatus(false);
    client = null;
  });

  client.initialize();
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

  const formattedNumber = `55${configuredNumber.replace(/\D/g, '')}@c.us`;

  const message = `🚨 *Novo lead qualificado no WeBooter!*\n\nAcesse agora (https://traewebooter6uef.vercel.app/admin) e faça o atendimento enquanto ele ainda está engajado.`;

  try {
    await client.sendMessage(formattedNumber, message);
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};
