'use strict';

// Applies a narrowly-scoped workaround for a known QR refresh bug in some
// whatsapp-web.js builds. It only changes the callback when the expected source
// snippet is present; it never overwrites an unknown library implementation.
const fs = require('fs');
const path = require('path');
const clientPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

if (!fs.existsSync(clientPath)) {
  console.log('[WhatsBulk patch] whatsapp-web.js Client.js not found; skipped.');
  process.exit(0);
}

let source = fs.readFileSync(clientPath, 'utf8');
const broken = "window.require('WAWebCmd').Cmd.refreshQR();";
const fixed = "await this.pupPage.evaluate(() => window.require('WAWebCmd').Cmd.refreshQR());";

if (source.includes(fixed)) {
  console.log('[WhatsBulk patch] QR refresh workaround already present.');
  process.exit(0);
}
if (!source.includes(broken)) {
  console.warn('[WhatsBulk patch] Expected QR refresh code not found in this library version; no changes made.');
  process.exit(0);
}

source = source.replace(broken, fixed);
fs.writeFileSync(clientPath, source, 'utf8');
console.log('[WhatsBulk patch] Applied QR refresh workaround.');
