import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const channelId = (env.CHANNEL_ID || '').trim();
const publicUrl = (env.PUBLIC_URL || '').trim().replace(/\/$/, '');

export const config = {
  port: Number(env.PORT) || 3000,
  botToken: (env.BOT_TOKEN || '').trim(),
  // Filled in from Telegram at startup; BOT_USERNAME is only a fallback for site-only mode.
  botUsername: (env.BOT_USERNAME || '').trim().replace(/^@/, ''),
  adminId: Number(env.ADMIN_ID) || null,
  channelId,
  channelUrl:
    (env.CHANNEL_URL || '').trim() ||
    (channelId.startsWith('@') ? `https://t.me/${channelId.slice(1)}` : ''),
  publicUrl,
  // Telegram rejects localhost and plain-http links in buttons, so only a public https URL is linked.
  linkableSiteUrl: /^https:\/\/(?!localhost|127\.)/.test(publicUrl) ? publicUrl : '',
  timezone: (env.TIMEZONE || '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
  postTimes: (env.POST_TIMES ?? '10:00,19:00')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s))
    .sort(),
};
