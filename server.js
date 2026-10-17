'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const AUTH_DIR = path.resolve(process.env.WWEBJS_AUTH_PATH || path.join(__dirname, 'whatsapp_sessions'));
const DASHBOARD_USER = process.env.DASHBOARD_USER || '';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const MAX_MESSAGE_BYTES = process.env.MAX_MESSAGE_BYTES || '12mb';

let client = null;
let ready = false;
let qr = null;
let pairingCode = null;
let userNumber = null;
let lastError = null;
let initializing = false;
let reconnectTimer = null;
let shuttingDown = false;

fs.mkdirSync(AUTH_DIR, { recursive: true });

// Optional HTTP Basic Authentication. Set BOTH variables in your hosting dashboard
// before exposing this app publicly. Browser prompts for credentials once per session.
app.use((req, res, next) => {
  if (!DASHBOARD_USER || !DASHBOARD_PASSWORD) return next();
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch (_) {}
    const separator = decoded.indexOf(':');
    const username = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (safeEqual(username, DASHBOARD_USER) && safeEqual(password, DASHBOARD_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="WhatsBulk dashboard", charset="UTF-8"');
  return res.status(401).send('Authentication required. Set valid DASHBOARD_USER and DASHBOARD_PASSWORD values.');
});

function safeEqual(a, b) {
  const crypto = require('crypto');
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.disable('x-powered-by');
app.use(express.json({ limit: MAX_MESSAGE_BYTES }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) }));

app.get('/api/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ready,
    qr: ready ? null : qr,
    pairingCode,
    user: userNumber,
    error: lastError,
    initializing,
    authPath: AUTH_DIR
  });
});

function createClient() {
  return new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsbulk', dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-extensions'
      ]
    }
  });
}

async function initializeClient() {
  if (initializing || shuttingDown) return;
  initializing = true;
  lastError = null;
  try {
    if (!client) {
      client = createClient();
      client.on('qr', (value) => {
        qr = value;
        ready = false;
        pairingCode = null;
        lastError = null;
        console.log('\nWhatsApp QR code generated. Open the dashboard to scan it.');
        try { qrcodeTerminal.generate(value, { small: true }); } catch (_) {}
      });
      client.on('authenticated', () => {
        console.log('WhatsApp authentication completed; waiting for ready event.');
        qr = null;
        lastError = null;
      });
      client.on('ready', () => {
        ready = true;
        qr = null;
        pairingCode = null;
        lastError = null;
        userNumber = client.info?.wid?.user || null;
        console.log(`WhatsApp is READY${userNumber ? ` for ${userNumber}` : ''}.`);
      });
      client.on('auth_failure', (message) => {
        ready = false;
        lastError = `WhatsApp authentication failed: ${String(message || 'unknown error')}`;
        console.error(lastError);
      });
      client.on('disconnected', (reason) => {
        ready = false;
        qr = null;
        pairingCode = null;
        userNumber = null;
        lastError = `WhatsApp disconnected: ${String(reason || 'unknown reason')}`;
        console.error(lastError);
        scheduleReconnect();
      });
      client.on('change_state', (state) => console.log('WhatsApp state:', state));
    }
    await client.initialize();
  } catch (error) {
    lastError = error?.message || String(error);
    console.error('WhatsApp initialization failed:', lastError);
    scheduleReconnect();
  } finally {
    initializing = false;
  }
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (shuttingDown) return;
    try {
      if (client) {
        await client.destroy().catch(() => {});
        client = null;
      }
    } catch (_) { client = null; }
    await initializeClient();
  }, 10000);
}

app.post('/api/request-pairing-code', async (req, res) => {
  if (!client || ready) {
    return res.status(409).json({ success: false, error: ready ? 'WhatsApp is already connected.' : 'WhatsApp client is still starting. Wait a moment and try again.' });
  }
  const phoneNumber = String(req.body?.phoneNumber || '').replace(/\D/g, '');
  if (phoneNumber.length < 10 || phoneNumber.length > 15) {
    return res.status(400).json({ success: false, error: 'Enter the phone number with country code, digits only (10–15 digits).' });
  }
  try {
    const code = await client.requestPairingCode(phoneNumber);
    pairingCode = code;
    return res.json({ success: true, code });
  } catch (error) {
    const message = error?.message || 'Could not request a pairing code.';
    lastError = message;
    return res.status(500).json({ success: false, error: message });
  }
});

app.post('/api/send', async (req, res) => {
  if (!ready || !client) return res.status(409).json({ success: false, error: 'WhatsApp is not ready. Scan the QR code and wait for Connected status.' });

  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  const message = String(req.body?.message || '');
  const fileBase64 = req.body?.fileBase64;
  const fileMime = req.body?.fileMime;
  const fileName = req.body?.fileName;
  if (phone.length < 10 || phone.length > 15) return res.status(400).json({ success: false, error: 'Phone number must include country code and contain 10–15 digits.' });
  if (!message.trim() && !(fileBase64 && fileMime)) return res.status(400).json({ success: false, error: 'Message text or an attachment is required.' });

  try {
    const numberDetails = await client.getNumberId(phone);
    if (!numberDetails) return res.status(404).json({ success: false, error: 'This number is not registered on WhatsApp.' });
    if (fileBase64 && fileMime) {
      const pureBase64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '');
      const media = new MessageMedia(String(fileMime), pureBase64, String(fileName || 'attachment'));
      const options = { caption: message, sendSeen: false };
      if (!String(fileMime).startsWith('image/') && !String(fileMime).startsWith('video/')) options.sendMediaAsDocument = true;
      await client.sendMessage(numberDetails._serialized, media, options);
    } else {
      await client.sendMessage(numberDetails._serialized, message, { sendSeen: false });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Message send failed:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Message could not be sent.' });
  }
});

app.use((error, _req, res, _next) => {
  console.error('HTTP error:', error);
  if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'Request too large.' });
  return res.status(500).json({ success: false, error: 'Unexpected server error.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Dashboard available on http://${HOST}:${PORT}`);
  console.log(`WhatsApp session data directory: ${AUTH_DIR}`);
  if (!DASHBOARD_USER || !DASHBOARD_PASSWORD) {
    console.warn('WARNING: Dashboard authentication is disabled. Set DASHBOARD_USER and DASHBOARD_PASSWORD before public deployment.');
  }
  initializeClient();
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down...`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { if (client) await client.destroy(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
