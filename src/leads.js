import { randomBytes } from 'node:crypto';
import { esc } from './flows.js';

export const STATUSES = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' };
const SOURCES = { web: 'Website form', bot: 'Telegram bot' };

export function createLead(stores, fields) {
  const lead = {
    ref: 'BW' + randomBytes(4).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    status: 'new',
    ...fields,
  };
  stores.leads.data.leads.push(lead);
  stores.leads.save();
  return lead;
}

export const findLead = (stores, ref) => stores.leads.data.leads.find((l) => l.ref === ref);

// Checks a website form submission. Returns { value } or { errors }.
export function validateWebLead(input, content) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const errors = {};
  const name = str(input.name);
  const contact = str(input.contact);
  const service = str(input.service);
  const budget = str(input.budget);
  const timeline = str(input.timeline);
  const details = str(input.details);
  const pkg = content.packages.find((p) => p.id === str(input.package));

  if (name.length < 2 || name.length > 80) errors.name = 'Enter your name (2 to 80 characters).';
  if (contact.length < 3 || contact.length > 120) errors.contact = 'Enter a Telegram @username or an email address.';
  if (!content.quote.services.includes(service)) errors.service = 'Choose what you need built.';
  if (budget && !content.quote.budgets.includes(budget)) errors.budget = 'Choose a budget from the list.';
  if (timeline && !content.quote.timelines.includes(timeline)) errors.timeline = 'Choose a timeline from the list.';
  if (details.length > 1500) errors.details = 'Keep the description under 1,500 characters.';

  if (Object.keys(errors).length) return { errors };
  return { value: { source: 'web', name, contact, service, budget, timeline, details, package: pkg?.name || '' } };
}

export function leadCard(lead) {
  const lines = [`<b>Lead ${lead.ref}</b> · ${SOURCES[lead.source] || lead.source}`, ''];
  const row = (label, value) => value && lines.push(`${label}: ${esc(value)}`);
  row('Name', lead.name);
  row('Contact', lead.contact);
  if (lead.telegramId) {
    const handle = lead.username ? ` @${esc(lead.username)}` : '';
    lines.push(`Telegram: <a href="tg://user?id=${lead.telegramId}">open chat</a>${handle}`);
  }
  row('Service', lead.service);
  row('Package', lead.package);
  row('Budget', lead.budget);
  row('Timeline', lead.timeline);
  row('Discount', lead.promo);
  lines.push(`Status: <b>${STATUSES[lead.status]}</b>`);
  if (lead.details) lines.push('', esc(lead.details));
  if (lead.telegramId) lines.push('', '<i>Reply to this message to write to them through the bot.</i>');
  return lines.join('\n');
}

export const leadMarkup = (lead) => ({
  inline_keyboard: [
    Object.entries(STATUSES)
      .filter(([key]) => key !== 'new' && key !== lead.status)
      .map(([key, label]) => ({ text: `Mark ${label.toLowerCase()}`, callback_data: `lead:${lead.ref}:${key}` })),
  ],
});

// Remembers which client an admin-chat message belongs to, so the admin can
// answer by replying to it.
export function rememberRelay(state, adminMessageId, clientChatId) {
  const relay = state.data.relay;
  relay[adminMessageId] = clientChatId;
  const keys = Object.keys(relay);
  for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete relay[key];
  state.save();
}

export function createLeadNotifier({ tg, config, stores }) {
  return async function notifyLead(lead, note = '') {
    if (!tg || !config.adminId) return;
    const sent = await tg.call('sendMessage', {
      chat_id: config.adminId,
      text: (note ? `${esc(note)}\n\n` : '') + leadCard(lead),
      parse_mode: 'HTML',
      reply_markup: leadMarkup(lead),
      link_preview_options: { is_disabled: true },
    });
    if (lead.telegramId) rememberRelay(stores.state, sent.message_id, lead.telegramId);
  };
}
