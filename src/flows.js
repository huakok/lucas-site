// Every menu screen the bot can show, built from content/content.json.
// The bot sends these to Telegram and the website's chat preview renders the
// same objects, so the two can never drift apart.
//
// A screen is { text, buttons }. Text is Telegram HTML. A button is one of:
//   { text, go: 'screenId' }   open another screen
//   { text, act: 'name' }      run a bot action (quote wizard, perk check)
//   { text, url }              open a link

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const priceLabel = (content, pkg) =>
  pkg.unit === 'custom'
    ? 'quoted per project'
    : pkg.unit === 'month'
      ? `${content.currency}${pkg.price} / month`
      : `from ${content.currency}${pkg.price.toLocaleString('en-US')}`;

const bullets = (items) => items.map((i) => `• ${esc(i)}`).join('\n');
const MENU = { text: '‹ Menu', go: 'home' };
const QUOTE = { text: 'Get a quote', act: 'quote:start' };

export function screen(id, ctx, name = 'there') {
  const { content } = ctx;
  const [base, arg] = id.split(':');

  switch (base) {
    case 'home': {
      const buttons = [
        [{ text: 'About me', go: 'about' }, { text: 'Projects', go: 'projects' }],
        [{ text: 'What I build', go: 'services' }, { text: 'Prices', go: 'pricing' }],
        [{ text: 'How it works', go: 'process' }, { text: 'Questions', go: 'faq' }],
        [{ text: `${content.perk.percent}% off`, go: 'perk' }, QUOTE],
      ];
      return {
        text:
          `<b>Hi ${esc(name)}, I am ${esc(content.brand.name)}.</b>\n\n` +
          `${esc(content.bot.welcome)}\n\n` +
          'Pick a button to look around, or type a message and it goes straight to me.',
        buttons,
      };
    }

    case 'services':
      return {
        text:
          '<b>What I build</b>\n\n' +
          content.services.map((s) => `<b>${esc(s.name)}</b>\n${esc(s.summary)}`).join('\n\n'),
        buttons: [content.services.map((s) => ({ text: s.name, go: `svc:${s.id}` })), [MENU]],
      };

    case 'svc': {
      const s = content.services.find((x) => x.id === arg);
      if (!s) return null;
      return {
        text: `<b>${esc(s.name)}</b>\n\n${esc(s.summary)}\n\n${bullets(s.points)}`,
        buttons: [[{ text: 'See prices', go: 'pricing' }, QUOTE], [{ text: '‹ What I build', go: 'services' }]],
      };
    }

    case 'pricing': {
      const rows = [];
      content.packages.forEach((p, i) => {
        if (i % 2 === 0) rows.push([]);
        rows.at(-1).push({ text: p.name, go: `pkg:${p.id}` });
      });
      return {
        text:
          '<b>Prices</b>\n\n' +
          content.packages
            .map((p) => `<b>${esc(p.name)}</b>  ${esc(priceLabel(content, p))}\n${esc(p.blurb)}`)
            .join('\n\n') +
          '\n\nTap a package to see what is included.',
        buttons: [...rows, [MENU]],
      };
    }

    case 'pkg': {
      const p = content.packages.find((x) => x.id === arg);
      if (!p) return null;
      return {
        text:
          `<b>${esc(p.name)}</b>  ${esc(priceLabel(content, p))}\n` +
          `<i>${esc(p.timeline)}</i>\n\n${esc(p.blurb)}\n\n${bullets(p.includes)}`,
        buttons: [[{ text: 'Ask for this package', act: `quote:pkg:${p.id}` }], [{ text: '‹ Prices', go: 'pricing' }]],
      };
    }

    case 'about':
      return {
        text: `<b>About me</b>\n\n${content.about.paragraphs.map(esc).join('\n\n')}`,
        buttons: [[{ text: 'Projects', go: 'projects' }, { text: 'What I build', go: 'services' }], [MENU]],
      };

    case 'projects':
      return {
        text:
          '<b>Projects</b>\n\n' +
          content.projects
            .map((p) => `<b>${esc(p.name)}</b>\n<i>${esc(p.kind)}</i>\n${esc(p.summary)}`)
            .join('\n\n'),
        buttons: [[QUOTE], [MENU]],
      };

    case 'process':
      return {
        text:
          '<b>How it works</b>\n\n' +
          content.process.map((p, i) => `<b>${i + 1}. ${esc(p.name)}</b>\n${esc(p.text)}`).join('\n\n'),
        buttons: [[QUOTE], [MENU]],
      };

    case 'faq':
      if (arg !== undefined) {
        const item = content.faq[Number(arg)];
        if (!item) return null;
        return {
          text: `<b>${esc(item.q)}</b>\n\n${esc(item.a)}`,
          buttons: [[{ text: '‹ Questions', go: 'faq' }, MENU]],
        };
      }
      return {
        text: '<b>Questions</b>\n\nTap one to see the answer.',
        buttons: [...content.faq.map((f, i) => [{ text: f.q, go: `faq:${i}` }]), [MENU]],
      };

    case 'perk': {
      const buttons = [];
      if (ctx.channelUrl) buttons.push([{ text: 'Join the channel', url: ctx.channelUrl }]);
      buttons.push([{ text: 'I have joined, check', act: 'perk:check' }], [MENU]);
      return {
        text:
          `<b>${esc(content.perk.text)}</b>\n\n` +
          'Join the channel, then tap the check button. The discount is added to your next quote request.',
        buttons,
      };
    }

    default:
      return null;
  }
}

export function allScreens(ctx) {
  const { content } = ctx;
  const ids = [
    'home', 'about', 'projects', 'services', 'pricing', 'process', 'faq', 'perk',
    ...content.services.map((s) => `svc:${s.id}`),
    ...content.packages.map((p) => `pkg:${p.id}`),
    ...content.faq.map((_, i) => `faq:${i}`),
  ];
  return Object.fromEntries(ids.map((id) => [id, screen(id, ctx)]));
}

// Telegram's inline keyboard format.
export const markup = (buttons) => ({
  inline_keyboard: buttons.map((row) =>
    row.map((b) =>
      b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.go ? `go:${b.go}` : b.act },
    ),
  ),
});
