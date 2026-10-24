# Blog API — Parse Server + Express

## Run
```
cp .env.example .env     # set PARSE_MASTER_KEY, DATABASE_URI (MongoDB)
npm install && npm start # http://localhost:1337/parse, GET /parse/health
npm test                 # in-memory MongoDB (downloaded on first run)
npm run lint
```
CI (`.github/workflows/ci.yml`) runs lint and tests on every push.
```
```

## Done
All Must items R1–R8 and all Bonus items (13 tests in `test/api.test.js`).

Extras: `npm run lint`, `npm run seed` (server must be running), `docker compose up --build`.

## Security
- Master key only from the environment, never logged; `.env` is git-ignored.
- Clients cannot create classes or fields (`lockSchemas`, `allowClientClassCreation: false`, empty `addField` CLP).
- `Like` is writable only by Cloud Code; counters and `author` are server-owned and reverted if a client sends them.
- `email` is a protected field: visible only to its owner.
- Rate limit per IP on signup and `toggleLike` (429), and bounded query complexity.

## Choices
- Schema + CLPs in `src/schema.js`, applied by Parse Server at startup (`lockSchemas`, no client class creation).
- Triggers skip `request.master`, so server-side counter updates are not blocked.
- Counters use atomic `increment()`.
- A unique MongoDB index on `Like (post, user)` is created at startup; `toggleLike` retries on a lost race.

## Trade-offs
- `likesCount` / `commentsCount` are denormalised counters updated with atomic `$inc`, so reads stay cheap. If a server crash happens between a write and its counter update they can drift; a periodic recount job would repair them.
- Triggers return early for the master key: trusted server code is not re-validated.
- Indexes on `Comment.post`, `Comment.author`, `Post.author` and the unique `Like (post, user)` support the queries the API actually runs.

## With more time
A counter-repair job; pagination helpers for post lists; structured logging and metrics.
