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
let isBrowserLoaded = false;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\nExpress Server running on port ${PORT}\n`);
});

let client;
try {
    console.log('Initializing WhatsApp Client with bundled Puppeteer...');
    client = new Client({
        authStrategy: new LocalAuth(),
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
        isBrowserLoaded = true;
        qrCodeData = qr;
        isReady = false;
    });

    client.on('ready', async () => {
        isBrowserLoaded = true;
        console.log('\n>>> WhatsApp Client is CONNECTED! <<<\n');
        isReady = true;
        qrCodeData = null;
        pairingCode = null;
        userNumber = client.info && client.info.wid ? client.info.wid.user : 'Connected';

        try {
            if (client && client.pupPage) {
                await client.pupPage.evaluate(() => {
                    if (window.WWebJS && window.WWebJS.processMediaData) {
                        const orig = window.WWebJS.processMediaData;
                        window.WWebJS.processMediaData = async (...args) => {
                            const m = await orig.apply(window.WWebJS, args);
                            if (m && typeof m === 'object') {
                                const c = {};
                                for (const k of Object.keys(m)) {
                                    if (k !== '__x_id' && k !== 'id') c[k] = m[k];
                                }
                                return c;
                            }
                            return m;
                        };
                    }
                });
            }
        } catch (err) {}
    });

    client.on('authenticated', () => {
        console.log('>>> WhatsApp Authenticated successfully! <<<\n');
        isReady = true;
        userNumber = client.info && client.info.wid ? client.info.wid.user : 'Authenticated';
    });

    client.on('disconnected', (reason) => {
        console.log('Disconnected:', reason);
        isReady = false;
        qrCodeData = null;
        isBrowserLoaded = false;
        try { client.initialize(); } catch (e) {}
    });

    setTimeout(() => {
        client.initialize().then(() => {
            isBrowserLoaded = true;
        }).catch(err => {
            clientError = err.message;
            isBrowserLoaded = true;
        });
    }, 2000);

} catch (err) {
    clientError = err.message;
    isBrowserLoaded = true;
}

// Live Status endpoint that also verifies client info if ready
app.get('/api/status', (req, res) => {
    // Double check state from client instance if available
    if (client && client.info && client.info.wid) {
        isReady = true;
        userNumber = client.info.wid.user;
    }

    res.json({
        ready: isReady,
        qr: qrCodeData,
        pairingCode: pairingCode,
        user: userNumber,
        error: clientError,
        browserLoaded: isBrowserLoaded
    });
});

app.post('/api/request-pairing-code', async (req, res) => {
    if (!client) {
        return res.status(500).json({ success: false, error: 'WhatsApp client not initialized.' });
    }
    if (!client.pupPage) {
        return res.status(500).json({ success: false, error: 'Browser is still launching. Please wait a moment.' });
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
        return res.status(500).json({ success: false, error: err.message || 'Internal send error' });
    }
});
