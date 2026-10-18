# WhatsBulk Pro — QR-linked WhatsApp Web build

This is the QR-linked `whatsapp-web.js` version. It is **not** the official Meta Cloud API.

## Windows quick start

1. Stop any older WhatsBulk server with `Ctrl+C` in its terminal.
2. Extract this ZIP to a new folder, for example `C:\WhatsBulk-Pro-QR`.
3. Open PowerShell in that folder.
4. Run:
   ```powershell
   npm install
   npm start
   ```
5. Open `http://127.0.0.1:3000` and wait for the QR code.
6. On your phone, open WhatsApp → Linked devices → Link a device, then scan the QR.
7. Leave the server terminal open and wait for the dashboard to say **Connected**. A successful scan alone does not mean the session is ready.

## What changed in this build

- Includes a guarded `postinstall` patch for a known QR-refresh callback defect in library builds that contain the affected source line. If the installed version has different source, the patch safely skips itself.
- Increases Puppeteer's protocol timeout to reduce premature failures during slow page initialization.
- Preserves local session data in `whatsapp_sessions` by default.

## If QR linking still fails

Check the terminal output and `/api/status`. If you see `sendIq called before startComms`, `OperationError`, or repeated `Runtime.callFunctionOn timed out`, those can be WhatsApp Web/library compatibility failures rather than a QR-rendering issue. This patch addresses only the QR-refresh callback; it cannot guarantee that WhatsApp Web's internal messaging layer will work. Do not delete `whatsapp_sessions` unless you are intentionally willing to link the device again.

## Security and responsible use

- Keep the dashboard local; do not expose it to the internet without authentication and HTTPS.
- Use only for contacts who have agreed to receive messages. Respect opt-outs and WhatsApp limits.
- QR codes expire; scan a fresh QR when the dashboard updates it.

## Environment options

- `PORT` (default `3000`)
- `WWEBJS_AUTH_PATH` (default `./whatsapp_sessions`)
- `DASHBOARD_USER` and `DASHBOARD_PASSWORD` (optional HTTP Basic Auth; set both before public deployment)
