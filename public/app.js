const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : ms));

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

// Set by the static export: the page is served as plain files, with no server behind it.
const STATIC = 'static' in document.documentElement.dataset;
const api = (name) => (STATIC ? `api/${name}.json` : `/api/${name}`);

const state = { content: null, screens: {}, packageId: '' };

// ---- Chat preview -----------------------------------------------------------
// Renders the same screen objects the bot sends to Telegram (see src/flows.js).

const chatBody = $('#chat-body');
const chatHint = $('#chat-hint');
let menuBubble;
let menuKeys;

function showHint(text) {
  chatHint.textContent = text;
  chatHint.hidden = !text;
}

function onKey(button) {
  showHint('');
  if (button.go) return showScreen(button.go);
  if (button.act === 'perk:check') {
    return showHint('In Telegram, the bot checks that you have joined the channel and adds the discount to your quote.');
  }
  if (button.act?.startsWith('quote')) {
    const packageId = button.act.split(':')[2] || '';
    choosePackage(packageId);
    $('#quote').scrollIntoView();
    if (!STATIC) $('#f-name').focus({ preventScroll: true });
  }
}

function showScreen(id) {
  const view = state.screens[id];
  if (!view) return;
  // Text is Telegram HTML built on the server from escaped content.
  menuBubble.innerHTML = view.text;
  menuKeys.replaceChildren(
    ...view.buttons.map((row) =>
      h('div', { class: 'keys__row' },
        ...row.map((b) =>
          b.url
            ? h('a', { class: 'key', href: b.url, target: '_blank', rel: 'noopener' }, b.text)
            : h('button', { class: 'key', type: 'button', onclick: () => onKey(b) }, b.text),
        ),
      ),
    ),
  );
  chatBody.scrollTop = 0;
}

async function startChat() {
  chatBody.append(h('div', { class: 'bubble bubble--out bubble--enter' }, '/start'));
  const typing = h('div', { class: 'typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  await wait(450);
  chatBody.append(typing);
  await wait(900);
  typing.remove();
  menuBubble = h('div', { class: 'bubble bubble--in bubble--enter' });
  menuKeys = h('div', { class: 'keys bubble--enter' });
  chatBody.append(menuBubble, menuKeys);
  showScreen('home');
}

// ---- Page sections ----------------------------------------------------------

const SOCIAL_LABEL = { github: 'GitHub', tiktok: 'TikTok', linkedin: 'LinkedIn' };
const ticks = (items) => h('ul', { class: 'ticks' }, ...items.map((i) => h('li', {}, i)));

function choosePackage(id) {
  const pkg = state.content.packages.find((p) => p.id === id);
  state.packageId = pkg ? pkg.id : '';
  $('#form-package').hidden = !pkg;
  $('#form-package-name').textContent = pkg ? `${pkg.name}, ${pkg.priceLabel}` : '';
}

function renderContent(content) {
  $$('[data-brand]').forEach((el) => (el.textContent = content.brand.name));
  $('[data-brand-line]').textContent = content.brand.line;
  const email = $('#footer-email');
  email.textContent = content.brand.email;
  email.href = `mailto:${content.brand.email}`;

  const handle = content.brand.telegram;
  const direct = [h('a', { href: `mailto:${content.brand.email}` }, content.brand.email)];
  if (handle) {
    const url = `https://t.me/${handle}`;
    direct.unshift(h('a', { href: url, target: '_blank', rel: 'noopener' }, `@${handle} on Telegram`));
    const footerTelegram = $('#footer-telegram');
    footerTelegram.textContent = `@${handle}`;
    footerTelegram.href = url;
    footerTelegram.hidden = false;
  }
  if (STATIC) {
    $('#channel-lede').textContent = 'My bot publishes to my Telegram channel on a schedule. These are the next posts in its queue.';
    // No server to receive the form, so offer the direct routes instead.
    form.hidden = true;
    $('#direct-actions').replaceChildren(
      ...direct.map((link, i) => {
        link.className = `btn btn--small ${i === 0 ? 'btn--cobalt' : 'btn--ghost'}`;
        return link;
      }),
    );
    $('#direct-panel').hidden = false;
  } else {
    $('#direct').replaceChildren('Or reach me directly: ', ...direct);
    $('#direct').hidden = false;
  }

  if (content.about.photo) {
    const photo = $('#about-photo');
    photo.src = content.about.photo;
    photo.alt = content.about.photoAlt || content.brand.name;
    photo.hidden = false;
  }

  const { bot, channel } = content.telegram;
  const links = { bot, channel, 'bot-quote': bot && `${bot}?start=quote_site` };
  $$('[data-tg]').forEach((el) => {
    const url = links[el.dataset.tg];
    if (!url) return;
    el.href = url;
    el.hidden = false;
  });
  if (bot) $('[data-tg-wrap]').hidden = false;

  $('#services-list').replaceChildren(
    ...content.services.map((s) =>
      h('article', { class: 'service' },
        h('h3', {}, s.name),
        h('p', { class: 'service__summary' }, s.summary),
        ticks(s.points),
      ),
    ),
  );

  $('#about-text').replaceChildren(...content.about.paragraphs.map((p) => h('p', {}, p)));
  $('#facts').replaceChildren(
    ...content.about.facts.map((f) => h('div', { class: 'fact' }, h('dt', {}, f.label), h('dd', {}, f.value))),
  );

  const socials = Object.entries(content.socials || {}).filter(([, url]) => url);
  if (socials.length) {
    $('#socials').replaceChildren(
      ...socials.map(([name, url]) =>
        h('a', { href: url, target: '_blank', rel: 'noopener' }, SOCIAL_LABEL[name] || name),
      ),
    );
    $('#socials').hidden = false;
  }

  $('#project-list').replaceChildren(
    ...content.projects.map((p) =>
      h('article', { class: 'case' },
        h('p', { class: 'case__kind' }, p.kind),
        h('h3', {}, p.name),
        h('p', { class: 'case__summary' }, p.summary),
        h('p', { class: 'case__stack' }, p.stack),
      ),
    ),
  );

  $('#packages').replaceChildren(
    ...content.packages.map((p) =>
      h('li', { class: 'price' },
        h('div', { class: 'price__what' },
          h('strong', {}, p.name),
          h('span', {}, `${p.blurb} ${p.timeline}.`),
        ),
        h('span', { class: 'price__amount' }, p.priceLabel),
        h('a', { class: 'price__ask', href: '#quote', onclick: () => choosePackage(p.id) }, 'Ask for this package'),
      ),
    ),
  );

  $('#perk').textContent = `${content.perk.text} The bot checks your membership and adds the discount to your quote.`;

  const fill = (id, items, placeholder) =>
    $(id).replaceChildren(h('option', { value: '' }, placeholder), ...items.map((i) => h('option', {}, i)));
  fill('#f-service', content.quote.services, 'Choose one');
  fill('#f-budget', content.quote.budgets, 'Not applicable or not sure');
  fill('#f-timeline', content.quote.timelines, 'Not sure yet');
}

function renderPosts(posts) {
  const date = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  $('#posts').replaceChildren(
    ...posts.map((p) =>
      h('article', { class: 'post' },
        h('h3', {}, p.title),
        h('p', { class: 'post__body' }, p.body),
        h('p', { class: 'post__meta' }, p.status === 'posted' ? `Posted ${date(p.at)}` : 'Queued to post'),
      ),
    ),
  );
}

// ---- Quote form -------------------------------------------------------------

const form = $('#quote-form');
const formStatus = $('#form-status');

function showErrors(errors = {}) {
  $$('[data-error]', form).forEach((el) => {
    const message = errors[el.dataset.error] || '';
    el.textContent = message;
    el.closest('.field').classList.toggle('field--invalid', Boolean(message));
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#form-submit');
  const data = Object.fromEntries(new FormData(form));
  data.package = state.packageId;
  showErrors();
  formStatus.textContent = '';
  button.disabled = true;
  button.textContent = 'Sending…';

  try {
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
      showErrors(body.errors);
      formStatus.textContent = body.error || 'The message was not sent. Try again.';
      $('.field--invalid input, .field--invalid select, .field--invalid textarea', form)?.focus();
      return;
    }
    $('#sent-ref').textContent = body.ref;
    if (body.deepLink) {
      $('#sent-tg').href = body.deepLink;
      $('#sent-tg').hidden = false;
      $('#sent-tg-text').hidden = false;
    }
    form.hidden = true;
    $('#sent').hidden = false;
    $('#sent').focus();
  } catch {
    formStatus.textContent = 'The message was not sent. Check your connection and try again.';
  } finally {
    button.disabled = false;
    button.textContent = 'Send message';
  }
});

$('#form-package-clear').addEventListener('click', () => choosePackage(''));

// ---- Scroll reveal ----------------------------------------------------------

function revealOnScroll() {
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  const targets = '.section h2, .section__lede, .about__text, .facts, .case, .service, .wire, .price, .post, .perk, .form';
  $$(targets).forEach((el) => {
    // Cards in the same row arrive one after another.
    const index = [...el.parentElement.children].indexOf(el);
    el.style.transitionDelay = `${Math.min(index, 4) * 70}ms`;
    el.classList.add('reveal');
    observer.observe(el);
  });
}

// ---- Start ------------------------------------------------------------------

async function init() {
  try {
    const [content, screens, channel] = await Promise.all([
      getJson(api('content')),
      getJson(api('screens')),
      getJson(api('channel')),
    ]);
    state.content = content;
    state.screens = screens;
    document.title = `${content.brand.name}: computer science student who builds Telegram bots and websites`;
    renderContent(content);
    renderPosts(channel.posts);
    revealOnScroll();
    startChat();
  } catch (err) {
    console.error(err);
    chatBody.append(h('div', { class: 'bubble bubble--in' }, 'The preview could not load. Refresh the page to try again.'));
  }
}

init();
