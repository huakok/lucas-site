import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { config } from './config.js';
import { openStores } from './store.js';
import { Telegram, sleep } from './telegram.js';
import { allScreens } from './flows.js';
import { createLead, createLeadNotifier, validateWebLead } from './leads.js';
import { createChannel } from './channel.js';
import { PUBLIC_COMMANDS, createBot } from './bot.js';
import { PUBLIC_DIR, content, publicContent, queue, screenContext } from './site-data.js';

const stores = openStores();

// ---- Telegram ---------------------------------------------------------------

let tg = null;
if (config.botToken) {
  try {
    const client = new Telegram(config.botToken);
    const me = await client.call('getMe');
    config.botUsername = me.username;
    tg = client;
  } catch (err) {
    console.error(`[bot] Telegram rejected BOT_TOKEN (${err.message}). Running the website only.`);
  }
}

const notifyLead = createLeadNotifier({ tg, config, stores });
const channel = createChannel({ tg, config, queue, stores });

async function runBot() {
  const bot = createBot({ tg, config, content, stores, channel, notifyLead });
  await tg.call('setMyCommands', { commands: PUBLIC_COMMANDS });
  channel.start();

  let offset = 0;
  let wait = 1000;
  for (;;) {
    try {
      const updates = await tg.call(
        'getUpdates',
        { offset, timeout: 50, allowed_updates: ['message', 'callback_query', 'my_chat_member'] },
        { timeout: 65_000 },
      );
      wait = 1000;
      for (const update of updates) {
        offset = update.update_id + 1;
        bot.handleUpdate(update).catch((err) => console.error(`[bot] ${err.message}`));
      }
    } catch (err) {
      console.error(`[bot] polling failed: ${err.message}`);
      await sleep(wait);
      wait = Math.min(wait * 2, 30_000);
    }
  }
}

// ---- Website API ------------------------------------------------------------

// At most 5 form submissions per address every 10 minutes.
const recentSubmits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const times = (recentSubmits.get(ip) || []).filter((t) => now - t < 600_000);
  times.push(now);
  recentSubmits.set(ip, times);
  return times.length > 5;
}
setInterval(() => recentSubmits.clear(), 3_600_000).unref();

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function submitLead(req, res) {
  if (rateLimited(req.socket.remoteAddress)) {
    return json(res, 429, { error: 'Too many requests from this connection. Try again in 10 minutes.' });
  }
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status || 400, { error: 'The form data could not be read.' });
  }
  if (!input || typeof input !== 'object') return json(res, 400, { error: 'The form data could not be read.' });
  // Hidden field that people never see; bots fill it in. Pretend it worked.
  if (input.company_website) return json(res, 200, { ref: 'BW00000000', deepLink: '' });

  const { value, errors } = validateWebLead(input, content);
  if (errors) return json(res, 422, { error: 'Check the highlighted fields.', errors });

  const lead = createLead(stores, value);
  notifyLead(lead).catch((err) => console.error(`[lead] ${lead.ref} saved, admin not notified: ${err.message}`));
  json(res, 201, {
    ref: lead.ref,
    deepLink: config.botUsername ? `https://t.me/${config.botUsername}?start=lead_${lead.ref}` : '',
  });
}

// ---- Static files -----------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 404, { error: 'Not found' });
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && pathname === '/api/lead') return await submitLead(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    if (pathname === '/api/content') return json(res, 200, publicContent(config));
    if (pathname === '/api/screens') return json(res, 200, allScreens(screenContext(config)));
    if (pathname === '/api/channel') return json(res, 200, { posts: channel.recent(3) });
    if (pathname === '/health') return json(res, 200, { ok: true, bot: Boolean(tg) });
    return await serveStatic(pathname, res);
  } catch (err) {
    console.error(`[web] ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
  }
});

server.listen(config.port, () => {
  console.log(`[web] site running at http://localhost:${config.port}`);
  if (!tg) {
    console.log('[bot] no BOT_TOKEN in .env: website only. Form requests are saved to data/leads.json.');
    return;
  }
  console.log(`[bot] @${config.botUsername} is running`);
  if (!config.adminId) console.log('[bot] ADMIN_ID is not set. Send /id to the bot and put the number in .env.');
  if (!config.channelId) console.log('[bot] CHANNEL_ID is not set. Channel posting and the discount check are off.');
  else console.log(`[channel] posting to ${config.channelId} at ${config.postTimes.join(', ') || 'no times'} (${config.timezone})`);
  runBot();
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
