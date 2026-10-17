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

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('\n--- QR CODE GENERATED ---');
    qrcode.generate(qr, { small: true });
    qrCodeData = qr;
    isReady = false;
});

client.on('ready', async () => {
    console.log('\n>>> WhatsApp Client is CONNECTED! <<<\n');
    isReady = true;
    qrCodeData = null;
    pairingCode = null;
    userNumber = client.info && client.info.wid ? client.info.wid.user : 'Connected';

    try {
        await client.pupPage.evaluate(() => {
            if (window.WWebJS) {
                if (window.WWebJS.processMediaData) {
                    const origProcessMediaData = window.WWebJS.processMediaData;
                    window.WWebJS.processMediaData = async (...args) => {
                        const mediaModel = await origProcessMediaData.apply(window.WWebJS, args);
                        if (mediaModel && typeof mediaModel === 'object') {
                            const cleanMedia = {};
                            for (const key of Object.keys(mediaModel)) {
                                if (key !== '__x_id' && key !== 'id') {
                                    cleanMedia[key] = mediaModel[key];
                                }
                            }
                            return cleanMedia;
                        }
                        return mediaModel;
                    };
                }
                if (window.WWebJS.getContactModel) {
                    const origGetContactModel = window.WWebJS.getContactModel;
                    window.WWebJS.getContactModel = (contact) => {
                        if (!contact) return {};
                        if (!contact.id && contact._serialized) {
                            contact.id = { _serialized: contact._serialized, user: contact.user };
                        }
                        try {
                            return origGetContactModel(contact);
                        } catch (e) {
                            return {
                                id: contact.id || { _serialized: '' },
                                isMe: false, isUser: true, isGroup: false, isWAContact: true, isMyContact: false
                            };
                        }
                    };
                }
            }
        });
        console.log('>>> Media & Document __x_id patch applied! <<<');
    } catch (err) {
        console.log('Patch error:', err.message);
    }
});

client.on('disconnected', (reason) => {
    console.log('Disconnected:', reason);
    isReady = false;
    qrCodeData = null;
    client.initialize();
});

client.initialize();

app.get('/api/status', (req, res) => {
    res.json({ ready: isReady, qr: qrCodeData, pairingCode: pairingCode, user: userNumber });
});

app.post('/api/request-pairing-code', async (req, res) => {
    const rawNumber = String(req.body.phoneNumber || '').replace(/\D/g, '');
    if (!rawNumber || rawNumber.length < 10) {
        return res.status(400).json({ error: 'Enter a valid phone number with country code.' });
    }
    try {
        const code = await client.requestPairingCode(rawNumber);
        pairingCode = code;
        return res.json({ success: true, code: code });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/send', async (req, res) => {
    if (!isReady) return res.status(400).json({ error: 'WhatsApp not connected' });

    const { phone, message, fileBase64, fileMime, fileName } = req.body;
    const cleanNumber = String(phone).replace(/\D/g, '');

    try {
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
            console.log(`[DELIVERED FILE] -> ${cleanNumber} (${fileName})`);
        } else {
            await client.sendMessage(chatId, message || '', { sendSeen: false });
            console.log(`[DELIVERED TEXT] -> ${cleanNumber}`);
        }

        return res.json({ success: true });
    } catch (err) {
        console.error(`[ERROR] ${cleanNumber}:`, err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\nServer running on port ${PORT}\n`);
});
