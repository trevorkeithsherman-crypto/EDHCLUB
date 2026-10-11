# EDH Club

A free, browser-based Commander table. Bring your deck, sit down, play.

This is the first playable build: a four-seat table you can run in one browser (switch seats with
"Playing as"), with Scryfall card art, deck import, every zone, commander tax and damage, and
animated casts, attacks, board wipes and wins. Live multiplayer between browsers comes next.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Deploy (Cloudflare Pages)

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Import from an existing Git repository**.
2. Pick this repo.
3. Build command `npm run build`, build output directory `dist`.
4. **Save and Deploy**. Every push to `main` redeploys.

## Project layout

| File | What it does |
| --- | --- |
| `index.html` | Page shell and fan-content notice |
| `src/main.js` | Game state, rendering, drag and drop, menus, modals |
| `src/scryfall.js` | Card data and images from the Scryfall API, cached in the browser |
| `src/fx.js` | Particles, motion and synthesized sound |
| `src/decks.js` | Offline fallback card data and the four sample decks |
| `src/style.css` | The table look |

## Card data and images

Card data and images come from [Scryfall](https://scryfall.com/docs/api). Decks are looked up with
`/cards/collection` (75 names per request) and cached in `localStorage`. Card images are shown whole,
never cropped, with Scryfall credited in the footer.

EDH Club is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.


## Discord announcements (open tables)

The worker can post new public tables to Discord: on demand (host → Table → **Post to Discord**) and by a sweep
every 5 minutes (`triggers.crons` in `wrangler.jsonc`). It needs three secrets on the Worker:

```bash
npx wrangler secret put SUPABASE_URL            # https://<project>.supabase.co
npx wrangler secret put SUPABASE_SERVICE_KEY    # the service_role key (server only, never in the client)
npx wrangler secret put DISCORD_WEBHOOK_URL     # optional: a global #open-tables channel webhook
```

Clubs can add their own webhook from the club panel on the home page (Channel settings → Integrations → Webhooks);
club tables are posted there as well. Tables are announced once; locked or private tables never are.
