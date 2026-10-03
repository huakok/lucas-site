import { esc } from './flows.js';

// Publishes the queue in content/channel-posts.json to the channel, one post
// per time slot in POST_TIMES, cycling back to the start when it runs out.
export function createChannel({ tg, config, queue, stores }) {
  const { state, posted } = stores;
  const ready = () => Boolean(tg && config.channelId);

  // "2026-10-03 18:46" in the configured timezone.
  const localNow = () =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone, dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(),
    );

  function buttons() {
    const rows = [[{ text: 'Get a quote', url: `https://t.me/${config.botUsername}?start=quote_channel` }]];
    if (config.linkableSiteUrl) rows.push([{ text: 'See the website', url: config.linkableSiteUrl }]);
    return { inline_keyboard: rows };
  }

  async function publish({ id = 'manual', title = '', body = '' }) {
    if (!ready()) throw new Error('The channel is not set up. Add CHANNEL_ID to .env.');
    const text = [title && `<b>${esc(title)}</b>`, esc(body)].filter(Boolean).join('\n\n');
    const sent = await tg.call('sendMessage', {
      chat_id: config.channelId,
      text,
      parse_mode: 'HTML',
      reply_markup: buttons(),
      link_preview_options: { is_disabled: true },
    });
    const url = config.channelId.startsWith('@')
      ? `https://t.me/${config.channelId.slice(1)}/${sent.message_id}`
      : '';
    posted.data.posts.push({ id, title, body, at: new Date().toISOString(), url });
    posted.data.posts = posted.data.posts.slice(-200);
    posted.save();
    return url;
  }

  const nextInQueue = (offset = 0) => queue[(state.data.nextPost + offset) % queue.length];

  async function publishNext() {
    if (!queue.length) throw new Error('content/channel-posts.json is empty.');
    const url = await publish(nextInQueue());
    state.data.nextPost = (state.data.nextPost + 1) % queue.length;
    state.save();
    return url;
  }

  async function tick() {
    if (!ready() || state.data.paused || !config.postTimes.length || !queue.length) return;
    const now = localNow();
    if (!state.data.lastSlot) {
      // First run: start from now instead of publishing for slots already past.
      state.data.lastSlot = now;
      state.save();
      return;
    }
    const [date, time] = now.split(' ');
    const due = config.postTimes.filter((t) => t <= time).map((t) => `${date} ${t}`).at(-1);
    if (!due || due <= state.data.lastSlot) return;
    state.data.lastSlot = due;
    state.save();
    try {
      await publishNext();
      console.log(`[channel] published the ${due} post`);
    } catch (err) {
      console.error(`[channel] could not publish the ${due} post: ${err.message}`);
    }
  }

  function nextSlot() {
    if (!config.postTimes.length) return 'none';
    const time = localNow().split(' ')[1];
    const later = config.postTimes.find((t) => t > time);
    return later ? `today ${later}` : `tomorrow ${config.postTimes[0]}`;
  }

  // What the website shows: real posts once there are some, the queue before that.
  function recent(n = 3) {
    const done = posted.data.posts.slice(-n).reverse();
    if (done.length) return done.map((p) => ({ title: p.title, body: p.body, at: p.at, url: p.url, status: 'posted' }));
    return queue.slice(0, n).map((p) => ({ title: p.title, body: p.body, status: 'queued' }));
  }

  return {
    ready,
    publish,
    publishNext,
    nextInQueue,
    nextSlot,
    recent,
    start: () => setInterval(tick, 30_000).unref(),
    tick,
  };
}
