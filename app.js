const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const xlsx = require('xlsx');

// 1. Initialize client with custom launch flags
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // set to false if you want to watch Chrome open
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions'
        ]
    }
});

// 2. Display QR code in VS Code terminal
client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE IN WHATSAPP ---\n');
    qrcode.generate(qr, { small: true });
});

// 3. Triggered once WhatsApp Web connection is established
client.on('ready', async () => {
    console.log('\n>>> WhatsApp Client is successfully connected! <<<\n');

    try {
        // Read contacts.xlsx
        const workbook = xlsx.readFile('contacts.xlsx');
        const sheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const messageTemplate = "Hello {name}, this is a test notification.";
        console.log(`Found ${rows.length} contacts to process.\n`);

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            // Clean phone string to digits only
            const rawPhone = String(row.Phone || '').replace(/\D/g, '');
            const contactName = row.Name || 'Sir/Madam';

            if (!rawPhone || rawPhone.length < 10) {
                console.log(`[SKIP] Invalid phone format: "${row.Phone}"`);
                continue;
            }

            try {
                // Check if number exists on WhatsApp
                const numberDetails = await client.getNumberId(rawPhone);

                if (numberDetails) {
                    const finalMessage = messageTemplate.replace('{name}', contactName);
                    await client.sendMessage(numberDetails._serialized, finalMessage);
                    console.log(`[${i + 1}/${rows.length}] [SENT] -> ${rawPhone} (${contactName})`);
                } else {
                    console.log(`[${i + 1}/${rows.length}] [NOT ON WHATSAPP] -> ${rawPhone}`);
                }
            } catch (err) {
                console.error(`[ERROR] Failed to send to ${rawPhone}:`, err.message);
            }

            // Safe pause of 5 seconds between messages
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        console.log('\n>>> Finished sending messages! <<<');

    } catch (err) {
        console.error('Error reading contacts.xlsx file:', err.message);
    }
});

// Start the client
client.initialize();