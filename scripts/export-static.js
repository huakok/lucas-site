// Builds a copy of the website that needs no server, for hosts that only serve
// files (GitHub Pages). Output goes to dist/. The contact form is replaced by
// direct Telegram and email links, because nothing is running to receive it.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../src/config.js';
import { allScreens } from '../src/flows.js';
import { PUBLIC_DIR, publicContent, queue, screenContext } from '../src/site-data.js';

const OUT = path.join(ROOT, 'dist');
rmSync(OUT, { recursive: true, force: true });
cpSync(PUBLIC_DIR, OUT, { recursive: true });
mkdirSync(path.join(OUT, 'api'));

const write = (name, data) => writeFileSync(path.join(OUT, 'api', `${name}.json`), JSON.stringify(data));
write('content', publicContent(config));
write('screens', allScreens(screenContext(config)));
write('channel', { posts: queue.slice(0, 3).map((p) => ({ title: p.title, body: p.body, status: 'queued' })) });

// Tell the page it is running without a server, and stamp every file address
// with a version so phones and browsers fetch the new files after an update
// instead of reusing saved copies.
const version = (process.env.GITHUB_SHA || String(Date.now())).slice(0, 10);
const updated = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date());
const indexFile = path.join(OUT, 'index.html');
const html = readFileSync(indexFile, 'utf8')
  .replace('<html lang="en-GB">', `<html lang="en-GB" data-static="${version}">`)
  .replace('href="styles.css"', `href="styles.css?v=${version}"`)
  .replace('src="background.js"', `src="background.js?v=${version}"`)
  .replace('src="app.js"', `src="app.js?v=${version}"`)
  .replace('<!-- build -->', `<p class="footer__build">Updated ${updated}</p>`);
writeFileSync(indexFile, html);
writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Static site written to ${path.relative(ROOT, OUT)}/`);
