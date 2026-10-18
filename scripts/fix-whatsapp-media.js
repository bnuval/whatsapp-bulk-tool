'use strict';

// Work around a whatsapp-web.js media-send regression where MediaData.__x_id
// overwrites the outgoing message's internal ID. This patch is idempotent.
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'whatsapp-web.js',
  'src',
  'util',
  'Injected',
  'Utils.js'
);

if (!fs.existsSync(target)) {
  console.error('[media-fix] Cannot find whatsapp-web.js Utils.js at:', target);
  console.error('[media-fix] Dependency layout may have changed; refusing to silently skip the fix.');
  process.exit(1);
}

let source = fs.readFileSync(target, 'utf8');
if (source.includes('delete message.__x_id;')) {
  console.log('[media-fix] WhatsApp media ID fix is already present.');
  process.exit(0);
}

const messageStart = source.indexOf('const message = {', source.indexOf('sendMessage'));
if (messageStart < 0) {
  console.error('[media-fix] Could not find outgoing message object in Utils.js.');
  process.exit(1);
}

const optionsAnchor = source.indexOf('...extraOptions,', messageStart);
if (optionsAnchor < 0 || optionsAnchor - messageStart > 12000) {
  console.error('[media-fix] Could not find expected extraOptions anchor in outgoing message object.');
  process.exit(1);
}

const objectEnd = source.indexOf('};', optionsAnchor);
if (objectEnd < 0 || objectEnd - optionsAnchor > 1000) {
  console.error('[media-fix] Could not find end of outgoing message object.');
  process.exit(1);
}

const insertion = `\n\n        // Remove MediaData's private ID so it cannot overwrite the outgoing Msg ID.\n        delete message.__x_id;`;
source = source.slice(0, objectEnd + 2) + insertion + source.slice(objectEnd + 2);
fs.writeFileSync(target, source, 'utf8');

if (!fs.readFileSync(target, 'utf8').includes('delete message.__x_id;')) {
  console.error('[media-fix] Patch verification failed.');
  process.exit(1);
}
console.log('[media-fix] Applied WhatsApp media-send compatibility fix.');
