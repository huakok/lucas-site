// The content the website reads, shared by the live server and the static export.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { priceLabel } from './flows.js';

export const PUBLIC_DIR = path.join(ROOT, 'public');

const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, 'content', file), 'utf8'));
export const content = readJson('content.json');
export const queue = readJson('channel-posts.json');

export function publicContent(config) {
  const { perk, bot, ...rest } = content;
  // The photo only shows once its file has been added to public/.
  const photo = content.about.photo || '';
  const hasPhoto = Boolean(photo) && existsSync(path.join(PUBLIC_DIR, photo));
  return {
    ...rest,
    about: { ...content.about, photo: hasPhoto ? photo : '' },
    packages: content.packages.map((p) => ({ ...p, priceLabel: priceLabel(content, p) })),
    perk: { percent: perk.percent, text: perk.text }, // the code itself stays in the bot
    telegram: {
      bot: config.botUsername ? `https://t.me/${config.botUsername}` : '',
      botUsername: config.botUsername,
      channel: config.channelUrl,
    },
  };
}

export const screenContext = (config) => ({ content, botUsername: config.botUsername, channelUrl: config.channelUrl });
