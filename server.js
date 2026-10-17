const express = require('express');
const cors = require('cors');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let qrCodeData = null;
let pairingCode = null;
let isReady = false;
let userNumber = null;
let clientError = null;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\nExpress Server running on port ${PORT}\n`);
});

let client;
try {
    console.log('Initializing WhatsApp Client...');
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './whatsapp_sessions'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions'
            ]
        }
    });

    client.on('qr', (qr) => {
        console.log('\n--- QR CODE RECEIVED FROM WHATSAPP ---');
        qrCodeData = qr;
        isReady = false;
        try { qrcode.generate(qr, { small: true }); } catch (e) {}
    });

    client.on('ready', () => {
        console.log('\n>>> WhatsApp Client is CONNECTED! <<<\n');
        isReady = true;
        qrCodeData = null;
        pairingCode = null;
        if (client.info && client.info.wid) {
            userNumber = client.info.wid.user;
        }
    });

    client.on('authenticated', () => {
        console.log('>>> WhatsApp Authenticated successfully! <<<\n');
        isReady = true;
        qrCodeData = null;
        if (client.info && client.info.wid) {
            userNumber = client.info.wid.user;
        }
    });

    client.on('auth_failure', (msg) => {
        console.error('Authentication failure:', msg);
        clientError = 'Auth failure: ' + msg;
    });

    client.on('disconnected', (reason) => {
        console.log('Disconnected:', reason);
        isReady = false;
        qrCodeData = null;
        try { client.initialize(); } catch (e) {}
    });

    setTimeout(() => {
        client.initialize().catch(err => {
            clientError = err.message;
            console.error('Initialization error:', err);
        });
    }, 2000);

} catch (err) {
    clientError = err.message;
    console.error('Client creation error:', err);
}

// Status endpoint with deep client inspection
app.get('/api/status', (req, res) => {
    if (client && client.info && client.info.wid) {
        isReady = true;
        userNumber = client.info.wid.user;
        qrCodeData = null;
    }

    res.json({
        ready: isReady,
        qr: qrCodeData,
        pairingCode: pairingCode,
        user: userNumber || 'Active',
        error: clientError
    });
});

app.post('/api/request-pairing-code', async (req, res) => {
    if (!client) {
        return res.status(500).json({ success: false, error: 'Client not initialized.' });
    }
    try {
        const rawNumber = String(req.body.phoneNumber || '').replace(/\D/g, '');
        if (!rawNumber || rawNumber.length < 10) {
            return res.status(400).json({ success: false, error: 'Enter a valid phone number with country code.' });
        }
        const code = await client.requestPairingCode(rawNumber);
        pairingCode = code;
        return res.json({ success: true, code: code });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'Failed to generate pairing code.' });
    }
});

app.post('/api/send', async (req, res) => {
    if (!isReady || !client) {
        return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
    }

    try {
        const { phone, message, fileBase64, fileMime, fileName } = req.body;
        const cleanNumber = String(phone).replace(/\D/g, '');

        const numberDetails = await client.getNumberId(cleanNumber);
        if (!numberDetails) {
            return res.json({ success: false, error: 'Number not registered on WhatsApp' });
        }

        const chatId = numberDetails._serialized;

        if (fileBase64 && fileMime) {
            const pureBase64 = fileBase64.includes(';base64,')
                ? fileBase64.split(';base64,')[1]
                : fileBase64;

            const media = new MessageMedia(fileMime, pureBase64, fileName || 'attachment');
            const options = { caption: message || '', sendSeen: false };

            if (!fileMime.startsWith('image/') && !fileMime.startsWith('video/')) {
                options.sendMediaAsDocument = true;
            }

            await client.sendMessage(chatId, media, options);
        } else {
            await client.sendMessage(chatId, message || '', { sendSeen: false });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('[SEND ERROR]:', err);
        return res.status(500).json({ success: false, error: err.message || 'Internal send error' });
    }
});
