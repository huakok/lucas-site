import { esc, markup, priceLabel, screen } from './flows.js';
import { STATUSES, createLead, findLead, leadCard, leadMarkup, rememberRelay } from './leads.js';
import { sleep } from './telegram.js';

export const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Open the menu' },
  { command: 'about', description: 'Who I am' },
  { command: 'projects', description: 'Things I have built' },
  { command: 'services', description: 'What I build for clients' },
  { command: 'pricing', description: 'Packages and prices' },
  { command: 'process', description: 'How a project runs' },
  { command: 'faq', description: 'Common questions' },
  { command: 'channel', description: 'Channel and member discount' },
  { command: 'quote', description: 'Ask for a quote' },
  { command: 'cancel', description: 'Stop the quote request' },
];

const ADMIN_HELP = [
  '<b>Admin commands</b>',
  '',
  '/leads  the last 10 leads',
  '/stats  users, leads and channel numbers',
  '/queue  the next channel posts',
  '/postnext  publish the next queued post now',
  '/post &lt;text&gt;  publish your own post now (first line is the title)',
  '/pause and /resume  stop or restart scheduled posts',
  '/broadcast &lt;text&gt;  message everyone who has used the bot',
  '',
  'Reply to a lead or a forwarded message to answer that person through the bot.',
].join('\n');

const SERVICE_FOR_KIND = { bot: 0, web: 1, both: 2 };

export function createBot({ tg, config, content, stores, channel, notifyLead }) {
  const { users, leads, state } = stores;
  const sessions = new Map(); // chatId -> { step, draft }
  let pendingBroadcast = null;

  const ctx = () => ({
    content,
    botUsername: config.botUsername,
    channelUrl: config.channelUrl,
    siteUrl: config.linkableSiteUrl,
  });
  const isAdmin = (id) => Boolean(config.adminId) && id === config.adminId;

  // ---- sending -------------------------------------------------------------

  const send = (chatId, { text, buttons }) =>
    tg.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: markup(buttons) } : {}),
    });

  async function edit(message, { text, buttons }) {
    try {
      await tg.call('editMessageText', {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: buttons ? markup(buttons) : { inline_keyboard: [] },
      });
    } catch (err) {
      if (!/not modified/.test(err.message)) throw err;
    }
  }

  // A target is where a view goes: edit the tapped message, or send a new one.
  const respond = (target, view) => (target.message ? edit(target.message, view) : send(target.chatId, view));

  // ---- users ---------------------------------------------------------------

  function touchUser(from, source) {
    const all = users.data.users;
    const existing = all[from.id];
    all[from.id] = {
      joinedAt: new Date().toISOString(),
      source: source || 'direct',
      ...existing,
      id: from.id,
      firstName: from.first_name || '',
      username: from.username || '',
      blocked: false,
    };
    if (!existing || existing.blocked || existing.username !== (from.username || '')) users.save();
    return all[from.id];
  }

  // ---- quote wizard --------------------------------------------------------

  const CANCEL = { text: 'Cancel', act: 'q:cancel' };
  const options = (items, prefix) => items.map((label, i) => [{ text: label, act: `${prefix}:${i}` }]);

  const wizard = {
    service: () => ({
      text: '<b>Quote request, 1 of 4</b>\n\nWhat do you need built?',
      buttons: [...options(content.quote.services, 'q:svc'), [CANCEL]],
    }),
    budget: () => ({
      text: '<b>Quote request, 2 of 4</b>\n\nWhat is your budget?',
      buttons: [...options(content.quote.budgets, 'q:bud'), [CANCEL]],
    }),
    timeline: () => ({
      text: '<b>Quote request, 3 of 4</b>\n\nWhen do you need it?',
      buttons: [...options(content.quote.timelines, 'q:time'), [CANCEL]],
    }),
    details: () => ({
      text:
        '<b>Quote request, 4 of 4</b>\n\n' +
        'Describe what you need in a few sentences: what your business does and what the bot or site should do.\n\n' +
        'Send it as a message, or tap Skip.',
      buttons: [[{ text: 'Skip', act: 'q:skip' }], [CANCEL]],
    }),
    confirm: (draft) => {
      const lines = ['<b>Check your request</b>', ''];
      const row = (label, value) => value && lines.push(`${label}: ${esc(value)}`);
      row('Service', draft.service);
      row('Package', draft.package);
      row('Budget', draft.budget);
      row('Timeline', draft.timeline);
      row('Discount', draft.promo && `${draft.promo} (${content.perk.percent}% off)`);
      if (draft.details) lines.push('', `<i>${esc(draft.details)}</i>`);
      return {
        text: lines.join('\n'),
        buttons: [[{ text: 'Send request', act: 'q:send' }], [{ text: 'Start over', act: 'quote:start' }, CANCEL]],
      };
    },
  };

  function startQuote(target, from, packageId) {
    const user = touchUser(from);
    const draft = { promo: user.promo || '' };
    let step = 'service';
    const pkg = content.packages.find((p) => p.id === packageId);
    if (pkg) {
      draft.package = pkg.name;
      draft.budget = priceLabel(content, pkg);
      const service = content.quote.services[SERVICE_FOR_KIND[pkg.kind]];
      if (service) {
        draft.service = service;
        step = 'timeline';
      }
    }
    sessions.set(target.chatId, { step, draft });
    return respond(target, wizard[step](draft));
  }

  async function submitQuote(target, from) {
    const session = sessions.get(target.chatId);
    if (!session || session.step !== 'confirm') {
      return respond(target, { text: 'That request has expired. Send /quote to start a new one.' });
    }
    sessions.delete(target.chatId);
    const lead = createLead(stores, {
      source: 'bot',
      name: [from.first_name, from.last_name].filter(Boolean).join(' '),
      telegramId: from.id,
      username: from.username || '',
      ...session.draft,
    });
    await respond(target, {
      text:
        `<b>Request sent.</b>\n\nYour reference is <code>${lead.ref}</code>. ` +
        'I will reply in this chat within one working day.',
      buttons: [[{ text: '‹ Menu', go: 'home' }]],
    });
    await notifyLead(lead);
  }

  // ---- channel perk --------------------------------------------------------

  async function checkPerk(cq, target) {
    if (!channel.ready()) return 'The channel is not set up yet.';
    let member;
    try {
      member = await tg.call('getChatMember', { chat_id: config.channelId, user_id: cq.from.id });
    } catch {
      return 'I could not check right now. Try again in a minute.';
    }
    const joined = ['member', 'administrator', 'creator'].includes(member.status) || member.is_member;
    if (!joined) return 'You have not joined the channel yet. Join, then tap this again.';

    const user = touchUser(cq.from);
    user.promo = content.perk.code;
    users.save();
    await respond(target, {
      text:
        `<b>You are in. ${content.perk.percent}% off is yours.</b>\n\n` +
        `Your code is <code>${esc(content.perk.code)}</code>. It is added to your next quote request automatically.`,
      buttons: [[{ text: 'Get a quote', act: 'quote:start' }], [{ text: '‹ Menu', go: 'home' }]],
    });
    return '';
  }

  // ---- messages between clients and the admin ------------------------------

  async function relayToAdmin(msg) {
    if (!config.adminId) {
      return send(msg.chat.id, { text: 'Send /quote to ask for a quote, or /start for the menu.' });
    }
    const from = msg.from;
    const handle = from.username ? ` @${esc(from.username)}` : '';
    const header = `Message from <a href="tg://user?id=${from.id}">${esc(from.first_name || 'someone')}</a>${handle}`;
    if (msg.text) {
      const sent = await send(config.adminId, { text: `${header}\n\n${esc(msg.text)}\n\n<i>Reply to this message to answer.</i>` });
      rememberRelay(state, sent.message_id, msg.chat.id);
    } else {
      const head = await send(config.adminId, { text: `${header}\n\n<i>Reply to this message to answer.</i>` });
      const copy = await tg.call('copyMessage', {
        chat_id: config.adminId,
        from_chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
      rememberRelay(state, head.message_id, msg.chat.id);
      rememberRelay(state, copy.message_id, msg.chat.id);
    }
    return send(msg.chat.id, { text: 'Message sent. I will reply here.' });
  }

  async function relayToClient(msg, clientChatId) {
    try {
      await tg.call('copyMessage', { chat_id: clientChatId, from_chat_id: msg.chat.id, message_id: msg.message_id });
      await send(msg.chat.id, { text: 'Reply sent.' });
    } catch (err) {
      await send(msg.chat.id, { text: `The reply was not delivered: ${esc(err.message)}` });
    }
  }

  // ---- admin ---------------------------------------------------------------

  const day = (iso) => iso.slice(0, 10);
  const audience = () => Object.values(users.data.users).filter((u) => !u.blocked && u.id !== config.adminId);

  async function adminCommand(cmd, arg, chatId) {
    switch (cmd) {
      case 'admin':
        return send(chatId, { text: ADMIN_HELP });

      case 'leads': {
        const last = leads.data.leads.slice(-10).reverse();
        if (!last.length) return send(chatId, { text: 'No leads yet. They appear here when someone sends the site form or a /quote.' });
        const lines = last.map(
          (l) => `<code>${l.ref}</code> ${day(l.createdAt)} · <b>${STATUSES[l.status]}</b> · ${esc(l.service || '')} · ${esc(l.name || '')}`,
        );
        return send(chatId, { text: `<b>Last ${last.length} leads</b>\n\n${lines.join('\n')}` });
      }

      case 'stats': {
        const all = Object.values(users.data.users);
        const count = (key) => leads.data.leads.filter((l) => l.status === key).length;
        const fromWeb = leads.data.leads.filter((l) => l.source === 'web').length;
        return send(chatId, {
          text: [
            '<b>Stats</b>',
            '',
            `Bot users: ${all.length} (${all.filter((u) => u.blocked).length} blocked the bot)`,
            `Channel discount claimed: ${all.filter((u) => u.promo).length}`,
            `Leads: ${leads.data.leads.length} (${fromWeb} from the website)`,
            `New ${count('new')} · Contacted ${count('contacted')} · Won ${count('won')} · Lost ${count('lost')}`,
            `Channel posts published: ${stores.posted.data.posts.length}`,
            `Scheduled posts: ${state.data.paused ? 'paused' : `on, next ${channel.nextSlot()} (${config.timezone})`}`,
          ].join('\n'),
        });
      }

      case 'queue': {
        const next = [0, 1, 2].map((i) => channel.nextInQueue(i)).filter(Boolean);
        if (!next.length) return send(chatId, { text: 'The queue is empty. Add posts to content/channel-posts.json.' });
        return send(chatId, {
          text: `<b>Next in the queue</b>\n\n${next.map((p, i) => `${i + 1}. ${esc(p.title)}`).join('\n')}\n\nNext slot: ${channel.nextSlot()}`,
        });
      }

      case 'postnext':
      case 'post': {
        if (cmd === 'post' && !arg) return send(chatId, { text: 'Add the text after the command: /post Title, then the body on new lines.' });
        try {
          const [title, ...rest] = arg.split('\n');
          const url = cmd === 'post' ? await channel.publish({ title: title.trim(), body: rest.join('\n').trim() }) : await channel.publishNext();
          return send(chatId, { text: url ? `Published: ${url}` : 'Published.' });
        } catch (err) {
          return send(chatId, { text: `Not published: ${esc(err.message)}` });
        }
      }

      case 'pause':
      case 'resume':
        state.data.paused = cmd === 'pause';
        state.save();
        return send(chatId, { text: cmd === 'pause' ? 'Scheduled posts paused.' : `Scheduled posts resumed. Next: ${channel.nextSlot()}.` });

      case 'broadcast': {
        if (!arg) return send(chatId, { text: 'Add the text after the command: /broadcast Your message.' });
        const total = audience().length;
        if (!total) return send(chatId, { text: 'Nobody to send to yet.' });
        pendingBroadcast = arg;
        return send(chatId, {
          text: `<b>Broadcast preview</b>\n\n${esc(arg)}`,
          buttons: [[{ text: `Send to ${total} ${total === 1 ? 'person' : 'people'}`, act: 'bc:send' }], [{ text: 'Cancel', act: 'bc:cancel' }]],
        });
      }

      default:
        return null;
    }
  }

  async function runBroadcast(target) {
    const text = pendingBroadcast;
    pendingBroadcast = null;
    if (!text) return respond(target, { text: 'That broadcast has already been sent or cancelled.' });
    await respond(target, { text: 'Sending…' });
    let sent = 0;
    let failed = 0;
    for (const user of audience()) {
      try {
        await tg.call('sendMessage', { chat_id: user.id, text });
        sent += 1;
      } catch (err) {
        if (err.code === 429) await sleep((err.retryAfter || 5) * 1000);
        if (err.code === 403) user.blocked = true;
        failed += 1;
      }
      await sleep(60); // stays under Telegram's 30 messages a second
    }
    users.save();
    return respond(target, { text: `Broadcast sent to ${sent}. ${failed ? `${failed} could not be reached.` : ''}` });
  }

  async function setLeadStatus(cq, ref, status) {
    const lead = findLead(stores, ref);
    if (!lead || !STATUSES[status]) return 'That lead no longer exists.';
    lead.status = status;
    leads.save();
    await tg.call('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: leadCard(lead),
      parse_mode: 'HTML',
      reply_markup: leadMarkup(lead),
      link_preview_options: { is_disabled: true },
    });
    return `Marked ${STATUSES[status].toLowerCase()}`;
  }

  // ---- /start --------------------------------------------------------------

  async function onStart(msg, payload) {
    const from = msg.from;
    const chatId = msg.chat.id;
    sessions.delete(chatId);
    touchUser(from, payload ? payload.split('_')[0] : 'direct');

    if (payload.startsWith('lead_')) {
      // Someone sent the website form, then opened the bot from its confirmation.
      const lead = findLead(stores, payload.slice(5));
      if (lead && !lead.telegramId) {
        lead.telegramId = from.id;
        lead.username = from.username || '';
        leads.save();
        await send(chatId, {
          text: `<b>Your request ${lead.ref} is linked to this chat.</b>\n\nI will reply here within one working day.`,
        });
        await notifyLead(lead, 'This website lead has opened the bot. You can now reply to them here.');
      }
      return send(chatId, screen('home', ctx(), from.first_name));
    }
    if (payload.startsWith('pkg_')) return startQuote({ chatId }, from, payload.slice(4));
    if (payload.startsWith('quote')) return startQuote({ chatId }, from);
    return send(chatId, screen('home', ctx(), from.first_name));
  }

  // ---- update handlers -----------------------------------------------------

  async function onMessage(msg) {
    if (msg.chat.type !== 'private' || !msg.from) return;
    const chatId = msg.chat.id;
    const from = msg.from;
    const text = (msg.text || '').trim();
    const admin = isAdmin(from.id);

    if (text.startsWith('/')) {
      const head = text.split(/\s/)[0];
      const cmd = head.slice(1).split('@')[0].toLowerCase();
      const arg = text.slice(head.length).trim();

      if (cmd === 'start') return onStart(msg, arg);
      touchUser(from);
      if (cmd === 'menu' || cmd === 'help') return send(chatId, screen('home', ctx(), from.first_name));
      if (['about', 'projects', 'services', 'pricing', 'process', 'faq'].includes(cmd)) return send(chatId, screen(cmd, ctx()));
      if (cmd === 'channel') return send(chatId, screen('perk', ctx()));
      if (cmd === 'quote') return startQuote({ chatId }, from);
      if (cmd === 'cancel') {
        const had = sessions.delete(chatId);
        return send(chatId, { text: had ? 'Quote request cancelled.' : 'Nothing to cancel.', buttons: [[{ text: '‹ Menu', go: 'home' }]] });
      }
      if (cmd === 'id') return send(chatId, { text: `Your Telegram ID is <code>${from.id}</code>.` });
      if (admin) {
        const handled = await adminCommand(cmd, arg, chatId);
        if (handled) return handled;
      }
      return send(chatId, { text: 'I do not know that command. Send /start for the menu.' });
    }

    if (admin && msg.reply_to_message) {
      const client = state.data.relay[msg.reply_to_message.message_id];
      if (client) return relayToClient(msg, client);
    }

    const session = sessions.get(chatId);
    if (session?.step === 'details') {
      if (!text) return send(chatId, { text: 'Describe it in a text message, or tap Skip above.' });
      session.draft.details = text.slice(0, 1500);
      session.step = 'confirm';
      return send(chatId, wizard.confirm(session.draft));
    }

    touchUser(from);
    if (admin) return send(chatId, { text: 'To answer a client, reply to their message or lead. Send /admin for commands.' });
    return relayToAdmin(msg);
  }

  async function onCallback(cq) {
    const data = cq.data || '';
    const answer = (text = '', alert = false) =>
      tg.call('answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text, show_alert: alert } : {}) }).catch(() => {});
    if (!cq.message) return answer();

    const target = { chatId: cq.message.chat.id, message: cq.message };
    const session = sessions.get(target.chatId);
    const [a, b, c] = data.split(':');

    try {
      if (a === 'go') {
        const view = screen(data.slice(3), ctx(), cq.from.first_name);
        if (view) await respond(target, view);
        return answer();
      }

      if (data === 'quote:start') { await startQuote(target, cq.from); return answer(); }
      if (a === 'quote' && b === 'pkg') { await startQuote(target, cq.from, c); return answer(); }
      if (data === 'perk:check') {
        const problem = await checkPerk(cq, target);
        return answer(problem, Boolean(problem));
      }

      if (a === 'q') {
        if (b === 'cancel') {
          sessions.delete(target.chatId);
          await respond(target, screen('home', ctx(), cq.from.first_name));
          return answer('Quote request cancelled');
        }
        if (!session) {
          await respond(target, { text: 'That request has expired. Send /quote to start a new one.' });
          return answer();
        }
        const { draft } = session;
        const pick = (list) => list[Number(c)];
        if (b === 'svc' && pick(content.quote.services)) { draft.service = pick(content.quote.services); session.step = 'budget'; }
        else if (b === 'bud' && pick(content.quote.budgets)) { draft.budget = pick(content.quote.budgets); session.step = 'timeline'; }
        else if (b === 'time' && pick(content.quote.timelines)) { draft.timeline = pick(content.quote.timelines); session.step = 'details'; }
        else if (b === 'skip' && session.step === 'details') { session.step = 'confirm'; }
        else if (b === 'send') { await submitQuote(target, cq.from); return answer('Request sent'); }
        else return answer();
        await respond(target, wizard[session.step](draft));
        return answer();
      }

      if (isAdmin(cq.from.id)) {
        if (a === 'lead') return answer(await setLeadStatus(cq, b, c));
        if (data === 'bc:send') { await answer(); return runBroadcast(target); }
        if (data === 'bc:cancel') {
          pendingBroadcast = null;
          await respond(target, { text: 'Broadcast cancelled.' });
          return answer();
        }
      }
      return answer();
    } catch (err) {
      await answer('Something went wrong. Send /start to try again.', true);
      throw err;
    }
  }

  function onMembership(change) {
    // Private chat: the user blocked or unblocked the bot.
    if (change.chat.type !== 'private') return;
    const user = users.data.users[change.from.id];
    if (!user) return;
    user.blocked = change.new_chat_member.status === 'kicked';
    users.save();
  }

  return {
    async handleUpdate(update) {
      if (update.message) return onMessage(update.message);
      if (update.callback_query) return onCallback(update.callback_query);
      if (update.my_chat_member) return onMembership(update.my_chat_member);
    },
  };
}
