# Lucas: personal site, bot and channel

A personal website, a Telegram bot and a self-posting Telegram channel. The site is about Lucas and has a section for the bots and websites he builds for clients. All three run as one Node process with no dependencies to install.

## What is in it

**Website** (`public/`)
- Personal page with an about section, projects, what I build for clients (with starting prices), the channel and a contact form.
- The chat in the hero shows the real bot's menu. It reads the same screens the bot sends.
- The quote form saves the request and sends it to your Telegram.
- After sending, the visitor gets a "Continue on Telegram" link that ties the request to their Telegram account so you can reply there.
- The channel section shows the bot's latest channel posts.

**Bot** (`src/bot.js`)
- Menu: about me, projects, what I build, prices, process, questions.
- Four-step quote request. Each request reaches you as a lead card with status buttons (contacted, won, lost).
- Any message a visitor types is passed to you. Reply to it and the bot delivers your answer.
- Channel discount: the bot checks that someone has joined your channel, then adds the code to their quote.
- Links from the site open the bot at the right place (`?start=quote_site`, `?start=pkg_bundle`, `?start=lead_<ref>`).

**Channel** (`src/channel.js`)
- Publishes the posts in `content/channel-posts.json` at the times in `POST_TIMES`, then starts again from the top.
- Every post has a "Get a quote" button that opens the bot.

**Admin commands** (only for the Telegram account in `ADMIN_ID`)

| Command | What it does |
| --- | --- |
| `/admin` | Lists these commands |
| `/leads` | The last 10 leads |
| `/stats` | Users, leads and channel numbers |
| `/queue` | The next channel posts |
| `/postnext` | Publishes the next queued post now |
| `/post <text>` | Publishes your own post now (first line is the title) |
| `/pause`, `/resume` | Stops or restarts scheduled posts |
| `/broadcast <text>` | Messages everyone who has used the bot, after a preview |

## Run the website

Needs Node 20.12 or newer.

```bash
npm start
```

Open http://localhost:3000. Without a bot token the site runs alone and form requests are saved to `data/leads.json`.

## Connect Telegram

1. In Telegram, open **@BotFather**, send `/newbot`, and follow the steps. Copy the token it gives you.
2. Copy `.env.example` to `.env` and paste the token after `BOT_TOKEN=`.
3. Run `npm start`, open your bot in Telegram and send `/id`. Put that number after `ADMIN_ID=`.
4. Create a channel. In the channel's settings, add your bot as an administrator with permission to post.
5. Put the channel's `@username` after `CHANNEL_ID=`.
6. Restart with `npm start`. Send `/postnext` to the bot to publish the first post.

Keep `.env` private. Anyone with the token controls the bot.

## Make it yours

Everything a visitor reads is in two files:

- `content/content.json`: name, email, social links, about text, projects, services, packages and prices, process, questions, quote options, discount code.
- `content/channel-posts.json`: the channel post queue.

Change them and restart. The site and the bot both update, because both read the same files.

The email address is a placeholder and the prices are estimates. Add your TikTok, GitHub or LinkedIn links under `socials` and they appear in the about section.

## Put it online

The bot must run all the time, so it needs an always-on host, not a static site host. Any service that runs a Node process works (Railway, Render, Fly.io, or a small VPS).

1. Deploy this folder with the start command `npm start`.
2. Set the values from `.env` as environment variables on the host.
3. Set `PUBLIC_URL` to the site's `https://` address. Channel posts then get a "See the website" button.
4. Give the `data/` folder persistent storage, or leads and stats reset on each deploy.

Run only one copy of the bot per token. Two copies fight over incoming messages.

## Layout

```
content/         text, prices and channel posts
public/          the website
src/server.js    web server, API, starts the bot
src/bot.js       bot commands, quote requests, admin tools
src/channel.js   scheduled channel posts
src/flows.js     menu screens shared by the bot and the site
src/leads.js     saving leads and notifying you
src/telegram.js  Telegram API client
src/store.js     JSON file storage in data/
```
