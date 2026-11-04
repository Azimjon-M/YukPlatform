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
- Gemini: `@google/genai` ^2.32, `models.generateContent` with `config.systemInstruction` + `responseMimeType: "application/json"` + `responseJsonSchema: POST_SCHEMA`; SDK retryOptions (4 attempts, 3→30 s) for 429/5xx; default model alias `gemini-flash-lite-latest` (→ gemini-3.5-flash-lite in 2026-11, ~1.5 s/post, schema followed). Tested 2026-11-04 with his key: `gemini-flash-latest` returned 503 "high demand", `gemini-2.5-flash` 404 "no longer available to new users". Model IDs drift — `npm run parse -- --models` lists what his key sees. Concurrency 2. Free tier hit a **per-minute** 429 after ~16 requests (2026-11-04) and recovered within a minute: `gemini.retryAfterMs` reads `quotaId`/`retryDelay` from the 429 body, and the CLI pauses all workers and retries the same post (max 5 waits). Per-day 429 or 503 → stop, save partial results, print `--skip N`. Daily free limit still unknown (≥ ~60 requests/day worked).
- Claude: `@anthropic-ai/sdk` ^1.4, `client.beta.messages.create` with `output_config.format` (json_schema) + `output_config.effort` (default `low`), cached system prompt, `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` only for opus-5*/fable-5*/sonnet-5-5. Default model `claude-opus-5-5`.
- Phones are NOT asked from the model: regex in `src/phones.js` (right-anchored group matching, rejects prices/cards/dates) and attached to every load of the post. **`maskPhones` replaces them with `[telefon]` before the text goes to the AI** (free Gemini may use inputs; third-party numbers stay local). UZ codes include 87 and 70 (seen as `+998 87…`/`+998 70…` in real posts); +992…+996 neighbours accepted.
- First real run (2026-11-04, 50 posts from public groups, gemini-3.5-flash-lite): 50/50 valid JSON, 100 loads, region-level routes ~all right. Error patterns to fix in the prompt/schema: vehicle invented as `tent` when the post only says "fura kerak" (67/100 loads are tent); per-kg prices ("kilosiga 200 so'm", "180 kg so'mdan") read as total price or as weight → needs a price unit; city invented from a region ("Surxondaryo" → Termiz); weight ranges averaged ("20 22 ton" → 21); toponyms missed (Baxmal → "Baxt", lowercase "yangi yer" ≠ Yangiyer). Multi-load posts with several phones get all phones on every load.
- Output: `{postType: yuk_bor|mashina_bor|boshqa, loads: [...]}`; `mashina_bor` posts reuse the load fields for the truck's route/capacity.
- `test/parse.test.js` uses a fake client — tests never call the API.

## Collector (apps/collector)
- Phase 0 tool: `tg:login` / `tg:dialogs` / `tg:search -- <words>` (contacts.Search → public chats with username, sorted by members; no joining) / `tg:export -- <sources> [--limit N]` / `tg:logout` fill `data/samples/elonlar.txt` (append-only; drops posts < 20 chars and case/space-insensitive duplicates, also against what's already in the file). Phase 1 (live forwarding to `api`) not built yet.
- GramJS `telegram` ^2.26 — archived in 2026; its npm deprecation points to the `teleproto` fork (single maintainer). Kept for now; ALL GramJS code lives in `src/telegram.js` so a swap touches one file.
- **`useWSS: true` is required on his network:** in Node, GramJS connects on port 80 (hardcoded `useWSS ? 443 : 80`, session port ignored). Port 80 MTProto gets no reply here (raw req_pq probe 2026-11-04: 443 answers, 80 silent), so connect hangs at "New auth_key attempt". In Node `useWSS` only switches plain TCP to 443 — no TLS.
- Session saved to `apps/collector/telegram.session` (gitignored `*.session`), or `TG_SESSION` env. **He runs `tg:login` himself** — never enter phone codes/2FA for him; recommend a separate-number account, not his main Premium one. Logged in 2026-11-04 (account has 2FA). His account is in none of the yuk groups; reading public groups works without joining. First export: @yuk_markazi_gruupa, @yuklar_isuzi_furalar, @TutGruz, @toshkent_namangan_labo, @LOGISTICA_UZBEKISTAN × 60 → 228 posts (54 duplicates within 300 messages — dedupe is essential).
- `src/sources.js` and `src/samples.js` are pure and unit-tested; nothing in tests touches Telegram.
- Login: `src/prompt.js` reads the 2FA password in raw mode (Node 24 `readline/promises` has no `_writeToOutput`, the old hack crashed). `src/authErrors.js` decides retry vs stop: GramJS loops forever unless `onError` returns true, so only PHONE_CODE_INVALID / PASSWORD_HASH_INVALID / PHONE_NUMBER_INVALID retry (max 3). `firstAndLastNames` throws so GramJS never signs up a new account on an unregistered number.

## Key facts / decisions
- Telegram inline URL buttons accept only `http(s)://` and `tg://` — **no `tel:`**. One-tap call inside Telegram = phone in text as `+998XXXXXXXXX` (auto-linked), or an https redirect page → `tel:` (also gives call analytics). Web/mobile use `tel:` directly.
- Bot vs userbot are both real-time; difference is permission and ban risk, not speed. Bot must be admin to read channels; in groups it needs admin or privacy mode off. Userbot: separate phone number, read-only, don't join many groups at once; session string is a secret.
- Same load is reposted in many groups → dedupe on phone + route + time window, or drivers will mute the bot.
- Model category generic from day one (fura / yengil / pochta / yo'lovchi) but launch with fura only.
- Phase 0 first: parser is the biggest technical risk. Phones via regex, the rest via the AI provider (Gemini by default); one post may hold several loads → output an array. Measure accuracy on 30–50 hand-checked posts.

## Rules
- Secrets live only in `.env` (see `.env.example`); never ask him to paste keys into chat.
- Don't build web/mobile before the bot MVP works.
