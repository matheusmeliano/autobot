import express from 'express';
import { initWhatsAppClient, getStatus, sendLeadMessage } from '../whatsapp.js';

const router = express.Router();

router.post('/connect', (req, res) => {
  initWhatsAppClient();
  res.json({ success: true, message: 'WhatsApp client initialization started' });
});

router.get('/status', (req, res) => {
  const status = getStatus();
  res.json({ success: true, ...status });
});

router.post('/send-lead', async (req, res) => {
  const { lead, targetNumber } = req.body;
  
  if (!lead || !targetNumber) {
    return res.status(400).json({ success: false, error: 'Missing lead data or target number' });
  }

  try {
    await sendLeadMessage(lead, targetNumber);
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

export default router;
