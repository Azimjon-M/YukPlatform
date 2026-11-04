# YukPlatform — context for Claude

## User
Azimjon — university IT web developer. Talk to him in **Uzbek (Latin)**. React is strong (~85%: Tailwind, Formik, Axios); Node.js is ~70% learned and stopped right before writing APIs — when writing back-end code, explain the Node/API parts as you go so he learns them. Never built a Telegram bot before this project.

## Product
Aggregate cargo (yuk) posts from large Telegram groups/channels (10k–100k members), parse them with AI into structured loads, dedupe, and send each driver only the loads matching his filters (route, vehicle type, tonnage) as a personal message with one-tap call. Later: Mini App, web, Android/iOS, and pochta / passenger taxi between cities.

## Layout
- `apps/api` — core: REST API, Postgres+Prisma, dedupe, filter matching, notification dispatch
- `apps/bot` — grammY bot: onboarding, filters, personal DMs; also reads partner groups as admin
- `apps/collector` — GramJS userbot reading public groups; separate process so a ban/crash doesn't take the bot down
- `apps/web` — React+Vite+Tailwind; same code serves the website and the Telegram Mini App
- `apps/mobile` — Expo (phase 4)
- `packages/parser` — post text → JSON (phase 0, current)
- `packages/shared` — regions (all spellings: Фаргона/Fargona/Farg'ona/Фарғона), vehicle types, load model
- `data/samples/elonlar.txt` — real posts separated by `---`; contains real phone numbers → gitignored, never publish

Language: JavaScript (ES modules) by default since he knows JS; revisit TypeScript once `packages/shared` grows. Code comments in Uzbek (he reads them to learn). npm workspaces from the root; `npm test` runs `node --test` per package. Node 24 — `.env` loaded via `node --env-file-if-exists`, no dotenv.

## Parser (packages/parser)
- **Budget: Azimjon has no money for paid APIs and won't borrow for testing — default provider is Gemini free tier** (AI Studio key, `GEMINI_API_KEY`). Don't steer him to paid usage; Claude stays as an optional provider for later.
- Providers in `src/providers/{gemini,claude}.js`, same shape: `generate(client, {text, model, effort}) → {ok, json|error, model, usage}` with usage normalized to `{input, output, cacheRead, cacheWrite}`; plus `isFatal`, `describeError`, `cost`, `listModels`. `createParser({provider, model, client})` in `src/parse.js`; tests inject fake clients.
- Gemini: `@google/genai` ^2.32, `models.generateContent` with `config.systemInstruction` + `responseMimeType: "application/json"` + `responseJsonSchema: POST_SCHEMA`; SDK retryOptions (4 attempts, 3→30 s) for 429/5xx; default model alias `gemini-flash-lite-latest` (→ gemini-3.5-flash-lite in 2026-11, ~1.5 s/post, schema followed). Tested 2026-11-04 with his key: `gemini-flash-latest` returned 503 "high demand", `gemini-2.5-flash` 404 "no longer available to new users". Model IDs drift — `npm run parse -- --models` lists what his key sees. Concurrency 2; 429 (daily quota) or 503 (overloaded) after retries → stop, save partial results, print `--skip N`.
- Claude: `@anthropic-ai/sdk` ^1.4, `client.beta.messages.create` with `output_config.format` (json_schema) + `output_config.effort` (default `low`), cached system prompt, `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` only for opus-5*/fable-5*/sonnet-5-5. Default model `claude-opus-5-5`.
- Phones are NOT asked from the model: regex in `src/phones.js` (right-anchored group matching, rejects prices/cards/dates) and attached to every load of the post.
- Output: `{postType: yuk_bor|mashina_bor|boshqa, loads: [...]}`; `mashina_bor` posts reuse the load fields for the truck's route/capacity.
- `test/parse.test.js` uses a fake client — tests never call the API.

## Key facts / decisions
- Telegram inline URL buttons accept only `http(s)://` and `tg://` — **no `tel:`**. One-tap call inside Telegram = phone in text as `+998XXXXXXXXX` (auto-linked), or an https redirect page → `tel:` (also gives call analytics). Web/mobile use `tel:` directly.
- Bot vs userbot are both real-time; difference is permission and ban risk, not speed. Bot must be admin to read channels; in groups it needs admin or privacy mode off. Userbot: separate phone number, read-only, don't join many groups at once; session string is a secret.
- Same load is reposted in many groups → dedupe on phone + route + time window, or drivers will mute the bot.
- Model category generic from day one (fura / yengil / pochta / yo'lovchi) but launch with fura only.
- Phase 0 first: parser is the biggest technical risk. Phones via regex, the rest via Claude API; one post may hold several loads → output an array. Measure accuracy on 30–50 hand-checked posts.

## Rules
- Secrets live only in `.env` (see `.env.example`); never ask him to paste keys into chat.
- Don't build web/mobile before the bot MVP works.
